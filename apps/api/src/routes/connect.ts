import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import {
  createConnectedAccount,
  createOnboardingLink,
  listExternalAccounts,
  syncConnectedAccountStatus,
} from '../services/stripe-connect.js';

// ---------------------------------------------------------------------------
// Connect onboarding routes — authenticated, current-user only.
//
// These endpoints manage the Stripe Express connected-account lifecycle
// for the authenticated user. Users are never exposed to Stripe's
// dashboard or required to create a separate Stripe account.
//
// Regulatory note: This service implements Stripe Connect infrastructure
// for disbursement. Regulatory classification of Swapify's payment
// activities requires UK fintech/payment-services legal review.
// ---------------------------------------------------------------------------

const connectRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /users/me/connect/status — current user's connected-account status.
  app.get('/users/me/connect/status', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const account = await prisma.connectedAccount.findUnique({ where: { userId } });

    if (!account) {
      return { connected: false, status: 'NONE' as const };
    }

    return {
      connected: true,
      stripeAccountId: account.stripeAccountId,
      status: account.status,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      requirementsDue: account.requirementsDue,
      onboardedAt: account.onboardedAt?.toISOString() ?? null,
    };
  });

  // POST /users/me/connect/onboarding — create or resume onboarding.
  app.post('/users/me/connect/onboarding', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const userEmail = request.user!.email ?? `${userId}@swapify.app`;
    const returnBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

    const { stripeAccountId, status } = await createConnectedAccount(userId, userEmail);

    if (status === 'ACTIVE') {
      return { status: 'ACTIVE' as const, message: 'Payout details are already set up' };
    }

    const { url } = await createOnboardingLink(stripeAccountId, returnBaseUrl);

    return { url, status };
  });

  // POST /users/me/connect/sync — sync connected-account status and payout methods.
  //
  // Called after the user returns from Stripe onboarding (or periodically)
  // to refresh the local ConnectedAccount record and create/update PayoutMethod
  // records from the Stripe external accounts.
  app.post('/users/me/connect/sync', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const account = await prisma.connectedAccount.findUnique({ where: { userId } });

    if (!account) {
      return { synced: false, error: 'No connected account' };
    }

    // Sync the connected account status from Stripe
    await syncConnectedAccountStatus(account.stripeAccountId);

    // Sync external accounts (bank accounts) to PayoutMethod records
    const externalAccounts = await listExternalAccounts(account.stripeAccountId);

    const syncedMethods = [];
    for (const ea of externalAccounts) {
      const existing = await prisma.payoutMethod.findFirst({
        where: { userId, stripeMethodRef: ea.id },
      });

      if (existing) {
        // Update display info in case it changed
        const updated = await prisma.payoutMethod.update({
          where: { id: existing.id },
          data: { isDefault: ea.default },
        });
        syncedMethods.push(updated);
      } else {
        const created = await prisma.payoutMethod.create({
          data: {
            userId,
            type: 'BANK_TRANSFER',
            displayName: `Bank ****${ea.last4}`,
            last4: ea.last4,
            bankName: ea.bankName,
            stripeMethodRef: ea.id,
            isDefault: ea.default,
            isActive: true,
          },
        });
        syncedMethods.push(created);
      }
    }

    // Reload the connected account (status may have changed)
    const refreshed = await prisma.connectedAccount.findUnique({ where: { userId } });

    return {
      synced: true,
      status: refreshed?.status,
      payoutsEnabled: refreshed?.payoutsEnabled,
      payoutMethods: syncedMethods.map((pm) => ({
        id: pm.id,
        displayName: pm.displayName,
        last4: pm.last4,
        bankName: pm.bankName,
        isDefault: pm.isDefault,
      })),
    };
  });

  // GET /users/me/connect/payout-methods — list payout methods for current user.
  app.get('/users/me/connect/payout-methods', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const methods = await prisma.payoutMethod.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        displayName: true,
        last4: true,
        bankName: true,
        isDefault: true,
        type: true,
        createdAt: true,
      },
    });
    return { payoutMethods: methods };
  });
};

export { connectRoutes };
