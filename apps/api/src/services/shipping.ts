import { ItemStatus, ShipmentStatus, SwapStatus, prisma, Prisma } from '@swapify/db';
import { HttpError } from './swaps.js';
import { withSerializableRetry } from './swaps.js';
import { AddressSnapshot, getShippingProvider } from './shipping-provider.js';
import { notify } from './notifications.js';
import { SHIPMENT_PAYMENT_DEADLINE_DAYS, SHIPMENT_SHIP_DEADLINE_DAYS } from '@swapify/shared';

// ---------------------------------------------------------------------------
// Create shipments (idempotent — called at AGREED for equal-value, PAID for
// value-gap). Uses upsert so retries/duplicate calls are safe.
// ---------------------------------------------------------------------------

export async function createSwapShipments(
  tx: Prisma.TransactionClient,
  swapId: string,
  now: Date,
): Promise<void> {
  const swap = await tx.swap.findUniqueOrThrow({
    where: { id: swapId },
    select: {
      id: true,
      offeringUserId: true,
      offeringItemId: true,
      requestedUserId: true,
      requestedItemId: true,
      offeringUser: { select: { id: true, addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], take: 1 } } },
      requestedUser: { select: { id: true, addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], take: 1 } } },
    },
  });

  const postageDeadline = new Date(now.getTime() + SHIPMENT_PAYMENT_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
  const shipDeadline = new Date(now.getTime() + SHIPMENT_SHIP_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

  // Offering user ships to requested user — parcel goes TO requested user's address
  const requestedAddr = swap.requestedUser.addresses[0];
  await tx.shipment.upsert({
    where: { swapId_senderUserId: { swapId, senderUserId: swap.offeringUserId } },
    create: {
      swapId,
      senderUserId: swap.offeringUserId,
      receiverUserId: swap.requestedUserId,
      itemId: swap.offeringItemId,
      status: ShipmentStatus.PENDING,
      addressLine1: requestedAddr?.line1 ?? null,
      addressLine2: requestedAddr?.line2 ?? null,
      addressCity: requestedAddr?.city ?? null,
      addressPostcode: requestedAddr?.postcode ?? null,
      addressCountry: requestedAddr?.country ?? null,
      postageDeadline,
      shipDeadline,
    },
    update: {},
  });

  // Requested user ships to offering user — parcel goes TO offering user's address
  const offeringAddr = swap.offeringUser.addresses[0];
  await tx.shipment.upsert({
    where: { swapId_senderUserId: { swapId, senderUserId: swap.requestedUserId } },
    create: {
      swapId,
      senderUserId: swap.requestedUserId,
      receiverUserId: swap.offeringUserId,
      itemId: swap.requestedItemId,
      status: ShipmentStatus.PENDING,
      addressLine1: offeringAddr?.line1 ?? null,
      addressLine2: offeringAddr?.line2 ?? null,
      addressCity: offeringAddr?.city ?? null,
      addressPostcode: offeringAddr?.postcode ?? null,
      addressCountry: offeringAddr?.country ?? null,
      postageDeadline,
      shipDeadline,
    },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Update a shipment's delivery address snapshot (receiver selects address)
// ---------------------------------------------------------------------------

export async function updateShipmentAddress(
  shipmentId: string,
  userId: string,
  address: { line1: string; line2?: string | null; city: string; postcode: string; country?: string },
): Promise<void> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.receiverUserId !== userId) throw new HttpError(403, 'Only the receiver can set the delivery address');
  if (shipment.status !== ShipmentStatus.PENDING) throw new HttpError(409, 'Address can only be set before postage is purchased');

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      addressLine1: address.line1,
      addressLine2: address.line2 ?? null,
      addressCity: address.city,
      addressPostcode: address.postcode,
      addressCountry: address.country ?? 'GB',
    },
  });
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export async function getShipmentForUser(shipmentId: string, userId: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      swap: { select: { id: true, status: true, offeringUserId: true, requestedUserId: true } },
      item: { select: { id: true, title: true, valuePence: true, images: { orderBy: { position: 'asc' }, take: 1 } } },
      sender: { select: { id: true, name: true, imageUrl: true } },
      receiver: { select: { id: true, name: true, imageUrl: true } },
      payment: true,
    },
  });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.senderUserId !== userId && shipment.receiverUserId !== userId) {
    throw new HttpError(403, 'Not a participant of this shipment');
  }
  return shipment;
}

export async function getSwapShipments(swapId: string, userId: string) {
  const swap = await prisma.swap.findUnique({
    where: { id: swapId },
    select: { offeringUserId: true, requestedUserId: true, status: true },
  });
  if (!swap) throw new HttpError(404, 'Swap not found');
  if (swap.offeringUserId !== userId && swap.requestedUserId !== userId) {
    throw new HttpError(403, 'Not a participant of this swap');
  }
  const shipments = await prisma.shipment.findMany({
    where: { swapId },
    include: {
      item: { select: { id: true, title: true, valuePence: true, images: { orderBy: { position: 'asc' }, take: 1 } } },
      sender: { select: { id: true, name: true, imageUrl: true } },
      receiver: { select: { id: true, name: true, imageUrl: true } },
      payment: true,
    },
  });
  return shipments;
}

// ---------------------------------------------------------------------------
// Get rates
// ---------------------------------------------------------------------------

export async function getRates(shipmentId: string, userId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.senderUserId !== userId) throw new HttpError(403, 'Only the sender can view rates');
  if (shipment.status !== ShipmentStatus.PENDING) throw new HttpError(409, 'Postage already handled for this shipment');

  const provider = getShippingProvider();
  const rates = await provider.getRates(shipment.addressPostcode ?? 'SW1A 1AA', 'SW1A 1AA', 1000);
  return rates;
}

// ---------------------------------------------------------------------------
// Purchase label
// ---------------------------------------------------------------------------

export async function purchaseLabel(
  shipmentId: string,
  userId: string,
  carrier: string,
  service: string,
): Promise<void> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.senderUserId !== userId) throw new HttpError(403, 'Only the sender can purchase postage');
  if (shipment.status !== ShipmentStatus.PENDING) throw new HttpError(409, 'Postage already handled');

  const provider = getShippingProvider();
  const rates = await provider.getRates(shipment.addressPostcode ?? 'SW1A 1AA', 'SW1A 1AA', 1000);
  const rate = rates.find(r => r.carrier === carrier && r.service === service);
  if (!rate) throw new HttpError(400, 'Invalid carrier/service combination');

  const senderAddress: AddressSnapshot = {
    line1: shipment.addressLine1 ?? '',
    line2: shipment.addressLine2,
    city: shipment.addressCity ?? '',
    postcode: shipment.addressPostcode ?? '',
    country: shipment.addressCountry ?? 'GB',
  };

  const receiverShipment = await prisma.shipment.findFirst({
    where: { swapId: shipment.swapId, senderUserId: shipment.receiverUserId },
  });
  const receiverAddress: AddressSnapshot = {
    line1: receiverShipment?.addressLine1 ?? '',
    line2: receiverShipment?.addressLine2,
    city: receiverShipment?.addressCity ?? '',
    postcode: receiverShipment?.addressPostcode ?? '',
    country: receiverShipment?.addressCountry ?? 'GB',
  };

  const result = await provider.purchaseLabel(rate, senderAddress, receiverAddress);

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: ShipmentStatus.LABEL_READY,
      carrier: result.carrier,
      service: result.service,
      providerShipmentId: result.providerShipmentId,
      providerLabelId: result.providerLabelId,
      trackingNumber: result.trackingNumber,
      trackingUrl: result.trackingUrl,
      labelUrl: result.labelUrl,
      postagePence: result.pricePence,
      postageDeadline: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Mark shipped (sender only)
// ---------------------------------------------------------------------------

export async function markShipped(shipmentId: string, userId: string): Promise<void> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.senderUserId !== userId) throw new HttpError(403, 'Only the sender can mark as shipped');
  if (shipment.status !== ShipmentStatus.LABEL_READY) throw new HttpError(409, 'Shipment must have a label before marking as shipped');

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: ShipmentStatus.IN_TRANSIT, shippedAt: new Date(), shipDeadline: null },
  });

  await notify(shipment.receiverUserId, 'SWAP_UPDATE', 'Your swap item has been shipped', shipment.swapId);
}

// ---------------------------------------------------------------------------
// Mark delivered (receiver or carrier webhook). Idempotent: already DELIVERED
// is a no-op. After delivery, attempts swap completion if both legs delivered.
// ---------------------------------------------------------------------------

export async function markDelivered(shipmentId: string, userId: string): Promise<void> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.receiverUserId !== userId) throw new HttpError(403, 'Only the receiver can mark as delivered');
  if (shipment.status === ShipmentStatus.DELIVERED) return; // idempotent
  if (shipment.status !== ShipmentStatus.IN_TRANSIT) throw new HttpError(409, 'Shipment must be in transit');

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() },
  });

  await notify(shipment.senderUserId, 'SWAP_UPDATE', 'Your swap item has been delivered', shipment.swapId);

  // Attempt swap completion if both legs are now DELIVERED
  await tryCompleteSwap(shipment.swapId);
}

// ---------------------------------------------------------------------------
// Cancel shipment (sender only)
// ---------------------------------------------------------------------------

export async function cancelShipment(shipmentId: string, userId: string): Promise<void> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.senderUserId !== userId) throw new HttpError(403, 'Only the sender can cancel a shipment');
  if (shipment.status === ShipmentStatus.DELIVERED) throw new HttpError(409, 'Cannot cancel delivered shipment');
  if (shipment.status === ShipmentStatus.CANCELLED) throw new HttpError(409, 'Shipment already cancelled');

  if (shipment.providerShipmentId) {
    const provider = getShippingProvider();
    await provider.cancelShipment(shipment.providerShipmentId);
  }

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: ShipmentStatus.CANCELLED, cancelledAt: new Date(), postageDeadline: null, shipDeadline: null },
  });

  await notify(shipment.receiverUserId, 'SWAP_UPDATE', 'A swap shipment has been cancelled', shipment.swapId);
}

// ---------------------------------------------------------------------------
// Cancel all shipments for a swap (best-effort cascade)
// ---------------------------------------------------------------------------

export async function cancelSwapShipments(tx: Prisma.TransactionClient, swapId: string, now: Date): Promise<void> {
  const activeShipments = await tx.shipment.findMany({
    where: { swapId, status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED] } },
  });

  for (const shipment of activeShipments) {
    if (shipment.providerShipmentId) {
      try {
        const provider = getShippingProvider();
        await provider.cancelShipment(shipment.providerShipmentId);
      } catch {
        // Best-effort
      }
    }

    await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.CANCELLED, cancelledAt: now, postageDeadline: null, shipDeadline: null },
    });
  }
}

// ---------------------------------------------------------------------------
// Check if a swap's shipments are in motion (IN_TRANSIT or DELIVERED).
// Used by cancel/expire guards.
// ---------------------------------------------------------------------------

export async function hasShipmentsInMotion(swapId: string): Promise<boolean> {
  const count = await prisma.shipment.count({
    where: { swapId, status: { in: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED] } },
  });
  return count > 0;
}

// ---------------------------------------------------------------------------
// Try to complete a swap: if both shipments are DELIVERED, atomically
// transition to COMPLETED and transfer ownership. Concurrency-safe via
// serializable retry + conditional updateMany.
// ---------------------------------------------------------------------------

export async function tryCompleteSwap(swapId: string): Promise<boolean> {
  const result = await withSerializableRetry(async (tx) => {
    const swap = await tx.swap.findUnique({ where: { id: swapId } });
    if (!swap) return false;

    const equalValue = swap.gapPence === 0;
    const eligibleStatus = equalValue ? SwapStatus.AGREED : SwapStatus.PAID;
    if (swap.status !== eligibleStatus) return false;

    // Both shipments must exist and be DELIVERED (ignore CANCELLED legs)
    const shipments = await tx.shipment.findMany({
      where: { swapId, status: { not: ShipmentStatus.CANCELLED } },
      select: { status: true },
    });
    if (shipments.length !== 2) return false;
    if (!shipments.every(s => s.status === ShipmentStatus.DELIVERED)) return false;

    const now = new Date();
    const claimed = await tx.swap.updateMany({
      where: { id: swapId, status: eligibleStatus },
      data: { status: SwapStatus.COMPLETED, completedAt: now },
    });
    if (claimed.count === 0) return false;

    await tx.item.updateMany({
      where: { id: swap.offeringItemId },
      data: { ownerId: swap.requestedUserId, status: ItemStatus.SWAPPED },
    });
    await tx.item.updateMany({
      where: { id: swap.requestedItemId },
      data: { ownerId: swap.offeringUserId, status: ItemStatus.SWAPPED },
    });

    return true;
  });

  if (result) {
    const swap = await prisma.swap.findUniqueOrThrow({ where: { id: swapId } });
    const otherParty = swap.offeringUserId;
    const secondParty = swap.requestedUserId;
    await notify(otherParty, 'SWAP_UPDATE', 'Swap completed - rate the other party', swapId);
    await notify(secondParty, 'SWAP_UPDATE', 'Swap completed - rate the other party', swapId);
  }

  return result;
}
