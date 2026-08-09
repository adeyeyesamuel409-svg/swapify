import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Upload pipeline storage backend. The rest of the app only talks to this
// module, so swapping local disk for S3 later (e.g. a storeImage that PUTs to
// a bucket and returns the object's public key) won't touch the database or
// the route handlers.
//
// Stored values are RELATIVE public paths (/uploads/<file>) so the database
// stays portable between environments; clients resolve them against their API
// base URL.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 8;

export type DetectedImage = { mime: string; ext: string };

export class StorageError extends Error {}

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

export function resolveUploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? 'uploads');
}

export function publicUrlFor(filename: string): string {
  return `/uploads/${filename}`;
}

// Persist an image buffer and return its relative public URL.
// Filenames are random UUIDs generated server-side, so no user input ever
// reaches the filesystem path (no path traversal).
export async function storeImage(buffer: Buffer): Promise<string> {
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

  return publicUrlFor(filename);
}
