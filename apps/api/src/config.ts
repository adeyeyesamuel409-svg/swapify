import { isLocalStorage } from './services/storage.js';

// Fail-fast startup validation. Catches production configuration mistakes
// (missing Stripe keys, incomplete S3 setup) before the server accepts
// traffic, instead of degrading silently at runtime.

export function validateConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
    if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    if (missing.length > 0) {
      throw new Error(
        `FATAL: production configuration error - missing required environment variable(s): ${missing.join(', ')}. ` +
          'Refusing to start: simulated checkout is never allowed in production.',
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
