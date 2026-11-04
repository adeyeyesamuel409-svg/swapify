import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';
import { notify } from '../services/notifications.js';

const itemParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const inquiryParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const sendSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
} as const;

// Loads an inquiry and checks the caller is one of its two participants
// (buyer or the item's owner). Returns null otherwise.
async function inquiryFor(inquiryId: string, userId: string) {
  const inquiry = await prisma.itemInquiry.findUnique({
    where: { id: inquiryId },
    include: {
      item: { select: { id: true, title: true, ownerId: true } },
    },
  });
  if (!inquiry) return null;
  if (inquiry.buyerId !== userId && inquiry.item.ownerId !== userId) return null;
  return inquiry;
}

const inquiryRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Open (or fetch) my inquiry thread with the seller of an item.
  app.post('/items/:id/inquiries', { preHandler: [app.authenticate], schema: itemParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const item = await prisma.item.findUnique({
      where: { id },
      include: { images: { take: 1, orderBy: { position: 'asc' } } },
    });
    if (!item || item.status === 'DELETED') {
      return reply.code(404).send({ error: 'Item not found' });
    }
    if (item.ownerId === user.id) {
      return reply.code(400).send({ error: "You can't ask questions about your own listing." });
    }

    const inquiry = await prisma.itemInquiry.upsert({
      where: { itemId_buyerId: { itemId: id, buyerId: user.id } },
      update: {},
      create: { itemId: id, buyerId: user.id },
    });

    return { inquiry: { id: inquiry.id, itemId: item.id, buyerId: user.id, sellerId: item.ownerId, item } };
  });

  // My inquiry threads (buyer and seller sides), newest activity first.
  app.get('/users/me/inquiries', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const inquiries = await prisma.itemInquiry.findMany({
      where: {
        OR: [{ buyerId: user.id }, { item: { ownerId: user.id } }],
      },
      include: {
        item: {
          select: {
            id: true,
            title: true,
            status: true,
            ownerId: true,
            images: { take: 1, orderBy: { position: 'asc' } },
          },
        },
        buyer: { select: { id: true, name: true, imageUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const result = inquiries.map((inquiry) => {
      const iAmBuyer = inquiry.buyerId === user.id;
      const last = inquiry.messages[0] ?? null;
      const myReadAt = iAmBuyer ? inquiry.buyerReadAt : inquiry.sellerReadAt;
      const unread = Boolean(last && last.senderId !== user.id && (!myReadAt || last.createdAt > myReadAt));
      return {
        id: inquiry.id,
        itemId: inquiry.item.id,
        itemTitle: inquiry.item.title,
        itemStatus: inquiry.item.status,
        itemImage: inquiry.item.images[0]?.url ?? null,
        counterparty: iAmBuyer
          ? { id: inquiry.item.ownerId, name: null as string | null }
          : { id: inquiry.buyer.id, name: inquiry.buyer.name },
        buyer: { id: inquiry.buyer.id, name: inquiry.buyer.name, imageUrl: inquiry.buyer.imageUrl },
        iAmBuyer,
        lastMessage: last ? { body: last.body, senderId: last.senderId, createdAt: last.createdAt } : null,
        unread,
        updatedAt: inquiry.updatedAt,
      };
    });

    result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { inquiries: result };
  });

  // Chat history for an inquiry. Opening it marks it read on my side.
  app.get('/inquiries/:id/messages', { preHandler: [app.authenticate], schema: inquiryParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const inquiry = await inquiryFor(id, user.id);
    if (!inquiry) return reply.code(404).send({ error: 'Inquiry not found' });

    const iAmBuyer = inquiry.buyerId === user.id;
    await prisma.itemInquiry.update({
      where: { id },
      data: iAmBuyer ? { buyerReadAt: new Date() } : { sellerReadAt: new Date() },
    });

    const messages = await prisma.inquiryMessage.findMany({
      where: { inquiryId: id },
      include: { sender: { select: { id: true, name: true, imageUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { messages };
  });

  // Send a message on an inquiry (question or reply).
  app.post(
    '/inquiries/:id/messages',
    { preHandler: [app.authenticate], schema: sendSchema, config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { body } = request.body as { body: string };
      const inquiry = await inquiryFor(id, user.id);
      if (!inquiry) return reply.code(404).send({ error: 'Inquiry not found' });

      const message = await prisma.inquiryMessage.create({
        data: { inquiryId: id, senderId: user.id, body },
        include: { sender: { select: { id: true, name: true, imageUrl: true } } },
      });

      // Keep thread ordering fresh and my own read pointer current.
      const iAmBuyer = inquiry.buyerId === user.id;
      await prisma.itemInquiry.update({
        where: { id },
        data: { updatedAt: new Date(), ...(iAmBuyer ? { buyerReadAt: new Date() } : { sellerReadAt: new Date() }) },
      });

      const otherParty = iAmBuyer ? inquiry.item.ownerId : inquiry.buyerId;
      await notify(
        otherParty,
        'MESSAGE',
        `New message about "${inquiry.item.title}" from ${user.name}`,
        inquiry.id,
      );

      return { message };
    },
  );
};

export { inquiryRoutes };
