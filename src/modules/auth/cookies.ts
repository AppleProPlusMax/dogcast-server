import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../../config.js';
import { REFRESH_COOKIE_NAME } from '../../lib/tokens.js';

const cookieBase = (config: AppConfig) => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/api/auth',
});

export function setRefreshCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    ...cookieBase(config),
    maxAge: config.REFRESH_TTL_SEC,
  });
}

export function clearRefreshCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, cookieBase(config));
}
