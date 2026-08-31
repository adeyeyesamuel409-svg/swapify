// ---------------------------------------------------------------------------
// Stripe Connect service
//
// Handles all Stripe Connect operations: connected-account creation,
// onboarding, transfers, payouts, and balance queries.
//
// Regulatory note: This service implements Stripe Connect infrastructure
// for disbursement. Regulatory classification of Swapify's payment
// activities requires UK fintech/payment-services legal review. This code
// does not make regulatory assumptions.
//
// Source-of-truth boundaries:
//   Swapify owns: user identity, ValueGap lifecycle, swap completion state
//   Stripe owns: provider-held funds, connected-account balance, transfer
//   state, payout execution, bank-account details
// ---------------------------------------------------------------------------

import Stripe from 'stripe';
import { prisma } from '@swapify/db';
import { getStripe, stripeEnabled } from './stripe.js';
import { setDisbursementProvider } from './value-gap.js';
import pino from 'pino';

const log = pino({ name: 'stripe-connect', level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Connected-account status mapping
//
// Maps Stripe account state to a simplified internal status for Swapify.
// Do NOT assume payouts_enabled === permanent eligibility — always handle
// webhooks for state changes.
// ---------------------------------------------------------------------------

export type ConnectedAccountInternalStatus = 'ONBOARDING' | 'ACTIVE' | 'RESTRICTED' | 'DISABLED';

export function mapAccountStatus(account: Stripe.Account): ConnectedAccountInternalStatus {
  if (account.requirements?.disabled_reason) {
    return 'DISABLED';
  }
  if (
    account.requirements?.currently_due &&
    account.requirements.currently_due.length > 0
  ) {
    return 'RESTRICTED';
  }
  if (account.payouts_enabled && account.charges_enabled) {
    return 'ACTIVE';
  }
  return 'ONBOARDING';
}

// ---------------------------------------------------------------------------
// createConnectedAccount
//
// Creates an Express connected account for a Swapify user. The account is
// created server-side; the user never interacts with Stripe directly.
//
// The connected account maps to exactly one Swapify user via ConnectedAccount.
// Duplicate creation for the same user is prevented by the @unique userId
// constraint in the database.
// ---------------------------------------------------------------------------

export async function createConnectedAccount(
  userId: string,
  userEmail: string,
  country: string = 'GB',
): Promise<{ stripeAccountId: string; status: ConnectedAccountInternalStatus }> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot create connected account');
  }

  const existing = await prisma.connectedAccount.findUnique({ where: { userId } });
  if (existing) {
    const account = await getStripe().accounts.retrieve(existing.stripeAccountId);
    const status = mapAccountStatus(account);
    return { stripeAccountId: existing.stripeAccountId, status };
  }

  const account = await getStripe().accounts.create({
    type: 'express',
    country,
    email: userEmail,
    capabilities: {
      transfers: { requested: true },
    },
    metadata: { userId },
    business_type: 'individual',
  });

  const status = mapAccountStatus(account);

  const created = await prisma.connectedAccount.create({
    data: {
      userId,
      stripeAccountId: account.id,
      status,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirementsDue: account.requirements?.currently_due ?? [],
    },
  });

  log.info(
    { userId, stripeAccountId: created.stripeAccountId, status },
    'Connected account created',
  );

  return { stripeAccountId: created.stripeAccountId, status };
}

// ---------------------------------------------------------------------------
// createOnboardingLink
//
// Generates a single-use Stripe-hosted onboarding URL. The user is
// redirected to Stripe, completes verification, and returns to Swapify.
//
// The redirect URL points back to Swapify so the user remains in the
// Swapify product experience as much as possible.
// ---------------------------------------------------------------------------

export async function createOnboardingLink(
  stripeAccountId: string,
  returnBaseUrl: string,
): Promise<{ url: string }> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot create onboarding link');
  }

  const accountLink = await getStripe().accountLinks.create({
    account: stripeAccountId,
    type: 'account_onboarding',
    collection_options: { fields: 'currently_due' },
    return_url: `${returnBaseUrl}/profile?onboarding=complete`,
    refresh_url: `${returnBaseUrl}/profile?onboarding=refresh`,
  });

  log.info({ stripeAccountId }, 'Onboarding link created');

  return { url: accountLink.url };
}

// ---------------------------------------------------------------------------
// getConnectedAccount
//
// Retrieves the Stripe connected account and returns the current state
// including payout eligibility and requirements.
// ---------------------------------------------------------------------------

export async function getConnectedAccount(
  stripeAccountId: string,
): Promise<{
  stripeAccountId: string;
  status: ConnectedAccountInternalStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  requirementsEventuallyDue: string[];
  disabledReason: string | null;
}> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot retrieve connected account');
  }

  const account = await getStripe().accounts.retrieve(stripeAccountId);
  const status = mapAccountStatus(account);

  return {
    stripeAccountId: account.id,
    status,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    requirementsDue: account.requirements?.currently_due ?? [],
    requirementsEventuallyDue: account.requirements?.eventually_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

// ---------------------------------------------------------------------------
// syncConnectedAccountStatus
//
// Synchronises the local ConnectedAccount record with Stripe's current
// state. Called from webhook handlers and reconciliation.
// ---------------------------------------------------------------------------

export async function syncConnectedAccountStatus(
  stripeAccountId: string,
): Promise<void> {
  const account = await getStripe().accounts.retrieve(stripeAccountId);
  const status = mapAccountStatus(account);

  await prisma.connectedAccount.update({
    where: { stripeAccountId },
    data: {
      status,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirementsDue: account.requirements?.currently_due ?? [],
      ...(account.payouts_enabled && !account.requirements?.disabled_reason
        ? { onboardedAt: new Date() }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// createTransfer
//
// Transfers funds from the Swapify platform balance to a connected
// account. Called after ValueGap RELEASED, outside the DB transaction.
//
// Idempotency:
//   - Check ValueGap.externalPayoutRef before calling Stripe.
//   - Use a deterministic idempotency key derived from the ValueGap ID.
//   - If Stripe returns an existing transfer (same idempotency key),
//     it returns the original transfer — safe to persist.
//   - If the app crashes after Stripe succeeds but before DB write,
//     reconciliation detects the transfer via externalPayoutRef query
//     or Stripe metadata and persists it.
// ---------------------------------------------------------------------------

export interface TransferResult {
  transferId: string;
  amount: number;
  currency: string;
  destination: string;
  status: string;
}

export async function createTransfer(params: {
  valueGapId: string;
  swapId: string;
  recipientUserId: string;
  amountPence: number;
  currency?: string;
  destinationStripeAccountId: string;
}): Promise<TransferResult> {
  const {
    valueGapId,
    swapId,
    recipientUserId,
    amountPence,
    currency = 'gbp',
    destinationStripeAccountId,
  } = params;

  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot create transfer');
  }

  if (amountPence <= 0) {
    throw new Error(`Transfer amount must be positive, got ${amountPence}`);
  }

  const idempotencyKey = `value-gap-transfer:${valueGapId}`;

  const transfer = await getStripe().transfers.create(
    {
      amount: amountPence,
      currency,
      destination: destinationStripeAccountId,
      transfer_group: swapId,
      metadata: {
        valueGapId,
        swapId,
        recipientUserId,
      },
    },
    { idempotencyKey },
  );

  log.info(
    {
      transferId: transfer.id,
      valueGapId,
      swapId,
      recipientUserId,
      amountPence,
      destination: destinationStripeAccountId,
    },
    'Transfer created',
  );

  return {
    transferId: transfer.id,
    amount: transfer.amount,
    currency: transfer.currency,
    destination: transfer.destination as string,
    status: transfer.object,
  };
}

// ---------------------------------------------------------------------------
// getTransfer
//
// Retrieves a transfer by ID for reconciliation.
// ---------------------------------------------------------------------------

export async function getTransfer(transferId: string): Promise<Stripe.Transfer> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot retrieve transfer');
  }
  return getStripe().transfers.retrieve(transferId);
}

// ---------------------------------------------------------------------------
// reverseTransfer
//
// Reverses a transfer to the connected account. Required for post-transfer
// refunds/disputes. Must only be called when a legitimate reversal is needed.
// ---------------------------------------------------------------------------

export async function reverseTransfer(params: {
  transferId: string;
  amountPence?: number;
  valueGapId?: string;
}): Promise<Stripe.TransferReversal> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot reverse transfer');
  }

  // Deterministic idempotency key: same reversal attempt always produces the
  // same key, so retries (sweeper, webhook overlap, process crash) never
  // create duplicate reversals. If valueGapId is provided, use it as the
  // primary discriminator; otherwise derive from the transfer ID.
  const idempotencyKey = params.valueGapId
    ? `transfer-reversal:${params.valueGapId}`
    : `transfer-reversal:${params.transferId}:${params.amountPence ?? 'full'}`;

  const reversal = await getStripe().transfers.createReversal(
    params.transferId,
    params.amountPence ? { amount: params.amountPence } : undefined,
    { idempotencyKey },
  );

  log.info(
    { transferId: params.transferId, reversalId: reversal.id, amountPence: params.amountPence, idempotencyKey },
    'Transfer reversed',
  );

  return reversal;
}

// ---------------------------------------------------------------------------
// createPayout
//
// Creates a payout on a connected account (funds move to the user's bank).
// This runs in the connected-account's context via stripeAccount.
//
// Idempotency:
//   - Withdrawal.idempotencyKey is used as the Stripe idempotency key.
//   - Duplicate calls return the existing payout.
// ---------------------------------------------------------------------------

export interface PayoutResult {
  payoutId: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: number | null;
}

export async function createPayout(params: {
  connectedAccountId: string;
  amountPence: number;
  currency?: string;
  idempotencyKey: string;
}): Promise<PayoutResult> {
  const { connectedAccountId, amountPence, currency = 'gbp', idempotencyKey } = params;

  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot create payout');
  }

  const payout = await getStripe().payouts.create(
    {
      amount: amountPence,
      currency,
    },
    {
      stripeAccount: connectedAccountId,
      idempotencyKey,
    },
  );

  log.info(
    {
      payoutId: payout.id,
      connectedAccountId,
      amountPence,
      status: payout.status,
    },
    'Payout created',
  );

  return {
    payoutId: payout.id,
    amount: payout.amount,
    currency: payout.currency,
    status: payout.status,
    arrivalDate: payout.arrival_date,
  };
}

// ---------------------------------------------------------------------------
// getPayout
//
// Retrieves a payout from a connected account.
// ---------------------------------------------------------------------------

export async function getPayout(
  connectedAccountId: string,
  payoutId: string,
): Promise<Stripe.Payout> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot retrieve payout');
  }
  return getStripe().payouts.retrieve(payoutId, {}, {
    stripeAccount: connectedAccountId,
  });
}

// ---------------------------------------------------------------------------
// getConnectedAccountBalance
//
// Retrieves the Stripe balance for a connected account. This is the
// authoritative source of funds available for payout.
// ---------------------------------------------------------------------------

export async function getConnectedAccountBalance(
  connectedAccountId: string,
): Promise<{ available: number; pending: number; currency: string }> {
  if (!stripeEnabled) {
    throw new Error('Stripe is not configured — cannot retrieve balance');
  }

  const balance = await getStripe().balance.retrieve({}, {
    stripeAccount: connectedAccountId,
  });

  const available = balance.available.reduce((sum, b) => sum + b.amount, 0);
  const pending = balance.pending.reduce((sum, b) => sum + b.amount, 0);

  return {
    available,
    pending,
    currency: balance.available[0]?.currency ?? 'gbp',
  };
}

// ---------------------------------------------------------------------------
// listExternalAccounts
//
// Retrieves the external accounts (bank accounts) attached to a connected
// account. Used to sync PayoutMethod records after onboarding completes.
// ---------------------------------------------------------------------------

export async function listExternalAccounts(
  stripeAccountId: string,
): Promise<Array<{ id: string; last4: string; bankName: string; country: string; currency: string; default: boolean }>> {
  if (!stripeEnabled) {
    return [];
  }

  const account = await getStripe().accounts.retrieve(stripeAccountId, {
    expand: ['external_accounts'],
  });

  const externalAccounts = account.external_accounts;
  if (!externalAccounts || !('data' in externalAccounts)) {
    return [];
  }

  return externalAccounts.data.map((ea) => ({
    id: ea.id,
    last4: ea.last4 ?? '****',
    bankName: (ea as unknown as Record<string, unknown>).bank_name as string ?? 'Unknown',
    country: ea.country ?? 'XX',
    currency: ea.currency ?? 'gbp',
    default: ea.default_for_currency ?? false,
  }));
}

// ---------------------------------------------------------------------------
// wireStripeConnect
//
// Call once at application startup. When Stripe is configured, activates
// the Stripe disbursement provider so that ValueGap releases trigger
// real Stripe transfers. In simulation mode, the placeholder provider
// remains active (no real money moves).
// ---------------------------------------------------------------------------

export function wireStripeConnect(): void {
  if (stripeEnabled) {
    setDisbursementProvider(stripeDisbursementProvider);
    log.info('Stripe Connect disbursement provider activated');
  } else {
    log.info('Stripe not configured — using placeholder disbursement provider');
  }
}

// ---------------------------------------------------------------------------
// StripeDisbursementProvider
//
// Implements the DisbursementProvider interface using Stripe Connect
// transfers. Wired via setDisbursementProvider() in value-gap.ts.
//
// Source-of-truth boundary:
//   This provider moves funds through Stripe's infrastructure. Stripe
//   becomes the source of truth for actual fund location after transfer.
//   Swapify retains ownership of ValueGap lifecycle state.
//
// Idempotency:
//   - Check externalPayoutRef before calling Stripe (existing transfer).
//   - Use deterministic Stripe idempotency key: value-gap-transfer:{valueGapId}.
//   - Persist transfer ID on ValueGap atomically after Stripe success.
//   - If crash after Stripe success but before DB persist, reconciliation
//     detects the transfer via metadata and persists it.
//
// Regulatory note: This code implements Stripe Connect transfer
// infrastructure. Regulatory classification of Swapify's payment
// activities requires UK fintech/payment-services legal review.
// ---------------------------------------------------------------------------

import type { DisbursementProvider, DisbursementReleaseResult } from './value-gap.js';

export const stripeDisbursementProvider: DisbursementProvider = {
  async release(params): Promise<DisbursementReleaseResult> {
    const { valueGapId, recipientUserId, valueGapPence, currency } = params;

    try {
      // 1. Look up ValueGap for swapId and current externalPayoutRef.
      const valueGap = await prisma.valueGap.findUnique({ where: { id: valueGapId } });
      if (!valueGap) {
        log.error({ valueGapId }, 'ValueGap not found during transfer');
        return { status: 'FAILED', error: 'ValueGap not found' };
      }

      // 2. If externalPayoutRef already exists, the transfer was already
      //    created (possibly during a prior attempt that crashed before
      //    the caller persisted the result). Return the existing ref.
      if (valueGap.externalPayoutRef) {
        log.info(
          { valueGapId, externalPayoutRef: valueGap.externalPayoutRef },
          'Transfer already exists for this ValueGap — returning existing ref',
        );
        return {
          status: 'COMPLETED',
          externalRef: valueGap.externalPayoutRef,
        };
      }

      // 3. Look up recipient's ConnectedAccount.
      const connectedAccount = await prisma.connectedAccount.findUnique({
        where: { userId: recipientUserId },
      });
      if (!connectedAccount) {
        log.error(
          { valueGapId, recipientUserId },
          'Recipient has no connected account — cannot transfer',
        );
        return {
          status: 'FAILED',
          error: 'Recipient has no connected account',
        };
      }

      // 4. Guard: do not transfer to a restricted/disabled account.
      //    The funds remain on the platform. Reconciliation will retry
      //    when the account status improves.
      if (connectedAccount.status === 'DISABLED') {
        log.warn(
          { valueGapId, recipientUserId, stripeAccountId: connectedAccount.stripeAccountId },
          'Recipient connected account is disabled — deferring transfer',
        );
        return {
          status: 'FAILED',
          error: 'Recipient account is disabled',
        };
      }

      // 5. Create the Stripe Transfer with deterministic idempotency.
      const transferResult = await createTransfer({
        valueGapId,
        swapId: valueGap.swapId,
        recipientUserId,
        amountPence: valueGapPence,
        currency,
        destinationStripeAccountId: connectedAccount.stripeAccountId,
      });

      // 6. Persist the transfer ID on the ValueGap atomically.
      //    Use a conditional update to avoid overwriting if another
      //    worker persisted a different transfer concurrently.
      const updated = await prisma.valueGap.updateMany({
        where: { id: valueGapId, externalPayoutRef: null },
        data: { externalPayoutRef: transferResult.transferId },
      });

      if (updated.count === 0) {
        // Another worker already persisted a transfer ref. Retrieve it
        // and return the existing ref.
        const reloaded = await prisma.valueGap.findUniqueOrThrow({
          where: { id: valueGapId },
        });
        log.info(
          { valueGapId, existingRef: reloaded.externalPayoutRef },
          'Transfer ref was persisted concurrently — using existing',
        );
        return {
          status: 'COMPLETED',
          externalRef: reloaded.externalPayoutRef!,
        };
      }

      log.info(
        { valueGapId, transferId: transferResult.transferId, swapId: valueGap.swapId },
        'Transfer created and persisted',
      );

      return {
        status: 'COMPLETED',
        externalRef: transferResult.transferId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, valueGapId }, 'Transfer creation failed');
      return { status: 'FAILED', error: message };
    }
  },

  async refund(params): Promise<DisbursementReleaseResult> {
    const { valueGapId } = params;

    // Look up the value gap to find the transfer ID
    const valueGap = await prisma.valueGap.findUnique({ where: { id: valueGapId } });
    if (!valueGap?.externalPayoutRef) {
      log.info({ valueGapId }, 'Disbursement refund: no transfer to reverse');
      return { status: 'COMPLETED' };
    }

    try {
      await reverseTransfer({
        transferId: valueGap.externalPayoutRef,
        amountPence: valueGap.valueGapPence,
        valueGapId: valueGap.id,
      });
      log.info({ valueGapId, transferId: valueGap.externalPayoutRef }, 'Transfer reversed via disbursement provider');
      return { status: 'COMPLETED', externalRef: valueGap.externalPayoutRef };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, valueGapId }, 'Transfer reversal failed in disbursement provider');
      return { status: 'FAILED', error: message };
    }
  },
};
