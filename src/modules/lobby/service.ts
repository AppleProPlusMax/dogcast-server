import { rooms, watchLinks } from '../../db/schema.js';
import type { AppDb } from '../../db/types.js';
import { Errors, isUniqueConstraint } from '../../lib/errors.js';
import { hashToken, newId, newInviteCode } from '../../lib/tokens.js';
import type { RoomView } from '../rooms/service.js';

const LOBBY_HOURS = 12;

export function createLobby(db: AppDb): { code: string; expiresAt: string; hostId: string; room: RoomView } {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOBBY_HOURS * 60 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newInviteCode();
    const slug = code.replace('-', '').toLowerCase();
    const hostId = newId('host');
    const roomId = newId('room');
    try {
      db.insert(rooms)
        .values({
          id: roomId,
          slug,
          name: code,
          createdBy: null,
          maxViewers: 4,
          createdAt: now.toISOString(),
        })
        .run();
      db.insert(watchLinks)
        .values({
          id: newId('watch'),
          codeHash: hashToken(code),
          roomId,
          createdBy: hostId,
          expiresAt,
          createdAt: now.toISOString(),
        })
        .run();
      return {
        code,
        expiresAt,
        hostId,
        room: { id: roomId, slug, name: code, maxViewers: 4 },
      };
    } catch (err) {
      if (!isUniqueConstraint(err)) throw err;
    }
  }
  throw Errors.internal('Could not open a room');
}
