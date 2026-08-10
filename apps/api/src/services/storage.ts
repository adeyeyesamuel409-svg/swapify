import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Upload pipeline storage backend. The rest of the app only talks to the
// active StorageProvider, so swapping local disk for S3 (or back again) never
// touches the database or the route handlers.
//
// Stored values are RELATIVE object keys ("uploads/<uuid>.<ext>") so the
// database stays portable between environments; clients resolve them against a
// configurable public base URL (API_URL in dev, the CloudFront distribution in
// production).

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 8;

export type DetectedImage = { mime: string; ext: string };

export class StorageError extends Error {}

export type StorageProvider = {
  storeImage(buffer: Buffer): Promise<string>;
  deleteImage(key: string): Promise<void>;
  getImageUrl(key: string): string;
};

const DEFAULT_PREFIX = 'uploads';

export function objectKeyFor(filename: string): string {
  return `${process.env.S3_PREFIX ?? DEFAULT_PREFIX}/${filename}`;
}

// Sniff the real file type from magic bytes instead of trusting the client's
// content-type. Prevents non-image payloads from being stored.
export function sniffImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' };
  }
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: '.png' };
  }
  // GIF87a / GIF89a
  if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') {
    return { mime: 'image/gif', ext: '.gif' };
  }
  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: '.webp' };
  }
  // AVIF / HEIC family: ....ftyp<brand>
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
      return { mime: 'image/avif', ext: '.avif' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Local filesystem provider (development default)
// ---------------------------------------------------------------------------

export function resolveUploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? 'uploads');
}

export class LocalStorageProvider implements StorageProvider {
  async storeImage(buffer: Buffer): Promise<string> {
    const detected = sniffImage(buffer);
    if (!detected) {
      throw new StorageError('Unsupported file type - only JPEG, PNG, GIF, WebP and AVIF images are allowed');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new StorageError('Image exceeds the 5 MB size limit');
    }

    const dir = resolveUploadDir();
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}${detected.ext}`;
    await writeFile(join(dir, filename), buffer, { flag: 'wx' });

    return objectKeyFor(filename);
  }

  async deleteImage(key: string): Promise<void> {
    const filename = key.split('/').pop();
    if (!filename) return;
    try {
      await unlink(join(resolveUploadDir(), filename));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  getImageUrl(key: string): string {
    return `/${key}`;
  }
}

// ---------------------------------------------------------------------------
// AWS S3 provider (production)
// ---------------------------------------------------------------------------

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;

  constructor(opts?: { client?: S3Client }) {
    this.client = opts?.client ?? new S3Client({ region: process.env.AWS_REGION });
  }

  get bucket(): string {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new StorageError('S3_BUCKET is not configured');
    return bucket;
  }

  get cdnBaseUrl(): string {
    const base = process.env.CDN_BASE_URL;
    if (!base) throw new StorageError('CDN_BASE_URL is not configured');
    return base.replace(/\/+$/, '');
  }

  async storeImage(buffer: Buffer): Promise<string> {
    const detected = sniffImage(buffer);
    if (!detected) {
      throw new StorageError('Unsupported file type - only JPEG, PNG, GIF, WebP and AVIF images are allowed');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new StorageError('Image exceeds the 5 MB size limit');
    }

    const filename = `${randomUUID()}${detected.ext}`;
    const key = objectKeyFor(filename);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: detected.mime,
        ServerSideEncryption: 'AES256',
      }),
    );

    return key;
  }

  async deleteImage(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  getImageUrl(key: string): string {
    return `${this.cdnBaseUrl}/${key}`;
  }
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

const driver = process.env.STORAGE_DRIVER ?? 'local';

let activeStorage: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!activeStorage) {
    activeStorage = driver === 's3' ? new S3StorageProvider() : new LocalStorageProvider();
  }
  return activeStorage;
}

export function isLocalStorage(): boolean {
  return driver !== 's3';
}

// Backwards-compatible named exports used by route handlers.
export const storeImage = (buffer: Buffer): Promise<string> => getStorage().storeImage(buffer);
export const deleteImage = (key: string): Promise<void> => getStorage().deleteImage(key);
export const getImageUrl = (key: string): string => getStorage().getImageUrl(key);
