import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOrThrow } from '../../lib/errors.js';
import { getDefaultRoomForMember, getRoomForMember, listRoomMembers } from './service.js';

const roomParamsSchema = z.object({
  roomId: z.string().trim().min(1).max(80),
});

export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rooms/default', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    return getDefaultRoomForMember(app.db, app.config, request.authUser.id);
  });

  app.get('/rooms/:roomId', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    const { roomId } = parseOrThrow(roomParamsSchema, request.params);
    return getRoomForMember(app.db, roomId, request.authUser.id);
  });

  app.get('/rooms/:roomId/members', { preHandler: app.authenticate }, async (request) => {
    if (!request.authUser) throw Errors.unauthorized();
    const { roomId } = parseOrThrow(roomParamsSchema, request.params);
    const members = listRoomMembers(app.db, roomId, request.authUser.id);
    const online = new Map(app.hub.connectionsForRoom(roomId).map((conn) => [conn.userId, conn.connId]));
    return {
      members: members.map((member) => ({
        ...member,
        online: online.has(member.userId),
        connId: online.get(member.userId) ?? null,
      })),
    };
  });
}
