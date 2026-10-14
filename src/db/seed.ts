import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import { newId } from '../lib/tokens.js';
import type { AppDb } from './types.js';
import { roomMembers, rooms, users } from './schema.js';

export type RoomRecord = {
  id: string;
  slug: string;
  name: string;
  createdBy: string | null;
  maxViewers: number;
  createdAt: string;
};

export function ensureDefaultRoom(db: AppDb, config: AppConfig): RoomRecord {
  const existing = db.select().from(rooms).where(eq(rooms.slug, config.DEFAULT_ROOM_SLUG)).get();
  if (existing) return existing;
  const room: RoomRecord = {
    id: config.DEFAULT_ROOM_SLUG === 'home' ? 'room_home' : newId('room'),
    slug: config.DEFAULT_ROOM_SLUG,
    name: config.DEFAULT_ROOM_NAME,
    createdBy: null,
    maxViewers: config.MAX_VIEWERS,
    createdAt: new Date().toISOString(),
  };
  db.insert(rooms).values(room).run();
  return room;
}

export function ensureMembership(
  db: AppDb,
  roomId: string,
  userId: string,
  role: 'owner' | 'member',
): void {
  const existing = db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .get();
  if (existing) return;
  db.insert(roomMembers)
    .values({
      roomId,
      userId,
      role,
      joinedAt: new Date().toISOString(),
    })
    .run();
}

export function backfillHomeMembers(db: AppDb, config: AppConfig): RoomRecord {
  const room = ensureDefaultRoom(db, config);
  const allUsers = db.select().from(users).all();
  for (const user of allUsers) {
    if (user.isActive !== 1) continue;
    ensureMembership(db, room.id, user.id, user.role === 'admin' ? 'owner' : 'member');
  }
  return room;
}
