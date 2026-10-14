import '@fastify/cookie';
import '@fastify/jwt';
import '@fastify/rate-limit';
import '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import type { AppDb } from './db/types.js';
import type { PublicUser } from './modules/users/service.js';
import type { RoomsHub } from './ws/rooms.hub.js';

export type Authenticate = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: AppDb;
    sqlite: Database.Database;
    hub: RoomsHub;
    authenticate: Authenticate;
    requireAdmin: Authenticate;
  }

  interface FastifyRequest {
    authUser: PublicUser | null;
  }
}

export function assertDecorated(app: FastifyInstance): void {
  if (!app.config || !app.db || !app.hub) {
    throw new Error('App dependencies are not decorated');
  }
}
