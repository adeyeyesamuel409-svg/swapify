// R14 — privacy-safe structured webhook observability.
//
// Emits one stable, namespaced log event per lifecycle stage. Deliberately
// field-whitelisted: callers can NEVER pass raw request bodies, signatures,
// secrets, or error objects with payload/header properties — doing so requires
// an explicit field, which does not exist here. Logging is best-effort and
// never throws, so observability cannot break webhook processing.
//
// These logs are the single source for the proposed (not-yet-deployed)
// CloudWatch metric filters + alarms described in the R14 report:
//   Swapify/prod/Webhook {
//     LiveDeliveries        (stripe.webhook.verified && mode==live)
//     TestEventsRejected    (stripe.webhook.mode_rejected)
//     SignatureFailures     (stripe.webhook.signature_failed)
//     ProcessingFailures    (stripe.webhook.processing_failed)
//   }

import type { FastifyRequest } from 'fastify';

export type WebhookLogKind =
  | 'received'
  | 'signature_failed'
  | 'verified'
  | 'mode_rejected'
  | 'processing'
  | 'processed'
  | 'processing_failed';

export interface WebhookLogFields {
  eventId?: string;
  eventType?: string;
  livemode?: boolean;
  mode?: string;
  outcome?: string;
  httpStatus?: number;
  errName?: string;
}

const MESSAGE: Record<WebhookLogKind, string> = {
  received: 'Stripe webhook delivery received',
  signature_failed: 'Stripe webhook signature verification failed',
  verified: 'Stripe webhook signature verified',
  mode_rejected: 'Stripe webhook event mode rejected - ignored, no side effects',
  processing: 'Stripe webhook processing started',
  processed: 'Stripe webhook processed',
  processing_failed: 'Stripe webhook processing failed',
};

export function logWebhook(
  request: FastifyRequest,
  kind: WebhookLogKind,
  fields: WebhookLogFields = {},
): void {
  // Explicitly pick the whitelisted fields. Spreading `fields` would let any
  // extra property (raw body, signature, secret, error object) reach the logs.
  const base: Record<string, unknown> = {
    event: `stripe.webhook.${kind}`,
    corrId: request.id,
  };
  if (fields.eventId !== undefined) base.eventId = fields.eventId;
  if (fields.eventType !== undefined) base.eventType = fields.eventType;
  if (fields.livemode !== undefined) base.livemode = fields.livemode;
  if (fields.mode !== undefined) base.mode = fields.mode;
  if (fields.outcome !== undefined) base.outcome = fields.outcome;
  if (fields.httpStatus !== undefined) base.httpStatus = fields.httpStatus;
  if (fields.errName !== undefined) base.errName = fields.errName;

  try {
    switch (kind) {
      case 'signature_failed':
      case 'mode_rejected':
        request.log.warn(base, MESSAGE[kind]);
        break;
      case 'processing_failed':
        request.log.error(base, MESSAGE[kind]);
        break;
      default:
        request.log.info(base, MESSAGE[kind]);
    }
  } catch {
    // Observability must never break webhook processing.
  }
}