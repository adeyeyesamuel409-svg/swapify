import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ItemStatus, Prisma, SwapStatus, prisma } from '@swapify/db';
import { HttpError, assertNoActiveSwap, computeGap, withSerializableRetry } from '../services/swaps.js';

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
};

async function releaseItems(tx: Prisma.TransactionClient, itemIds: string[]) {
  await tx.item.updateMany({
    where: { id: { in: itemIds } },
    data: { status: ItemStatus.ACTIVE },
  });
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

      const gap = computeGap(offeringItem.valueMicroTokens, requestedItem.valueMicroTokens);

      const swap = await tx.swap.create({
        data: {
          offeringUserId: user.id,
          offeringItemId,
          requestedUserId: requestedItem.ownerId,
          requestedItemId,
          gapMicroTokens: gap.gapMicroTokens,
          gapPayer: gap.gapPayer,
          status: SwapStatus.REQUESTED,
          // Swaps auto-expire if nobody acts on them (escrow handles the rest later).
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
        include: swapInclude,
      });

      // Reserve both items so nobody double-swaps them.
      await tx.item.updateMany({
        where: { id: { in: [offeringItemId, requestedItemId] } },
        data: { status: ItemStatus.RESERVED },
      });

      return swap;
    });

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

    return { swap };
  });

  // Either party can back out while the swap is only a request.
  app.post('/swaps/:id/cancel', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await withSerializableRetry(async (tx) => {
      const existing = await tx.swap.findUnique({ where: { id } });
      if (!existing || (existing.offeringUserId !== user.id && existing.requestedUserId !== user.id)) {
        throw new HttpError(404, 'Swap not found');
      }
      if (existing.status !== SwapStatus.REQUESTED) {
        // Once agreed, money may be in escrow - that flow lands in Sprint 5.
        throw new HttpError(409, `Cannot cancel: swap is ${existing.status.toLowerCase()}`);
      }

      const updated = await tx.swap.update({
        where: { id },
        data: { status: SwapStatus.CANCELLED, cancelledAt: new Date() },
        include: swapInclude,
      });

      await releaseItems(tx, [existing.offeringItemId, existing.requestedItemId]);
      return updated;
    });

    return { swap };
  });
};

export { swapRoutes };
