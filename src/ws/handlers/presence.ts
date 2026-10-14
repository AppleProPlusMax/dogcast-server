import type { FastifyBaseLogger } from 'fastify';
import { Errors } from '../../lib/errors.js';
import { findRoomBySlug, assertRoomMember } from '../../modules/rooms/service.js';
import type { AppDb } from '../../db/types.js';
import { envelope, roomJoinSchema } from '../protocol.js';
import type { HubConn, RoomsHub } from '../rooms.hub.js';

export type HandlerDeps = {
  db: AppDb;
  hub: RoomsHub;
  log: FastifyBaseLogger;
};

function fail(deps: HandlerDeps, conn: HubConn, requestId: string | undefined, code: string, message: string): void {
  deps.hub.send(conn, envelope('error', { code, message }, requestId));
}

export function handleRoomJoin(deps: HandlerDeps, conn: HubConn, payload: unknown, requestId?: string): void {
  const body = roomJoinSchema.parse(payload ?? {});
  let roomId = body.roomId;
  if (!roomId) {
    const found = findRoomBySlug(deps.db, body.slug ?? 'home');
    if (!found) throw Errors.notFound('Room not found');
    roomId = found.id;
  }
  const { room } = assertRoomMember(deps.db, roomId, conn.userId);
  deps.hub.joinRoom(
    conn,
    { id: room.id, slug: room.slug, name: room.name, maxViewers: room.maxViewers },
    requestId,
  );
  deps.log.info({ userId: conn.userId, connId: conn.connId, roomId: room.id }, 'room joined');
}

export function handleRoomLeave(deps: HandlerDeps, conn: HubConn, requestId?: string): void {
  const result = deps.hub.leaveRoom(conn);
  if (!result.ok) fail(deps, conn, requestId, result.code, result.message);
}
