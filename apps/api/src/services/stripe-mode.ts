// R14 — Stripe LIVE/TEST mode boundary (fail-closed).
//
// The HAZARD this closes (R11/R13): the shared production endpoint has no
// notion of mode, so a TEST-mode Stripe event (livemode:false) delivered to
// the LIVE deployment would be accepted, written to the production database,
// and could then be acted on by the scheduled reconciler as if it were real
// money. A mode column/migration is deliberately NOT used: rejecting
// mismatched events before any write keeps each database strictly single-mode,
// which is safer and requires no schema change.
//
// Trust boundaries (never trust client input):
//   * configured mode  -> server env STRIPE_SECRET_KEY family
//                         (sk_live_ / rk_live_ = LIVE; sk_test_ / rk_test_ = TEST),
//                         optionally cross-checked by an explicit STRIPE_MODE.
//   * event mode       -> event.livemode from a SIGNATURE-VERIFIED Stripe event.
//   * any unresolved/invalid configuration is a startup failure in production
//     or a request-time fail-closed rejection. There is no silent LIVE default.
//
// The webhook signing secret (whsec_*) carries no mode prefix; its mode is
// inferred from the events it actually signs (event.livemode). If an operator
// pairs a LIVE key with a TEST endpoint secret, every event is rejected loudly
// (alarmed mode_rejected), never processed in the wrong mode.

export type StripeMode = 'live' | 'test';
export type ResolvedStripeMode = StripeMode | 'unknown';

export class StripeModeError extends Error {}
export class StripeModeMismatchError extends Error {}

// Recognized secret-key families. Never validated by value — only by prefix.
export function stripeKeyModeFamily(key?: string): StripeMode | null {
  if (!key) return null;
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return null;
}

// Resolve the configured mode from the environment.
//   - explicit STRIPE_MODE must be 'live'|'test' and must agree with the key
//     family when present (contradiction is a configuration error);
//   - otherwise the key family decides;
//   - an unrecognized key family (or no key) yields 'unknown' — never LIVE.
export function resolveStripeMode(env: NodeJS.ProcessEnv = process.env): ResolvedStripeMode {
  const raw = env.STRIPE_MODE?.trim().toLowerCase();
  if (raw !== undefined && raw !== '') {
    if (raw !== 'live' && raw !== 'test') {
      throw new StripeModeError(
        `FATAL: STRIPE_MODE="${env.STRIPE_MODE}" is invalid - expected "live" or "test". Refusing to start.`,
      );
    }
    const keyFamily = stripeKeyModeFamily(env.STRIPE_SECRET_KEY);
    if (keyFamily && keyFamily !== raw) {
      throw new StripeModeError(
        `FATAL: STRIPE_MODE="${raw}" contradicts the STRIPE_SECRET_KEY family ("${keyFamily}"). Refusing to start.`,
      );
    }
    return raw;
  }
  const keyFamily = stripeKeyModeFamily(env.STRIPE_SECRET_KEY);
  return keyFamily ?? 'unknown';
}

// Startup validation. In production an unresolved mode is fatal (never default
// to LIVE). Outside production an unresolved mode is tolerated for local dev
// (the webhook gate will fail closed at request time regardless).
export function validateStripeModeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const isProduction = env.NODE_ENV === 'production';
  const keyFamily = stripeKeyModeFamily(env.STRIPE_SECRET_KEY);
  const explicit = env.STRIPE_MODE?.trim().toLowerCase();

  if (env.STRIPE_SECRET_KEY && !keyFamily && (!explicit || explicit === '')) {
    if (isProduction) {
      throw new StripeModeError(
        'FATAL: STRIPE_SECRET_KEY family is unrecognized (expected sk_live_/rk_live_ or sk_test_/rk_test_). ' +
          'Refusing to start: Stripe mode cannot be determined.',
      );
    }
  }

  // resolveStripeMode() throws on invalid/contradictory STRIPE_MODE.
  const mode = resolveStripeMode(env);
  if (isProduction && mode === 'unknown') {
    throw new StripeModeError(
      'FATAL: Stripe mode cannot be determined (missing STRIPE_SECRET_KEY with a recognized family). ' +
        'Refusing to start: never default to LIVE mode.',
    );
  }
}

// Admission check for a signature-verified event. Returns false (and therefore
// rejects) for any mismatch, missing livemode, or an unknown configured mode.
export function eventMatchesMode(
  event: { livemode?: boolean },
  configured: ResolvedStripeMode,
): boolean {
  if (configured === 'unknown') return false;
  const eventMode: StripeMode | 'unknown' =
    event.livemode === true ? 'live' : event.livemode === false ? 'test' : 'unknown';
  return eventMode === configured;
}