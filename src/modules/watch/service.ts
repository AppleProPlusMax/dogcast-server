import { and, eq, isNull } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import { rooms, watchLinks } from '../../db/schema.js';
import type { AppDb } from '../../db/types.js';
import { Errors } from '../../lib/errors.js';
import { hashToken, newId, newInviteCode } from '../../lib/tokens.js';
import { getDefaultRoom, type RoomView } from '../rooms/service.js';

const MAX_HOURS = 72;

export function createWatchLink(db: AppDb, config: AppConfig, userId: string, expiresInHours: number) {
  const hours = Math.min(MAX_HOURS, Math.max(1, Math.round(expiresInHours)));
  const room = getDefaultRoom(db, config);
  const code = newInviteCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  db.insert(watchLinks)
    .values({
      id: newId('watch'),
      codeHash: hashToken(code),
      roomId: room.id,
      createdBy: userId,
      expiresAt,
      createdAt: now.toISOString(),
    })
    .run();
  return { code, expiresAt, room: toRoomView(room) };
}

export function resolveWatchLink(db: AppDb, code: string): { room: RoomView; expiresAt: string } {
  const normalized = code.trim().toUpperCase();
  const row = db
    .select()
    .from(watchLinks)
    .where(and(eq(watchLinks.codeHash, hashToken(normalized)), isNull(watchLinks.revokedAt)))
    .get();
  if (!row) throw Errors.notFound('Watch link not found');
  if (Date.parse(row.expiresAt) <= Date.now()) throw Errors.notFound('Watch link expired');
  const found = db.select().from(rooms).where(eq(rooms.id, row.roomId)).get();
  if (!found) throw Errors.notFound('Room not found');
  return { room: toRoomView(found), expiresAt: row.expiresAt };
}

function toRoomView(room: { id: string; slug: string; name: string; maxViewers: number }): RoomView {
  return { id: room.id, slug: room.slug, name: room.name, maxViewers: room.maxViewers };
}
