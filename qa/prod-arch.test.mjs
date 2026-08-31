// Production architecture tests. Run with: npx tsx qa/prod-arch.test.mjs
//
// Verifies the S3/CloudFront storage provider abstraction, image cleanup on
// PATCH replacement, fail-closed Stripe behavior, startup config validation,
// and frontend CDN URL resolution. No real AWS credentials or network calls:
// the S3 provider is exercised with an injected mock client, and env-dependent
// module-load constants are tested in child processes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  LocalStorageProvider,
  MAX_IMAGE_BYTES,
  S3StorageProvider,
  StorageError,
  getStorage,
  getImageUrl,
  isLocalStorage,
  objectKeyFor,
  resolveUploadDir,
  sniffImage,
  storeImage,
} from '../apps/api/src/services/storage.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

// 1x1-style PNG header with enough trailing bytes to pass the 12-byte sniff.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BYTES = Buffer.concat([PNG_MAGIC, Buffer.alloc(64)]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);

const DATABASE_URL = 'postgresql://swapify:swapify@localhost:5432/swapify?schema=public';

const results = [];
function check(name, fn) {
  results.push({ name, fn });
}

function restoreEnv(key, prev) {
  if (prev === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = prev;
  }
}

function probe(label, env, code) {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL, ...env },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  const failed = res.status !== 0 || /^FAIL/m.test(res.stdout ?? '');
  results.push({
    name: label,
    ok: !failed,
    fn: async () => {}, // work already done synchronously by spawnSync
    err: failed
      ? new Error(`probe exited ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// In-process: image sniffing and size limits
// ---------------------------------------------------------------------------

check('sniffImage accepts PNG magic bytes', () => {
  const d = sniffImage(PNG_BYTES);
  assert.deepEqual(d, { mime: 'image/png', ext: '.png' });
});

check('sniffImage accepts JPEG magic bytes', () => {
  const d = sniffImage(JPEG_BYTES);
  assert.deepEqual(d, { mime: 'image/jpeg', ext: '.jpg' });
});

check('sniffImage rejects garbage and short buffers', () => {
  assert.equal(sniffImage(Buffer.from('hello world, this is not an image')), null);
  assert.equal(sniffImage(Buffer.alloc(8)), null);
});

// ---------------------------------------------------------------------------
// In-process: LocalStorageProvider round-trip
// ---------------------------------------------------------------------------

check('LocalStorageProvider store/delete/getImageUrl round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'swapify-storage-'));
  const prev = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    const provider = new LocalStorageProvider();

    const key = await provider.storeImage(PNG_BYTES);
    assert.match(key, /^uploads\/[0-9a-f-]{36}\.png$/);
    await readFile(join(dir, key.split('/').pop())); // file actually written

    assert.equal(provider.getImageUrl(key), `/${key}`);

    await provider.deleteImage(key);
    await assert.rejects(() => readFile(join(dir, key.split('/').pop())));
    await provider.deleteImage(key); // ENOENT is swallowed -> idempotent
  } finally {
    restoreEnv('UPLOAD_DIR', prev);
    await rm(dir, { recursive: true, force: true });
  }
});

check('LocalStorageProvider rejects non-images and oversized files', async () => {
  const provider = new LocalStorageProvider();
  await assert.rejects(() => provider.storeImage(Buffer.from('definitely not an image')), StorageError);
  await assert.rejects(
    () => provider.storeImage(Buffer.concat([PNG_MAGIC, Buffer.alloc(MAX_IMAGE_BYTES)])),
    StorageError,
  );
});

check('resolveUploadDir honors UPLOAD_DIR', () => {
  const prev = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = 'custom-dir';
  try {
    assert.equal(resolveUploadDir(), join(root, 'custom-dir'));
  } finally {
    restoreEnv('UPLOAD_DIR', prev);
  }
});

// ---------------------------------------------------------------------------
// In-process: S3StorageProvider with injected mock client
// ---------------------------------------------------------------------------

check('S3StorageProvider store/delete/getImageUrl via mock client', async () => {
  const sent = [];
  const mock = {
    async send(command) {
      sent.push(command);
      return {};
    },
  };

  const prev = {
    bucket: process.env.S3_BUCKET,
    cdn: process.env.CDN_BASE_URL,
    prefix: process.env.S3_PREFIX,
    region: process.env.AWS_REGION,
  };
  process.env.S3_BUCKET = 'swapify-images-test';
  process.env.CDN_BASE_URL = 'https://cdn.example.com/';
  process.env.S3_PREFIX = 'images';
  process.env.AWS_REGION = 'us-east-1';

  try {
    const provider = new S3StorageProvider({ client: mock });

    const key = await provider.storeImage(PNG_BYTES);
    assert.match(key, /^images\/[0-9a-f-]{36}\.png$/);

    assert.equal(sent.length, 1);
    assert.ok(sent[0] instanceof PutObjectCommand);
    assert.equal(sent[0].input.Bucket, 'swapify-images-test');
    assert.equal(sent[0].input.Key, key);
    assert.equal(sent[0].input.ContentType, 'image/png');
    assert.equal(sent[0].input.ServerSideEncryption, 'AES256');
    assert.deepEqual(sent[0].input.Body, PNG_BYTES);

    // Trailing slash on CDN base is trimmed; key joins cleanly.
    assert.equal(provider.getImageUrl(key), `https://cdn.example.com/images/${key.split('/').pop()}`);

    await provider.deleteImage(key);
    assert.equal(sent.length, 2);
    assert.ok(sent[1] instanceof DeleteObjectCommand);
    assert.equal(sent[1].input.Bucket, 'swapify-images-test');
    assert.equal(sent[1].input.Key, key);
  } finally {
    restoreEnv('S3_BUCKET', prev.bucket);
    restoreEnv('CDN_BASE_URL', prev.cdn);
    restoreEnv('S3_PREFIX', prev.prefix);
    restoreEnv('AWS_REGION', prev.region);
  }
});

check('S3StorageProvider getters fail fast when env is missing', async () => {
  const prev = { bucket: process.env.S3_BUCKET, cdn: process.env.CDN_BASE_URL };
  const provider = new S3StorageProvider({ client: { send: async () => ({}) } });
  try {
    process.env.S3_BUCKET = '';
    process.env.CDN_BASE_URL = 'https://cdn.example.com';
    assert.throws(() => provider.bucket, StorageError);
    process.env.S3_BUCKET = 'bucket';
    process.env.CDN_BASE_URL = '';
    assert.throws(() => provider.cdnBaseUrl, StorageError);
  } finally {
    restoreEnv('S3_BUCKET', prev.bucket);
    restoreEnv('CDN_BASE_URL', prev.cdn);
  }
});

check('objectKeyFor honors S3_PREFIX with uploads default', () => {
  const prev = process.env.S3_PREFIX;
  process.env.S3_PREFIX = 'media';
  try {
    assert.equal(objectKeyFor('a.png'), 'media/a.png');
  } finally {
    restoreEnv('S3_PREFIX', prev);
  }
  assert.equal(objectKeyFor('b.png'), 'uploads/b.png');
});

// ---------------------------------------------------------------------------
// In-process: backwards-compatible named exports (default driver = local)
// ---------------------------------------------------------------------------

check('backwards-compat storeImage/getImageUrl delegate to active provider', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'swapify-storage-'));
  const prevDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    assert.equal(isLocalStorage(), true);
    assert.ok(getStorage() instanceof LocalStorageProvider);

    const key = await storeImage(PNG_BYTES);
    assert.equal(getImageUrl(key), `/${key}`);
  } finally {
    restoreEnv('UPLOAD_DIR', prevDir);
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Subprocess: env-dependent module-load constants and startup validation
// ---------------------------------------------------------------------------

const storageSelect = `
const s = await import('./apps/api/src/services/storage.ts');
if (s.isLocalStorage() !== EXPECT) throw new Error('isLocalStorage mismatch');
const st = s.getStorage();
const ok = EXPECT ? (st instanceof s.LocalStorageProvider) : (st instanceof s.S3StorageProvider);
if (!ok) throw new Error('wrong provider type: ' + st.constructor.name);
console.log('OK');
`;

probe('getStorage() selects local provider by default', {}, storageSelect.replaceAll('EXPECT', 'true'));
probe('getStorage() selects S3 provider with STORAGE_DRIVER=s3', { STORAGE_DRIVER: 's3' }, storageSelect.replaceAll('EXPECT', 'false'));

probe(
  'validateConfig() passes for local dev default',
  {},
  `
const { validateConfig } = await import('./apps/api/src/config.ts');
validateConfig();
console.log('OK');
`,
);

probe(
  'validateConfig() refuses to start in production without Stripe keys',
  { NODE_ENV: 'production' },
  `
const { validateConfig } = await import('./apps/api/src/config.ts');
let threw = false;
try { validateConfig(); } catch (e) { threw = /FATAL: production configuration error/.test(e.message); }
if (!threw) throw new Error('expected FATAL production config error');
console.log('OK');
`,
);

probe(
  'validateConfig() passes in production with Stripe keys',
  { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' },
  `
const { validateConfig } = await import('./apps/api/src/config.ts');
validateConfig();
console.log('OK');
`,
);

probe(
  'validateConfig() refuses to start with STORAGE_DRIVER=s3 missing S3_BUCKET/CDN_BASE_URL',
  { STORAGE_DRIVER: 's3' },
  `
const { validateConfig } = await import('./apps/api/src/config.ts');
let threw = false;
try { validateConfig(); } catch (e) { threw = /FATAL: STORAGE_DRIVER=s3 requires/.test(e.message); }
if (!threw) throw new Error('expected FATAL S3 config error');
console.log('OK');
`,
);

probe(
  'validateConfig() passes with complete S3 configuration',
  { STORAGE_DRIVER: 's3', S3_BUCKET: 'b', CDN_BASE_URL: 'https://cdn.example.com' },
  `
const { validateConfig } = await import('./apps/api/src/config.ts');
validateConfig();
console.log('OK');
`,
);

probe(
  'Stripe simulation is disabled in production without keys (503)',
  { NODE_ENV: 'production' },
  `
import assert from 'node:assert/strict';
const st = await import('./apps/api/src/services/stripe.ts');
assert.equal(st.isProduction, true);
assert.equal(st.stripeEnabled, false);
assert.equal(st.simulationAllowed, false);
await assert.rejects(
  () => st.createSwapPaymentCheckout(
    { id: 'ord', swapId: 'swp', amountPence: 10000, feePence: 500, totalPence: 10500 },
    10000,
    'http://s',
    'http://c',
  ),
  (err) => err.statusCode === 503 && /Payments are not configured/.test(err.message),
);
console.log('OK');
`,
);

probe(
  'Stripe is fully enabled in production with keys',
  { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' },
  `
import assert from 'node:assert/strict';
const st = await import('./apps/api/src/services/stripe.ts');
assert.equal(st.isProduction, true);
assert.equal(st.stripeEnabled, true);
assert.equal(st.simulationAllowed, false);
console.log('OK');
`,
);

probe(
  'Stripe simulation works outside production without keys',
  {},
  `
import assert from 'node:assert/strict';
const st = await import('./apps/api/src/services/stripe.ts');
assert.equal(st.isProduction, false);
assert.equal(st.stripeEnabled, false);
assert.equal(st.simulationAllowed, true);
const r = await st.createSwapPaymentCheckout(
  { id: 'ord', swapId: 'swp', amountPence: 10000, feePence: 500, totalPence: 10500 },
  10000,
  'http://s',
  'http://c',
);
assert.equal(r.simulated, true);
assert.equal(r.url, '/stripe/dev-confirm/ord');
assert.equal(r.sessionId, null);
console.log('OK');
`,
);

probe(
  'web resolveImageUrl resolves relative keys against CDN base',
  { NEXT_PUBLIC_IMAGE_BASE_URL: 'https://cdn.example.com' },
  `
import assert from 'node:assert/strict';
const { resolveImageUrl } = await import('./apps/web/src/lib/api.ts');
assert.equal(resolveImageUrl('uploads/x.png'), 'https://cdn.example.com/uploads/x.png');
assert.equal(resolveImageUrl('/uploads/x.png'), 'https://cdn.example.com/uploads/x.png');
assert.equal(resolveImageUrl('https://ext.example/i.png'), 'https://ext.example/i.png');
assert.equal(resolveImageUrl(''), '');
console.log('OK');
`,
);

probe(
  'web resolveImageUrl falls back to API_URL for relative keys',
  { API_URL: 'http://localhost:4000' },
  `
import assert from 'node:assert/strict';
const { resolveImageUrl } = await import('./apps/web/src/lib/api.ts');
assert.equal(resolveImageUrl('uploads/x.png'), 'http://localhost:4000/uploads/x.png');
console.log('OK');
`,
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

// Run checks sequentially: they mutate shared process.env, so they must not
// interleave.
for (const r of results) {
  try {
    await r.fn();
    r.ok = true;
  } catch (err) {
    r.ok = false;
    r.err = err;
  }
}

let failures = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${r.name}`);
    console.log(String(r.err?.stack ?? r.err));
  }
}
console.log(`\n${results.length - failures}/${results.length} prod-arch checks passed`);
process.exit(failures === 0 ? 0 : 1);
