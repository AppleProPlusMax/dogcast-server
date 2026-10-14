import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Errors } from '../lib/errors.js';
import { findUserById, toPublicUser } from '../modules/users/service.js';

export default fp(async (app) => {
  app.decorateRequest('authUser', null);

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw Errors.unauthorized();
    }
    const payload = request.user as { sub?: string } | undefined;
    if (!payload?.sub) throw Errors.unauthorized();
    const user = findUserById(app.db, payload.sub);
    if (!user) throw Errors.unauthorized();
    if (!user.isActive) throw Errors.forbidden('Account disabled');
    request.authUser = toPublicUser(user);
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    if (request.authUser?.role !== 'admin') {
      throw Errors.forbidden('Admin only');
    }
  });
});
