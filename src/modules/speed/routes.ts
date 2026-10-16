import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';

const LIMIT_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_MS = 15_000;

function readDiscarded(payload: Readable): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const timer = setTimeout(() => {
      payload.destroy();
    }, MAX_UPLOAD_MS);
    payload.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    payload.on('end', () => {
      clearTimeout(timer);
      resolve(bytes);
    });
    payload.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.code === 'ERR_STREAM_DESTROYED') {
        resolve(bytes);
        return;
      }
      reject(error);
    });
  });
}

export async function registerSpeedRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (speed) => {
    speed.addContentTypeParser('application/octet-stream', { bodyLimit: LIMIT_BYTES }, (_request, payload, done) => {
      readDiscarded(payload as Readable)
        .then((bytes) => done(null, bytes))
        .catch((error: unknown) => done(error as Error));
    });

    speed.post(
      '/speed-test',
      {
        bodyLimit: LIMIT_BYTES,
        preHandler: speed.authenticate,
        config: {
          rateLimit: {
            max: 180,
            timeWindow: 60_000,
          },
        },
      },
      async (request) => {
        const bytes = typeof request.body === 'number' ? request.body : 0;
        return { bytes };
      },
    );
  });
}
