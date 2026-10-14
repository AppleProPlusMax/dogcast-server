import type { FastifyInstance } from 'fastify';
import { Errors } from '../../lib/errors.js';
import { buildIceServers } from './service.js';

export async function registerIceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ice/servers', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    return buildIceServers(app.config, request.authUser.id);
  });
}
