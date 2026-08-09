import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { HttpError } from '../services/swaps.js';
import { MAX_IMAGES_PER_UPLOAD, StorageError, storeImage } from '../services/storage.js';

// Authenticated multipart image upload. Returns relative public URLs
// (/uploads/<file>) which the client then attaches to an item via POST/PATCH
// /items. Attaching is owner-gated on the item routes, so a user can never
// add images to someone else's listing.
const uploadRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post(
    '/uploads',
    // fastify-raw-body's global preParsing hook drains the request stream to
    // build req.rawBody. Our handler consumes the stream itself via parts(),
    // and the async authenticate preHandler would otherwise let that drain
    // finish first, leaving busboy nothing to parse. Skip raw-body capture here.
    { preHandler: [app.authenticate], config: { rawBody: false } },
    async (request, reply) => {
    const files: { url: string }[] = [];
    let imageCount = 0;

    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;

      if (imageCount >= MAX_IMAGES_PER_UPLOAD) {
        throw new HttpError(400, `Too many files - a maximum of ${MAX_IMAGES_PER_UPLOAD} images is allowed`);
      }

      const buffer = await part.toBuffer();
      // truncated is only set once the stream has been consumed.
      if (part.file.truncated) {
        throw new HttpError(413, 'Image too large');
      }
      try {
        const url = await storeImage(buffer);
        files.push({ url });
        imageCount += 1;
      } catch (err) {
        if (err instanceof StorageError) {
          throw new HttpError(400, err.message);
        }
        throw err;
      }
    }

    if (files.length === 0) {
      return reply.code(400).send({ error: 'No image files were provided' });
    }

    return { files };
  });
};

export { uploadRoutes };
