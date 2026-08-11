import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ItemStatus, PaymentStatus, Prisma, Swap, SwapStatus, prisma } from '@swapify/db';
import { calculateServiceFee } from '@swapify/shared';
import { HttpError, assertNoActiveSwap, computeGap, withSerializableRetry } from '../services/swaps.js';
import { createSwapPaymentCheckout, refundSwapPayment } from '../services/stripe.js';
import { notify } from '../services/notifications.js';

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
// and lands the swap in CANCELLED or EXPIRED. Only valid before either party
// confirms receipt - once an item is in motion it needs admin help.
async function settleCancelledSwap(swap: Swap, finalStatus: SwapStatus): Promise<Swap> {
  if (swap.status === SwapStatus.PAID) {
    const payment = await prisma.payment.findUnique({ where: { swapId: swap.id } });
    if (payment) {
      await refundSwapPayment(payment.id);
    }
  }

  const now = new Date();
  const updated = await prisma.swap.update({
    where: { id: swap.id },
    data: { status: finalStatus, cancelledAt: now },
    include: swapInclude,
  });

  await prisma.item.updateMany({
    where: { id: { in: [swap.offeringItemId, swap.requestedItemId] } },
    data: { status: ItemStatus.ACTIVE },
  });

  return updated;
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

      return tx.swap.update({
        where: { id },
        data: {
          status: SwapStatus.AGREED,
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
        include: swapInclude,
      });
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

  // Each party confirms they received the other's item. When both have, the
  // swap completes and ownership of both items transfers.
  app.post('/swaps/:id/confirm', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await getParticipantSwap(id, user.id);
    if (!swap) throw new HttpError(404, 'Swap not found');

    if (swap.gapPence > 0) {
      // With a value gap, the payer must have paid before anyone confirms.
      if (swap.status !== SwapStatus.PAID) {
        throw new HttpError(409, 'The gap payment must be completed before confirming receipt');
      }
    } else if (swap.status !== SwapStatus.AGREED) {
      throw new HttpError(409, `Cannot confirm: swap is ${swap.status.toLowerCase()}`);
    }

    const amOffering = swap.offeringUserId === user.id;
    const myField = amOffering ? 'offeringUserConfirmedAt' : 'requestedUserConfirmedAt';
    const now = new Date();

    let updated = swap;
    if (!swap[myField]) {
      updated = await prisma.swap.update({
        where: { id },
        data: { [myField]: now },
        include: swapInclude,
      });
    }

    const otherConfirmed = amOffering
      ? updated.requestedUserConfirmedAt
      : updated.offeringUserConfirmedAt;

    if (otherConfirmed) {
      // Both sides received their item - transfer ownership and close the swap.
      await prisma.$transaction([
        prisma.item.update({
          where: { id: updated.offeringItemId },
          data: { ownerId: updated.requestedUserId, status: ItemStatus.SWAPPED },
        }),
        prisma.item.update({
          where: { id: updated.requestedItemId },
          data: { ownerId: updated.offeringUserId, status: ItemStatus.SWAPPED },
        }),
      ]);

      updated = await prisma.swap.update({
        where: { id },
        data: { status: SwapStatus.COMPLETED, completedAt: now },
        include: swapInclude,
      });

      const otherParty = amOffering ? updated.requestedUserId : updated.offeringUserId;
      await notify(otherParty, 'SWAP_UPDATE', 'Swap completed - rate the other party', updated.id);
      await notify(updated.offeringUserId, 'SWAP_UPDATE', 'Swap completed - rate the other party', updated.id);
    } else {
      const otherParty = amOffering ? updated.requestedUserId : updated.offeringUserId;
      await notify(otherParty, 'SWAP_UPDATE', `${user.name} confirmed they received your item`, updated.id);
    }

    return { swap: updated };
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
      if (swap.offeringUserConfirmedAt || swap.requestedUserConfirmedAt) {
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
    if (swap.offeringUserConfirmedAt || swap.requestedUserConfirmedAt) {
      throw new HttpError(409, 'Swap is in motion; it cannot be expired');
    }

    const updated = await settleCancelledSwap(swap, SwapStatus.EXPIRED);
    return { swap: updated };
  });
};

export { swapRoutes };
