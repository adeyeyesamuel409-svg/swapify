import { isLocalStorage } from './services/storage.js';

// Fail-fast startup validation. Catches production configuration mistakes
// (missing Stripe keys, incomplete S3 setup) before the server accepts
// traffic, instead of degrading silently at runtime.

export type AppRole = 'api' | 'worker';

// Process role, from APP_ROLE.
//
//   api    - HTTP entry point (server.js). Serves traffic and, unless
//            RECONCILE_IN_PROCESS=false, also runs the background sweepers.
//   worker - one-shot reconciliation entry point (reconcile-once.js). Runs a
//            single reconciliation cycle and exits. Serves no HTTP.
//
// The default is 'api' with in-process reconciliation enabled, which is the
// pre-split behaviour: a single API task keeps working with no extra
// configuration. Production sets APP_ROLE=api + RECONCILE_IN_PROCESS=false on
// the API and APP_ROLE=worker on the scheduled task, so exactly one component
// owns financial reconciliation.
export function resolveAppRole(): AppRole {
  const raw = process.env.APP_ROLE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return 'api';
  if (raw === 'api' || raw === 'worker') return raw;
  throw new Error(
    `FATAL: unknown APP_ROLE "${process.env.APP_ROLE}" - expected "api" or "worker". Refusing to start.`,
  );
}

const DISABLED_VALUES = new Set(['false', '0', 'no', 'off']);

// The in-process sweepers are the ONLY place reconciliation runs other than the
// scheduled worker. Gating them on an explicit env var is what lets the API
// scale to N tasks (and overlap during a rolling deploy) without running the
// same financial reconciliation N times.
export function shouldRunInProcessSweepers(): boolean {
  if (resolveAppRole() !== 'api') return false;
  const raw = process.env.RECONCILE_IN_PROCESS?.trim().toLowerCase();
  return !DISABLED_VALUES.has(raw ?? '');
}

// Fail-fast validation for the reconciliation worker.
//
// The worker does not need the API's full environment (no WEB_BASE_URL, no S3,
// no webhook secret), but it does need Stripe: reconcileValueGaps() marks a
// value gap RELEASED in the ledger and credits the balance BEFORE notifying the
// disbursement provider, so a worker running without Stripe would record a
// release that no Stripe transfer ever backed. Refuse to start instead.
export function validateReconcilerConfig(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (missing.length > 0) {
    throw new Error(
      `FATAL: reconciliation worker configuration error - missing required environment variable(s): ${missing.join(', ')}. ` +
        'Refusing to run: reconciliation without Stripe can mark value gaps RELEASED in the ledger with no real Stripe transfer behind them.',
    );
  }
}

export function validateConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
    if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    if (!process.env.WEB_BASE_URL || process.env.WEB_BASE_URL.includes('localhost')) {
      missing.push('WEB_BASE_URL (must be set to a real URL in production)');
    }
    if (missing.length > 0) {
      throw new Error(
        `FATAL: production configuration error - missing required environment variable(s): ${missing.join(', ')}. ` +
          'Refusing to start: simulated checkout is never allowed in production.',
      );
    }

    // Belt-and-suspenders: verify simulation is actually disabled.
    const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
    const isProd = process.env.NODE_ENV === 'production';
    if (!stripeEnabled && isProd) {
      throw new Error(
        'FATAL: STRIPE_SECRET_KEY is missing in production. ' +
          'Simulated checkout is never allowed in production.',
      );
    }
  }

  if (!isLocalStorage()) {
    const missing: string[] = [];
    if (!process.env.S3_BUCKET) missing.push('S3_BUCKET');
    if (!process.env.CDN_BASE_URL) missing.push('CDN_BASE_URL');
    if (missing.length > 0) {
      throw new Error(
        `FATAL: STORAGE_DRIVER=s3 requires: ${missing.join(', ')}. ` +
          'Refusing to start with incomplete S3 storage configuration.',
      );
    }
  }
}
