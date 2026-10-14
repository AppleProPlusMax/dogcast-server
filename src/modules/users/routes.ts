import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/errors.js';
import { displayNameSchema, passwordSchema, roleSchema, usernameSchema } from './schemas.js';
import { createUser, listUsers } from './service.js';

const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  role: roleSchema.default('member'),
});

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/users', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseOrThrow(createUserSchema, request.body);
    const user = await createUser(
      { db: app.db, sqlite: app.sqlite, config: app.config },
      body,
    );
    return reply.code(201).send({ user });
  });

  app.get('/admin/users', { preHandler: app.requireAdmin }, async () => {
    return { users: listUsers(app.db) };
  });
}
