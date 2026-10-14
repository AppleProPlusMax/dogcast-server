import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '../../config.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, version: APP_VERSION }));
}
