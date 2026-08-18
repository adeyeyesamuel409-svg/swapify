import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';
import {
  getShipmentForUser,
  getSwapShipments,
  getRates,
  purchaseLabel,
  markShipped,
  markDelivered,
  cancelShipment,
} from '../services/shipping.js';
import { tryCompleteSwap } from '../services/shipping.js';

// ---------------------------------------------------------------------------
// JSON Schemas
// ---------------------------------------------------------------------------

const shipmentParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const swapShipmentsParamsSchema = {
  params: {
    type: 'object',
    required: ['swapId'],
    properties: { swapId: { type: 'string' } },
  },
} as const;

const purchaseLabelSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['carrier', 'service'],
    properties: {
      carrier: { type: 'string' },
      service: { type: 'string' },
    },
  },
} as const;

const addressParamsSchema = {
  params: {
    type: 'object',
    required: ['addressId'],
    properties: { addressId: { type: 'string' } },
  },
} as const;

const addressBodySchema = {
  body: {
    type: 'object',
    required: ['label', 'line1', 'city', 'postcode'],
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 50 },
      line1: { type: 'string', minLength: 1, maxLength: 200 },
      line2: { type: 'string', maxLength: 200 },
      city: { type: 'string', minLength: 1, maxLength: 100 },
      postcode: { type: 'string', minLength: 1, maxLength: 20 },
      country: { type: 'string', minLength: 2, maxLength: 3 },
      isDefault: { type: 'boolean' },
    },
  },
} as const;



// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const shippingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // ── Address Book ─────────────────────────────────────────────────────────

  // List addresses
  app.get('/addresses', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const addresses = await prisma.userAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { addresses };
  });

  // Create address
  app.post('/addresses', { preHandler: [app.authenticate], schema: { ...addressBodySchema, params: { type: 'object', required: [], properties: {} } as const } }, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      label: string;
      line1: string;
      line2?: string;
      city: string;
      postcode: string;
      country?: string;
      isDefault?: boolean;
    };

    const count = await prisma.userAddress.count({ where: { userId: user.id } });
    if (count >= 10) throw new HttpError(400, 'Maximum 10 saved addresses per user');

    if (body.isDefault) {
      await prisma.userAddress.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
    }

    const address = await prisma.userAddress.create({
      data: {
        userId: user.id,
        label: body.label,
        line1: body.line1,
        line2: body.line2 ?? null,
        city: body.city,
        postcode: body.postcode,
        country: body.country ?? 'GB',
        isDefault: body.isDefault ?? false,
      },
    });

    return reply.code(201).send({ address });
  });

  // Update address
  app.patch('/addresses/:addressId', { preHandler: [app.authenticate], schema: addressBodySchema }, async (request) => {
    const user = request.user!;
    const { addressId } = request.params as { addressId: string };
    const body = request.body as Partial<{
      label: string;
      line1: string;
      line2: string | null;
      city: string;
      postcode: string;
      country: string;
      isDefault: boolean;
    }>;

    const existing = await prisma.userAddress.findUnique({ where: { id: addressId } });
    if (!existing || existing.userId !== user.id) throw new HttpError(404, 'Address not found');

    if (body.isDefault) {
      await prisma.userAddress.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
    }

    const address = await prisma.userAddress.update({
      where: { id: addressId },
      data: body,
    });

    return { address };
  });

  // Delete address
  app.delete('/addresses/:addressId', { preHandler: [app.authenticate], schema: addressParamsSchema }, async (request) => {
    const user = request.user!;
    const { addressId } = request.params as { addressId: string };

    const existing = await prisma.userAddress.findUnique({ where: { id: addressId } });
    if (!existing || existing.userId !== user.id) throw new HttpError(404, 'Address not found');

    await prisma.userAddress.delete({ where: { id: addressId } });
    return { ok: true };
  });

  // ── Shipments ────────────────────────────────────────────────────────────

  // Get shipments for a swap
  app.get('/swaps/:swapId/shipments', { preHandler: [app.authenticate], schema: swapShipmentsParamsSchema }, async (request) => {
    const user = request.user!;
    const { swapId } = request.params as { swapId: string };
    const shipments = await getSwapShipments(swapId, user.id);
    return { shipments };
  });

  // Get a single shipment
  app.get('/shipments/:id', { preHandler: [app.authenticate], schema: shipmentParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const shipment = await getShipmentForUser(id, user.id);
    return { shipment };
  });

  // Get rates for a shipment
  app.get('/shipments/:id/rates', { preHandler: [app.authenticate], schema: shipmentParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const rates = await getRates(id, user.id);
    return { rates };
  });

  // Purchase postage label
  app.post('/shipments/:id/label', { preHandler: [app.authenticate], schema: purchaseLabelSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { carrier, service } = request.body as { carrier: string; service: string };
    await purchaseLabel(id, user.id, carrier, service);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id } });
    return { shipment };
  });

  // Mark as shipped (sender only, must have label)
  app.post('/shipments/:id/ship', { preHandler: [app.authenticate], schema: shipmentParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    await markShipped(id, user.id);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id } });
    return { shipment };
  });

  // Mark as delivered (receiver only)
  app.post('/shipments/:id/deliver', { preHandler: [app.authenticate], schema: shipmentParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    await markDelivered(id, user.id);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id } });
    return { shipment };
  });

  // Cancel a shipment (sender only)
  app.post('/shipments/:id/cancel', { preHandler: [app.authenticate], schema: shipmentParamsSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    await cancelShipment(id, user.id);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id } });
    return { shipment };
  });

  // ── Shipping webhook (provider → Swapify) ────────────────────────────────

  app.post('/webhooks/shipping', async (request) => {
    const rawBody = request.rawBody;
    const signature = request.headers['x-webhook-signature'] as string ?? '';

    const provider = (await import('../services/shipping-provider.js')).getShippingProvider();
    if (!provider.verifyWebhookSignature(rawBody ?? '', signature)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }

    const event = request.body as {
      type: string;
      data: {
        providerShipmentId: string;
        status: string;
        trackingNumber?: string;
        trackingUrl?: string;
      };
    };

    if (event.type === 'shipment.status_changed') {
      const { providerShipmentId, status, trackingUrl } = event.data;
      const shipment = await prisma.shipment.findFirst({ where: { providerShipmentId } });
      if (!shipment) return { received: true };

      // Allowed forward transitions only — no regression (DELIVERED → IN_TRANSIT forbidden)
      const statusPriority: Record<string, number> = {
        PENDING: 0,
        LABEL_READY: 1,
        IN_TRANSIT: 2,
        DELIVERED: 3,
        CANCELLED: -1,
      };

      const targetPriority = statusPriority[status] ?? -1;
      const currentPriority = statusPriority[shipment.status] ?? -1;
      if (targetPriority < 0 || targetPriority <= currentPriority) {
        return { received: true };
      }

      const updateData: Record<string, unknown> = { status };
      if (status === 'IN_TRANSIT') updateData.shippedAt = new Date();
      if (status === 'DELIVERED') updateData.deliveredAt = new Date();
      if (trackingUrl) updateData.trackingUrl = trackingUrl;

      await prisma.shipment.update({ where: { id: shipment.id }, data: updateData });

      const { notify } = await import('../services/notifications.js');
      if (status === 'IN_TRANSIT') {
        await notify(shipment.receiverUserId, 'SWAP_UPDATE', 'Your swap item has been shipped', shipment.swapId);
      }
      if (status === 'DELIVERED') {
        await notify(shipment.receiverUserId, 'SWAP_UPDATE', 'Your swap item has been delivered', shipment.swapId);
        // Check if both shipments delivered → complete swap
        await tryCompleteSwap(shipment.swapId);
      }
    }

    return { received: true };
  });
};
