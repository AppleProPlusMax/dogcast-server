import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const TEST_PASSWORD = 'correct-horse';

export async function createTestApp(overrides: Record<string, string | undefined> = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
    TURN_AUTH_SECRET: 'test-turn-secret-0123456789',
    ARGON2_MEMORY_COST: '8192',
    ARGON2_TIME_COST: '1',
    ARGON2_PARALLELISM: '1',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '1000',
    LOGIN_RATE_LIMIT_MAX: '100',
    CORS_ORIGINS: 'http://localhost:5173',
    STUN_URLS: 'stun:turn.dogleaf.cn:3478',
    TURN_URLS: 'turn:turn.dogleaf.cn:3478?transport=udp,turn:turn.dogleaf.cn:3478?transport=tcp',
    TURNS_URLS: 'turns:turn.dogleaf.cn:5349?transport=tcp',
    COOKIE_SECURE: 'false',
    AUTH_PUBLIC_REGISTER: 'false',
    ...overrides,
  });
  return buildApp({ config, logger: false });
}

export async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  return address.port;
}
