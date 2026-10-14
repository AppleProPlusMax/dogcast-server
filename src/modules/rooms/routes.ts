import type { FastifyInstance } from 'fastify';
import { Errors } from '../../lib/errors.js';
import { getDefaultRoomForMember, getRoomForMember, listRoomMembers } from './service.js';

export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rooms/default', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    return getDefaultRoomForMember(app.db, app.config, request.authUser.id);
  });

  app.get('/rooms/:roomId', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    const { roomId } = request.params as { roomId: string };
    return getRoomForMember(app.db, roomId, request.authUser.id);
  });

  app.get('/rooms/:roomId/members', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    const { roomId } = request.params as { roomId: string };
    return { members: listRoomMembers(app.db, roomId, request.authUser.id) };
  });
}
