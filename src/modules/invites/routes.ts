import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOrThrow } from '../../lib/errors.js';
import { createInvite } from './service.js';

const createInviteSchema = z.object({
  maxUses: z.number().int().positive().max(100).optional(),
  expiresInHours: z.number().positive().max(24 * 365).optional(),
});

export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/invites', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseOrThrow(createInviteSchema, request.body ?? {});
    if (!request.authUser) throw Errors.unauthorized();
    const invite = createInvite(app.db, {
      createdBy: request.authUser.id,
      maxUses: body.maxUses ?? 1,
      expiresInHours: body.expiresInHours,
    });
    return reply.code(201).send(invite);
  });
}
