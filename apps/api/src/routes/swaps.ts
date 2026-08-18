import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ItemStatus, PaymentStatus, Prisma, Swap, SwapStatus, prisma, ShipmentStatus } from '@swapify/db';
import { calculateServiceFee } from '@swapify/shared';
import { HttpError, assertNoActiveSwap, computeGap, withSerializableRetry } from '../services/swaps.js';
import { createSwapPaymentCheckout, refundSwapPayment } from '../services/stripe.js';
import { notify } from '../services/notifications.js';
import { createSwapShipments, cancelSwapShipments, hasShipmentsInMotion, markDelivered, tryCompleteSwap } from '../services/shipping.js';

const swapParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const createSwapSchema = {
  body: {
    type: 'object',
    required: ['offeringItemId', 'requestedItemId'],
    properties: {
      offeringItemId: { type: 'string' },
      requestedItemId: { type: 'string' },
    },
  },
} as const;

const swapInclude = {
  offeringItem: { include: { images: { orderBy: { position: 'asc' as const } } } },
  requestedItem: { include: { images: { orderBy: { position: 'asc' as const } } } },
  offeringUser: { select: { id: true, name: true, imageUrl: true } },
  requestedUser: { select: { id: true, name: true, imageUrl: true } },
  payment: true,
};

// Origin of the API itself, used to build the simulated checkout redirect.
function apiOrigin(request: { protocol: string; host: string }): string {
  return `${request.protocol}://${request.host}`;
}

// Origin of the web app, used for payment success/cancel redirects.
function appOrigin(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

async function releaseItems(tx: Prisma.TransactionClient, itemIds: string[]) {
  await tx.item.updateMany({
    where: { id: { in: itemIds } },
    data: { status: ItemStatus.ACTIVE },
  });
}

async function getParticipantSwap(id: string, userId: string): Promise<Swap | null> {
  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap || (swap.offeringUserId !== userId && swap.requestedUserId !== userId)) return null;
  return swap;
}

// Shared by cancel and expire: refunds any recorded payment, frees the items,
// and lands the swap in CANCELLED or EXPIRED. Only valid before either shipment
// leaves the warehouse (IN_TRANSIT/DELIVERED) — once in motion, admin help is
// needed.
//
// Concurrency-safe: the transition to the terminal status is an atomic
// conditional UPDATE (AGREED/PAID + no shipments in motion). Only the instance
// that wins it performs the refund and item release; a second instance (or the
// sweeper) observes the swap already settled and gets a 409 instead.
async function settleCancelledSwap(swap: Swap, finalStatus: SwapStatus): Promise<Swap> {
  const now = new Date();

  const inMotion = await hasShipmentsInMotion(swap.id);
  if (inMotion) {
    throw new HttpError(409, `Cannot ${finalStatus.toLowerCase()}: swap is already in motion`);
  }

  const claimed = await prisma.swap.updateMany({
    where: {
      id: swap.id,
      status: { in: [SwapStatus.AGREED, SwapStatus.PAID] },
    },
    data: { status: finalStatus, cancelledAt: now },
  });
  if (claimed.count === 0) {
    throw new HttpError(409, `Cannot ${finalStatus.toLowerCase()}: swap is already settled`);
  }

  if (swap.status === SwapStatus.PAID) {
    const payment = await prisma.payment.findUnique({ where: { swapId: swap.id } });
    if (payment) {
      await refundSwapPayment(payment.id);
    }
  }

  await prisma.item.updateMany({
    where: { id: { in: [swap.offeringItemId, swap.requestedItemId] } },
    data: { status: ItemStatus.ACTIVE },
  });

  // Cancel any active shipments (best-effort; shipments may not exist yet)
  try {
    await cancelSwapShipments(prisma, swap.id, now);
  } catch {
    // Non-fatal: shipments may not exist if swap was cancelled before completion
  }

  return prisma.swap.findUniqueOrThrow({ where: { id: swap.id }, include: swapInclude });
}

const swapRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // My swaps (offering or requested).
  app.get('/swaps', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;

    const swaps = await prisma.swap.findMany({
      where: { OR: [{ offeringUserId: user.id }, { requestedUserId: user.id }] },
      include: swapInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { swaps };
  });

  app.get('/swaps/:id', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await prisma.swap.findUnique({ where: { id }, include: swapInclude });
    if (!swap || (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id)) {
      return reply.code(404).send({ error: 'Swap not found' });
    }

    return { swap };
  });

  // Offer my item for a listing. Items get reserved so nobody else can claim them.
  app.post('/swaps', { preHandler: [app.authenticate], schema: createSwapSchema }, async (request) => {
    const user = request.user!;
    const { offeringItemId, requestedItemId } = request.body as {
      offeringItemId: string;
      requestedItemId: string;
    };

    if (offeringItemId === requestedItemId) {
      throw new HttpError(400, 'Cannot swap an item with itself');
    }

    const swap = await withSerializableRetry(async (tx) => {
      const offeringItem = await tx.item.findUnique({ where: { id: offeringItemId } });
      const requestedItem = await tx.item.findUnique({ where: { id: requestedItemId } });

      if (!offeringItem || offeringItem.status === ItemStatus.DELETED) {
        throw new HttpError(404, 'Offering item not found');
      }
      if (!requestedItem || requestedItem.status === ItemStatus.DELETED) {
        throw new HttpError(404, 'Requested item not found');
      }
      if (offeringItem.ownerId !== user.id) {
        throw new HttpError(403, 'You can only offer your own items');
      }
      if (requestedItem.ownerId === user.id) {
        throw new HttpError(400, 'You cannot swap with yourself');
      }
      if (offeringItem.status !== ItemStatus.ACTIVE || requestedItem.status !== ItemStatus.ACTIVE) {
        throw new HttpError(409, 'One of the items is already involved in a swap');
      }

      await assertNoActiveSwap(tx, offeringItemId);
      await assertNoActiveSwap(tx, requestedItemId);

      const gap = computeGap(offeringItem.valuePence, requestedItem.valuePence);

      const swap = await tx.swap.create({
        data: {
          offeringUserId: user.id,
          offeringItemId,
          requestedUserId: requestedItem.ownerId,
          requestedItemId,
          gapPence: gap.gapPence,
          gapPayer: gap.gapPayer,
          status: SwapStatus.REQUESTED,
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
        include: swapInclude,
      });

      await tx.item.updateMany({
        where: { id: { in: [offeringItemId, requestedItemId] } },
        data: { status: ItemStatus.RESERVED },
      });

      return swap;
    });

    await notify(
      swap.requestedUserId,
      'SWAP_REQUEST',
      `${user.name} wants to swap their ${swap.offeringItem.title} for your listing`,
      swap.id,
    );
    return { swap };
  });

  // The owner of the requested item accepts the swap.
  // For equal-value swaps, shipments are created atomically at this point.
  app.post('/swaps/:id/accept', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await withSerializableRetry(async (tx) => {
      const existing = await tx.swap.findUnique({ where: { id } });
      if (!existing || existing.requestedUserId !== user.id) {
        throw new HttpError(404, 'Swap not found');
      }
      if (existing.status !== SwapStatus.REQUESTED) {
        throw new HttpError(409, `Cannot accept: swap is ${existing.status.toLowerCase()}`);
      }

      const now = new Date();
      const updated = await tx.swap.update({
        where: { id },
        data: {
          status: SwapStatus.AGREED,
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
        include: swapInclude,
      });

      // Equal-value: create both shipment legs immediately at AGREED
      if (existing.gapPence === 0) {
        await createSwapShipments(tx, id, now);
      }

      return updated;
    });

    await notify(swap.offeringUserId, 'SWAP_UPDATE', `${user.name} accepted your swap request`, swap.id);
    return { swap };
  });

  // The owner of the requested item declines the swap; both items free up.
  app.post('/swaps/:id/decline', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await withSerializableRetry(async (tx) => {
      const existing = await tx.swap.findUnique({ where: { id } });
      if (!existing || existing.requestedUserId !== user.id) {
        throw new HttpError(404, 'Swap not found');
      }
      if (existing.status !== SwapStatus.REQUESTED) {
        throw new HttpError(409, `Cannot decline: swap is ${existing.status.toLowerCase()}`);
      }

      const updated = await tx.swap.update({
        where: { id },
        data: { status: SwapStatus.CANCELLED, cancelledAt: new Date() },
        include: swapInclude,
      });

      await releaseItems(tx, [existing.offeringItemId, existing.requestedItemId]);
      return updated;
    });

    await notify(swap.offeringUserId, 'SWAP_UPDATE', `${user.name} declined your swap request`, swap.id);
    return { swap };
  });

  // The gap payer starts a Stripe Checkout payment covering the value
  // difference plus the service fee. The swap only moves to PAID once the
  // payment is confirmed (via webhook, or dev-confirm in the simulated flow).
  app.post('/swaps/:id/pay', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await getParticipantSwap(id, user.id);
    if (!swap) throw new HttpError(404, 'Swap not found');
    if (swap.status !== SwapStatus.AGREED) {
      throw new HttpError(409, `Cannot pay: swap is ${swap.status.toLowerCase()}`);
    }
    if (swap.gapPayer === 'NONE') {
      throw new HttpError(400, 'Values match - there is no gap to pay');
    }
    const gapPayerUserId = swap.gapPayer === 'OFFERING_USER' ? swap.offeringUserId : swap.requestedUserId;
    if (gapPayerUserId !== user.id) {
      throw new HttpError(403, 'Only the payer can start the payment');
    }

    const payment = await withSerializableRetry(async (tx) => {
      const existing = await tx.payment.findUnique({ where: { swapId: swap.id } });
      if (existing) {
        if (existing.status === PaymentStatus.PAID) {
          throw new HttpError(409, 'Payment for this swap has already been recorded');
        }
        return existing;
      }
      return tx.payment.create({
        data: {
          swapId: swap.id,
          payerUserId: user.id,
          amountPence: swap.gapPence,
          feePence: calculateServiceFee(swap.gapPence),
          totalPence: swap.gapPence + calculateServiceFee(swap.gapPence),
          status: PaymentStatus.PENDING,
        },
      });
    });

    const higherValuePence = Math.max(
      ...(
        await prisma.item.findMany({
          where: { id: { in: [swap.offeringItemId, swap.requestedItemId] } },
          select: { valuePence: true },
        })
      ).map((item) => item.valuePence),
    );

    const checkout = await createSwapPaymentCheckout(
      payment,
      higherValuePence,
      `${appOrigin()}/swaps/${swap.id}?paid=1`,
      `${appOrigin()}/swaps/${swap.id}`,
    );

    if (!checkout.simulated && payment.stripeCheckoutSessionId !== checkout.sessionId) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { stripeCheckoutSessionId: checkout.sessionId },
      });
    }

    const checkoutUrl = checkout.simulated
      ? `${apiOrigin(request)}/stripe/dev-confirm/${payment.id}`
      : checkout.url;

    return { swap: { ...swap, payment }, checkoutUrl };
  });

  // Confirm receipt: the receiver explicitly confirms they received the
  // other party's item. This is a fallback/manual confirmation — carrier
  // webhooks are the authoritative delivery signal. After confirming, we
  // check if both shipments are DELIVERED and, if so, complete the swap
  // atomically (same as tryCompleteSwap).
  //
  // Concurrency-safe: confirmation is a conditional UPDATE; shipment
  // delivery + completion uses serializable retry with conditional updateMany.
  app.post('/swaps/:id/confirm', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await getParticipantSwap(id, user.id);
    if (!swap) throw new HttpError(404, 'Swap not found');

    const equalValue = swap.gapPence === 0;
    const eligibleStatus = equalValue ? SwapStatus.AGREED : SwapStatus.PAID;
    if (swap.status !== eligibleStatus) {
      if (swap.gapPence > 0) {
        throw new HttpError(409, 'The gap payment must be completed before confirming receipt');
      }
      throw new HttpError(409, `Cannot confirm: swap is ${swap.status.toLowerCase()}`);
    }

    const amOffering = swap.offeringUserId === user.id;
    const myField = amOffering ? 'offeringUserConfirmedAt' : 'requestedUserConfirmedAt';
    const otherField = amOffering ? 'requestedUserConfirmedAt' : 'offeringUserConfirmedAt';
    const now = new Date();

    // Atomically record my confirmation, only while the swap is still eligible.
    const claimed = await prisma.swap.updateMany({
      where: { id, status: eligibleStatus, [myField]: null },
      data: { [myField]: now },
    });
    if (claimed.count === 0) {
      const current = await prisma.swap.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, 'Swap not found');
      if (!current[myField]) {
        throw new HttpError(409, `Cannot confirm: swap is ${current.status.toLowerCase()}`);
      }
    }

    await prisma.swap.findUniqueOrThrow({ where: { id }, include: swapInclude });

    // Find my incoming shipment (where I am the receiver) and mark delivered
    // if the carrier hasn't already. This is the manual/fallback confirmation.
    const incomingShipment = await prisma.shipment.findFirst({
      where: { swapId: id, receiverUserId: user.id },
    });
    if (incomingShipment && incomingShipment.status !== ShipmentStatus.DELIVERED) {
      if (incomingShipment.status === ShipmentStatus.IN_TRANSIT) {
        await markDelivered(incomingShipment.id, user.id);
      }
      // If still PENDING/LABEL_READY, just record the confirmation — delivery
      // hasn't happened yet so we can't mark it DELIVERED.
    }

    // Reload after delivery update
    const latest = await prisma.swap.findUniqueOrThrow({ where: { id }, include: swapInclude });

    const otherConfirmed = latest[otherField];
    if (!otherConfirmed) {
      const otherParty = amOffering ? latest.requestedUserId : latest.offeringUserId;
      await notify(otherParty, 'SWAP_UPDATE', `${user.name} confirmed they received your item`, latest.id);
      return { swap: latest, completed: false };
    }

    // Both confirmed: attempt completion via shipment-delivery gate.
    // If both shipments are DELIVERED, tryCompleteSwap atomically completes.
    // If not, we just return the updated swap — completion waits for delivery.
    const completed = await tryCompleteSwap(id);
    const finalSwap = await prisma.swap.findUniqueOrThrow({ where: { id }, include: swapInclude });

    if (completed) {
      const otherParty = amOffering ? finalSwap.requestedUserId : finalSwap.offeringUserId;
      await notify(otherParty, 'SWAP_UPDATE', 'Swap completed - rate the other party', finalSwap.id);
      await notify(finalSwap.offeringUserId, 'SWAP_UPDATE', 'Swap completed - rate the other party', finalSwap.id);
    }

    return { swap: finalSwap, completed };
  });

  // Either party can back out until the swap is in motion (no confirmations yet).
  app.post('/swaps/:id/cancel', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await getParticipantSwap(id, user.id);
    if (!swap) throw new HttpError(404, 'Swap not found');

    if (swap.status === SwapStatus.REQUESTED) {
      const updated = await withSerializableRetry(async (tx) => {
        const released = await tx.swap.update({
          where: { id },
          data: { status: SwapStatus.CANCELLED, cancelledAt: new Date() },
          include: swapInclude,
        });
        await releaseItems(tx, [swap.offeringItemId, swap.requestedItemId]);
        return released;
      });
      const otherParty = updated.offeringUserId === user.id ? updated.requestedUserId : updated.offeringUserId;
      await notify(otherParty, 'SWAP_UPDATE', `${user.name} cancelled the swap`, updated.id);
      return { swap: updated };
    }

    if (swap.status === SwapStatus.AGREED || swap.status === SwapStatus.PAID) {
      const inMotion = await hasShipmentsInMotion(swap.id);
      if (inMotion) {
        throw new HttpError(409, 'Swap is already in motion; it cannot be cancelled');
      }
      const updated = await settleCancelledSwap(swap, SwapStatus.CANCELLED);
      const otherParty = updated.offeringUserId === user.id ? updated.requestedUserId : updated.offeringUserId;
      await notify(otherParty, 'SWAP_UPDATE', `${user.name} cancelled the swap`, updated.id);
      return { swap: updated };
    }

    throw new HttpError(409, `Cannot cancel: swap is ${swap.status.toLowerCase()}`);
  });

  // Manual expiry for a swap that outlived its deadline (the sweeper does this
  // automatically, but this makes it testable and lets a user nudge it).
  app.post('/swaps/:id/expire', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await getParticipantSwap(id, user.id);
    if (!swap) throw new HttpError(404, 'Swap not found');
    if (swap.status !== SwapStatus.AGREED && swap.status !== SwapStatus.PAID) {
      throw new HttpError(409, `Cannot expire: swap is ${swap.status.toLowerCase()}`);
    }
    if (swap.expiresAt && swap.expiresAt > new Date()) {
      throw new HttpError(409, 'Swap has not expired yet');
    }
    const inMotion = await hasShipmentsInMotion(swap.id);
    if (inMotion) {
      throw new HttpError(409, 'Swap is in motion; it cannot be expired');
    }

    const updated = await settleCancelledSwap(swap, SwapStatus.EXPIRED);
    return { swap: updated };
  });
};

export { swapRoutes };
