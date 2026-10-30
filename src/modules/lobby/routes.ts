import type { FastifyInstance } from 'fastify';
import { createLobby } from './service.js';

const LOBBY_TTL_SEC = 12 * 60 * 60;

export async function registerLobbyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/lobbies', async () => {
    const created = createLobby(app.db);
    const accessToken = await app.jwt.sign(
      { sub: created.hostId, host: true, name: '分享者', roomId: created.room.id },
      { expiresIn: `${LOBBY_TTL_SEC}s` },
    );
    return {
      accessToken,
      expiresIn: LOBBY_TTL_SEC,
      code: created.code,
      expiresAt: created.expiresAt,
      displayName: '分享者',
      room: created.room,
    };
  });
}
