import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import type { AppConfig } from '../../config.js';
import { ensureDefaultRoom, ensureMembership } from '../../db/seed.js';
import type { AppDb } from '../../db/types.js';
import { users } from '../../db/schema.js';
import { Errors, isUniqueConstraint } from '../../lib/errors.js';
import { newId } from '../../lib/tokens.js';
import { hashPassword } from '../auth/password.js';
import { displayNameSchema, passwordSchema, roleSchema, usernameSchema, type UserRole } from './schemas.js';

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
};

export type DbUser = PublicUser & {
  passwordHash: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserRow = typeof users.$inferSelect;

function mapUser(row: UserRow): DbUser {
  if (row.role !== 'admin' && row.role !== 'member') {
    throw Errors.internal('Invalid user role');
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    passwordHash: row.passwordHash,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPublicUser(user: Pick<DbUser, 'id' | 'username' | 'displayName' | 'role'>): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

export function findUserById(db: AppDb, id: string): DbUser | null {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  return row ? mapUser(row) : null;
}

export function findUserByUsername(db: AppDb, username: string): DbUser | null {
  const row = db.select().from(users).where(eq(users.username, username)).get();
  return row ? mapUser(row) : null;
}

export function listUsers(db: AppDb): Array<PublicUser & { isActive: boolean; createdAt: string }> {
  return db
    .select()
    .from(users)
    .all()
    .map((row) => {
      const user = mapUser(row);
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createUser(
  deps: { db: AppDb; sqlite: Database.Database; config: AppConfig },
  input: { username: string; password: string; displayName: string; role: UserRole },
): Promise<PublicUser> {
  const username = usernameSchema.parse(input.username);
  const password = passwordSchema.parse(input.password);
  const displayName = displayNameSchema.parse(input.displayName);
  const role = roleSchema.parse(input.role);
  if (findUserByUsername(deps.db, username)) {
    throw Errors.conflict('Username already exists');
  }
  const passwordHash = await hashPassword(password, deps.config);
  const now = new Date().toISOString();
  const user: PublicUser = {
    id: newId('user'),
    username,
    displayName,
    role,
  };
  const run = deps.sqlite.transaction(() => {
    deps.db
      .insert(users)
      .values({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        passwordHash,
        role: user.role,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const room = ensureDefaultRoom(deps.db, deps.config);
    ensureMembership(deps.db, room.id, user.id, user.role === 'admin' ? 'owner' : 'member');
  });
  try {
    run.immediate();
  } catch (err) {
    if (isUniqueConstraint(err)) throw Errors.conflict('Username already exists');
    throw err;
  }
  return user;
}
