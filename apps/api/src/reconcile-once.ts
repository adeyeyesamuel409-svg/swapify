import 'dotenv/config';
import { resolveAppRole } from './config.js';
import { disconnectReconciler, runReconciliationOnce } from './services/reconciler.js';
import pino from 'pino';

// One-shot reconciliation worker (the EventBridge/ECS scheduled task).
//
// Deliberately NOT a second API: no HTTP server, no listener, no health check,
// no long-lived loop. It runs one reconciliation cycle, closes the database
// connection and exits. Exit code 0 on success, 1 on any fatal error, which is
// how the schedule (and ECS) observe failure — a crash mid-cycle leaves the
// work in the DB for the next invocation, because every transition is an
// idempotent conditional update.

const log = pino({ name: 'reconciler-entry', level: process.env.LOG_LEVEL ?? 'info' });

let exitCode = 0;

try {
  const role = resolveAppRole();
  log.info({ role }, 'One-shot reconciliation worker starting');
  const result = await runReconciliationOnce();
  log.info({ result }, 'One-shot reconciliation worker finished');
} catch (err) {
  exitCode = 1;
  log.error({ err }, 'FATAL: one-shot reconciliation failed — exiting nonzero');
} finally {
  try {
    await disconnectReconciler();
  } catch (err) {
    log.error({ err }, 'Failed to close the database connection cleanly');
  }
}

process.exit(exitCode);
