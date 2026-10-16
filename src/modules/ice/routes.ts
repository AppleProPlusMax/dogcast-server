import type { FastifyInstance } from 'fastify';
import { Errors } from '../../lib/errors.js';
import { findUserById } from '../users/service.js';
import { buildIceServers } from './service.js';

export async function registerIceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ice/servers', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw Errors.unauthorized();
    }
    const payload = request.user as { sub?: string; guest?: boolean } | undefined;
    if (!payload?.sub) throw Errors.unauthorized();
    if (payload.guest) return buildIceServers(app.config, payload.sub);
    const user = findUserById(app.db, payload.sub);
    if (!user || !user.isActive) throw Errors.unauthorized();
    return buildIceServers(app.config, user.id);
  });
}
