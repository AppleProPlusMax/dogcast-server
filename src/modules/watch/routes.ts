import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOrThrow } from '../../lib/errors.js';
import { newId } from '../../lib/tokens.js';
import { createWatchLink, resolveWatchLink } from './service.js';

const createSchema = z.object({
  expiresInHours: z.number().int().min(1).max(72).default(6),
});

const codeParams = z.object({
  code: z.string().trim().min(4).max(32),
});

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
  app.post('/watch-links', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    const body = parseOrThrow(createSchema, request.body ?? {});
    return createWatchLink(app.db, app.config, request.authUser.id, body.expiresInHours);
  });

  app.get('/watch/:code', async (request) => {
    const { code } = parseOrThrow(codeParams, request.params);
    const found = resolveWatchLink(app.db, code);
    const guestId = newId('guest');
    const remainingSec = Math.max(60, Math.floor((Date.parse(found.expiresAt) - Date.now()) / 1000));
    const expiresIn = Math.min(remainingSec, 12 * 60 * 60);
    const accessToken = await app.jwt.sign(
      { sub: guestId, guest: true, name: '访客', roomId: found.room.id },
      { expiresIn: `${expiresIn}s` },
    );
    return {
      accessToken,
      expiresIn,
      displayName: '访客',
      room: found.room,
    };
  });
}
