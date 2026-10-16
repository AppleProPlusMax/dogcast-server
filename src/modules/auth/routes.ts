import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { REFRESH_COOKIE_NAME } from '../../lib/tokens.js';
import { parseOrThrow } from '../../lib/errors.js';
import { displayNameSchema, passwordSchema, usernameSchema } from '../users/schemas.js';
import { clearRefreshCookie, setRefreshCookie } from './cookies.js';
import { login, logout, refreshSession, register, type AuthDeps } from './service.js';

const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  inviteCode: z.string().trim().min(1).max(64).optional(),
});

function authDeps(app: FastifyInstance): AuthDeps {
  return {
    db: app.db,
    sqlite: app.sqlite,
    config: app.config,
    signAccess: (user) =>
      app.jwt.sign(
        { sub: user.id, username: user.username, role: user.role },
        { expiresIn: `${app.config.JWT_ACCESS_TTL_SEC}s` },
      ),
  };
}

function sendSession(reply: FastifyReply, app: FastifyInstance, session: Awaited<ReturnType<typeof login>>, status: 200 | 201) {
  setRefreshCookie(reply, app.config, session.refreshToken, session.refreshMaxAgeSec);
  return reply.code(status).send({
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: session.expiresIn,
    user: session.user,
  });
}

const strictAuthLimit = (app: FastifyInstance) => ({
  config: {
    rateLimit: {
      max: app.config.LOGIN_RATE_LIMIT_MAX,
      timeWindow: app.config.LOGIN_RATE_LIMIT_WINDOW_MS,
    },
  },
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', strictAuthLimit(app), async (request, reply) => {
    const body = parseOrThrow(registerSchema, request.body);
    const session = await register(authDeps(app), body, { userAgent: request.headers['user-agent'] ?? null });
    return sendSession(reply, app, session, 201);
  });

  app.post('/auth/login', strictAuthLimit(app), async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body);
    const session = await login(authDeps(app), body, { userAgent: request.headers['user-agent'] ?? null });
    return sendSession(reply, app, session, 200);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    const session = await refreshSession(authDeps(app), token);
    return sendSession(reply, app, session, 200);
  });

  app.post('/auth/logout', async (request, reply) => {
    const userId = logout(authDeps(app), request.cookies[REFRESH_COOKIE_NAME]);
    if (userId) app.hub.disconnectUser(userId);
    clearRefreshCookie(reply, app.config);
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request: FastifyRequest) => {
    if (!request.authUser) throw new Error('missing auth user');
    return { user: request.authUser };
  });
}
