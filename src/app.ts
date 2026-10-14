import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { type AppConfig, loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { asAppError, formatZodError } from './lib/errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerIceRoutes } from './modules/ice/routes.js';
import { registerInviteRoutes } from './modules/invites/routes.js';
import { registerRoomRoutes } from './modules/rooms/routes.js';
import { registerUserRoutes } from './modules/users/routes.js';
import authPlugin from './plugins/auth.js';
import corsPlugin from './plugins/cors.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import './types.js';
import { registerWsGateway } from './ws/gateway.js';
import { RoomsHub } from './ws/rooms.hub.js';

export type BuildAppOptions = {
  config?: AppConfig;
  logger?: FastifyServerOptions['logger'];
};

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger === undefined ? buildLoggerOptions(config) : options.logger,
    trustProxy: true,
    bodyLimit: 64 * 1024,
    requestIdHeader: 'x-request-id',
  });

  const { sqlite, db } = openDatabase(config);
  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('hub', new RoomsHub());
  app.addHook('onClose', async () => {
    sqlite.close();
  });

  await app.register(cookie);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);
  await app.register(jwt, { secret: config.JWT_ACCESS_SECRET });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(authPlugin);

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.setErrorHandler((error, request, reply) => {
    const appError = asAppError(error);
    if (appError) {
      if (appError.statusCode >= 500) request.log.error({ err: appError }, 'request failed');
      return reply.code(appError.statusCode).send({ error: { code: appError.code, message: appError.message } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: formatZodError(error) } });
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Bad request';
    if (statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }
    if (statusCode === 404) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    if (statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: 'VALIDATION_ERROR', message: message || 'Bad request' },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  await app.register(
    async (api) => {
      await registerHealthRoutes(api);
      await registerAuthRoutes(api);
      await registerUserRoutes(api);
      await registerInviteRoutes(api);
      await registerRoomRoutes(api);
      await registerIceRoutes(api);
    },
    { prefix: '/api' },
  );

  await registerWsGateway(app);
  return app;
}
