import { prisma, ShipmentStatus } from '@swapify/db';
import { getShippingProvider } from './shipping-provider.js';
import { notify } from './notifications.js';
import { tryCompleteSwap } from './shipping.js';
import pino from 'pino';

const log = pino({ name: 'shipping-sweeper', level: process.env.LOG_LEVEL ?? 'info' });

const POLL_INTERVAL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Sweeper: tracks IN_TRANSIT shipments for delivery confirmation
// ---------------------------------------------------------------------------

export async function pollInTransitShipments(): Promise<number> {
  const shipments = await prisma.shipment.findMany({
    where: { status: ShipmentStatus.IN_TRANSIT },
    select: { id: true, providerShipmentId: true, receiverUserId: true, swapId: true },
  });

  const provider = getShippingProvider();
  let deliveredCount = 0;

  for (const shipment of shipments) {
    if (!shipment.providerShipmentId) continue;
    try {
      const update = await provider.getTracking(shipment.providerShipmentId);
      if (update?.status === 'DELIVERED') {
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() },
        });
        await notify(shipment.receiverUserId, 'SWAP_UPDATE', 'Your swap item has been delivered', shipment.swapId);
        deliveredCount++;
        // Check if both shipments delivered → complete swap
        await tryCompleteSwap(shipment.swapId);
      }
    } catch (err) {
      // Best-effort: skip provider errors and continue polling
      log.warn({ err, shipmentId: shipment.id }, 'Failed to poll tracking for shipment');
    }
  }

  return deliveredCount;
}

// ---------------------------------------------------------------------------
// Sweeper: enforce postage deadline (auto-cancel shipments that haven't paid)
// ---------------------------------------------------------------------------

export async function enforcePostageDeadlines(): Promise<number> {
  const now = new Date();
  const expired = await prisma.shipment.findMany({
    where: {
      status: ShipmentStatus.PENDING,
      postageDeadline: { lte: now },
    },
    select: { id: true, senderUserId: true, swapId: true },
  });

  let cancelledCount = 0;
  for (const shipment of expired) {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: ShipmentStatus.CANCELLED,
        cancelledAt: now,
        postageDeadline: null,
        shipDeadline: null,
      },
    });
    await notify(shipment.senderUserId, 'SWAP_UPDATE', 'A shipment was auto-cancelled: postage deadline expired', shipment.swapId);
    cancelledCount++;
  }

  return cancelledCount;
}

// ---------------------------------------------------------------------------
// Sweeper: enforce ship deadline (auto-cancel labelled shipments not dispatched)
// ---------------------------------------------------------------------------

export async function enforceShipDeadlines(): Promise<number> {
  const now = new Date();
  const expired = await prisma.shipment.findMany({
    where: {
      status: ShipmentStatus.LABEL_READY,
      shipDeadline: { lte: now },
    },
    select: { id: true, senderUserId: true, swapId: true, providerShipmentId: true },
  });

  let cancelledCount = 0;
  const provider = getShippingProvider();

  for (const shipment of expired) {
    if (shipment.providerShipmentId) {
      try {
        await provider.cancelShipment(shipment.providerShipmentId);
      } catch (err) {
        // Best-effort: log but continue — the DB status is still updated below.
        log.warn({ err, shipmentId: shipment.id }, 'Failed to cancel shipment with provider');
      }
    }

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: ShipmentStatus.CANCELLED,
        cancelledAt: now,
        postageDeadline: null,
        shipDeadline: null,
      },
    });
    await notify(shipment.senderUserId, 'SWAP_UPDATE', 'A shipment was auto-cancelled: ship deadline expired', shipment.swapId);
    cancelledCount++;
  }

  return cancelledCount;
}

// ---------------------------------------------------------------------------
// Main sweeper loop (started in server.ts)
// ---------------------------------------------------------------------------

export async function runShippingSweeper(): Promise<void> {
  const results = await Promise.allSettled([
    pollInTransitShipments(),
    enforcePostageDeadlines(),
    enforceShipDeadlines(),
  ]);

  const errors = results.filter(r => r.status === 'rejected');
  if (errors.length > 0) {
    log.error({ errors: errors.map(r => (r as PromiseRejectedResult).reason) }, 'Shipping sweeper errors');
  }
}

export async function startShippingSweeper(signal?: AbortSignal): Promise<void> {
  log.info('Shipping sweeper started');
  while (true) {
    if (signal?.aborted) break;
    try {
      await runShippingSweeper();
    } catch (err) {
      log.error({ err }, 'Shipping sweeper cycle error');
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      if (signal) {
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      }
    });
  }
}
