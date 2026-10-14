import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import { roomMembers, rooms, users } from '../../db/schema.js';
import { ensureDefaultRoom } from '../../db/seed.js';
import type { AppDb } from '../../db/types.js';
import { Errors } from '../../lib/errors.js';

export type RoomView = {
  id: string;
  slug: string;
  name: string;
  maxViewers: number;
};

export type MembershipView = {
  role: 'owner' | 'member';
};

function asRoomRole(role: string): 'owner' | 'member' {
  if (role !== 'owner' && role !== 'member') throw Errors.internal('Invalid room role');
  return role;
}

export function getDefaultRoom(db: AppDb, config: AppConfig) {
  return ensureDefaultRoom(db, config);
}

export function getRoomForMember(db: AppDb, roomId: string, userId: string): { room: RoomView; membership: MembershipView } {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get();
  if (!room) throw Errors.notFound('Room not found');
  const membership = db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)))
    .get();
  if (!membership) throw Errors.forbidden('Not a member of this room');
  return {
    room: { id: room.id, slug: room.slug, name: room.name, maxViewers: room.maxViewers },
    membership: { role: asRoomRole(membership.role) },
  };
}

export function getDefaultRoomForMember(db: AppDb, config: AppConfig, userId: string) {
  const room = getDefaultRoom(db, config);
  return getRoomForMember(db, room.id, userId);
}

export function listRoomMembers(db: AppDb, roomId: string, userId: string) {
  getRoomForMember(db, roomId, userId);
  return db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      role: roomMembers.role,
    })
    .from(roomMembers)
    .innerJoin(users, eq(users.id, roomMembers.userId))
    .where(eq(roomMembers.roomId, roomId))
    .all()
    .map((row) => ({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      role: asRoomRole(row.role),
    }));
}

export function findRoomBySlug(db: AppDb, slug: string) {
  return db.select().from(rooms).where(eq(rooms.slug, slug)).get() ?? null;
}

export function assertRoomMember(db: AppDb, roomId: string, userId: string) {
  return getRoomForMember(db, roomId, userId);
}
