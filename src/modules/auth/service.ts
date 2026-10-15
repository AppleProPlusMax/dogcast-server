import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import type { AppConfig } from '../../config.js';
import { refreshSessions, users } from '../../db/schema.js';
import { ensureDefaultRoom, ensureMembership } from '../../db/seed.js';
import type { AppDb } from '../../db/types.js';
import { AppError, Errors, isUniqueConstraint } from '../../lib/errors.js';
import { hashToken, newId, newOpaqueToken } from '../../lib/tokens.js';
import { consumeInvite } from '../invites/service.js';
import { findUserById, findUserByUsername, toPublicUser, type DbUser, type PublicUser } from '../users/service.js';
import { displayNameSchema, passwordSchema, usernameSchema } from '../users/schemas.js';
import { hashPassword, verifyPassword } from './password.js';

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  refreshMaxAgeSec: number;
  expiresIn: number;
  user: PublicUser;
};

export type AccessSigner = (user: PublicUser) => string | Promise<string>;

export type AuthDeps = {
  db: AppDb;
  sqlite: Database.Database;
  config: AppConfig;
  signAccess: AccessSigner;
};

function sessionDeadline(nowMs: number, absoluteMs: number, idleTtlSec: number) {
  const effectiveMs = Math.min(nowMs + idleTtlSec * 1000, absoluteMs);
  return {
    expiresAt: new Date(effectiveMs).toISOString(),
    maxAgeSec: Math.max(1, Math.floor((effectiveMs - nowMs) / 1000)),
  };
}

function insertRefreshSession(
  deps: AuthDeps,
  userId: string,
  refreshToken: string,
  absoluteExpiresAt: string,
  userAgent?: string | null,
): number {
  const nowMs = Date.now();
  const deadline = sessionDeadline(nowMs, Date.parse(absoluteExpiresAt), deps.config.REFRESH_IDLE_TTL_SEC);
  deps.db
    .insert(refreshSessions)
    .values({
      id: newId('sess'),
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: deadline.expiresAt,
      absoluteExpiresAt,
      revokedAt: null,
      userAgent: userAgent ?? null,
      createdAt: new Date(nowMs).toISOString(),
    })
    .run();
  return deadline.maxAgeSec;
}

async function issueSession(
  deps: AuthDeps,
  user: DbUser | PublicUser,
  userAgent?: string | null,
): Promise<IssuedSession> {
  const nowMs = Date.now();
  const refreshToken = newOpaqueToken();
  const absoluteExpiresAt = new Date(nowMs + deps.config.REFRESH_ABSOLUTE_TTL_SEC * 1000).toISOString();
  const refreshMaxAgeSec = insertRefreshSession(deps, user.id, refreshToken, absoluteExpiresAt, userAgent);
  const accessToken = await deps.signAccess(toPublicUser(user));
  return {
    accessToken,
    refreshToken,
    refreshMaxAgeSec,
    expiresIn: deps.config.JWT_ACCESS_TTL_SEC,
    user: toPublicUser(user),
  };
}

export async function login(
  deps: AuthDeps,
  input: { username: string; password: string },
  meta: { userAgent?: string | null } = {},
): Promise<IssuedSession> {
  const user = findUserByUsername(deps.db, input.username);
  if (!user) throw Errors.unauthorized('Invalid username or password');
  const matches = await verifyPassword(user.passwordHash, input.password);
  if (!matches) throw Errors.unauthorized('Invalid username or password');
  if (!user.isActive) throw Errors.forbidden('Account disabled');
  return issueSession(deps, user, meta.userAgent);
}

export async function register(
  deps: AuthDeps,
  input: { username: string; password: string; displayName: string; inviteCode?: string },
  meta: { userAgent?: string | null } = {},
): Promise<IssuedSession> {
  if (!deps.config.AUTH_PUBLIC_REGISTER && !input.inviteCode) {
    throw Errors.registerDisabled();
  }
  const username = usernameSchema.parse(input.username);
  const password = passwordSchema.parse(input.password);
  const displayName = displayNameSchema.parse(input.displayName);
  const passwordHash = await hashPassword(password, deps.config);
  const now = new Date().toISOString();
  const user: PublicUser = {
    id: newId('user'),
    username,
    displayName,
    role: 'member',
  };
  const run = deps.sqlite.transaction(() => {
    if (findUserByUsername(deps.db, username)) {
      throw Errors.conflict('Username already exists');
    }
    if (input.inviteCode) {
      consumeInvite(deps.db, input.inviteCode);
    } else if (!deps.config.AUTH_PUBLIC_REGISTER) {
      throw Errors.registerDisabled();
    }
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
    ensureMembership(deps.db, room.id, user.id, 'member');
  });
  try {
    run.immediate();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueConstraint(err)) throw Errors.conflict('Username already exists');
    throw err;
  }
  const created = findUserById(deps.db, user.id);
  if (!created) throw Errors.internal('User was not created');
  return issueSession(deps, created, meta.userAgent);
}

export async function refreshSession(deps: AuthDeps, refreshToken: string | undefined): Promise<IssuedSession> {
  if (!refreshToken) throw Errors.unauthorized('Missing refresh token');
  const tokenHash = hashToken(refreshToken);
  const existing = deps.db.select().from(refreshSessions).where(eq(refreshSessions.tokenHash, tokenHash)).get();
  const nowMs = Date.now();
  const absoluteMs = Date.parse(existing?.absoluteExpiresAt || '') || Date.parse(existing?.createdAt || '') + deps.config.REFRESH_ABSOLUTE_TTL_SEC * 1000;
  if (!existing || existing.revokedAt || Date.parse(existing.expiresAt) <= nowMs || absoluteMs <= nowMs) {
    throw Errors.unauthorized('Invalid refresh token');
  }
  const user = findUserById(deps.db, existing.userId);
  if (!user) throw Errors.unauthorized('Invalid refresh token');
  if (!user.isActive) throw Errors.forbidden('Account disabled');

  const nextRefresh = newOpaqueToken();
  const accessToken = await deps.signAccess(toPublicUser(user));
  const absoluteExpiresAt = new Date(absoluteMs).toISOString();
  const revokedAt = new Date(nowMs).toISOString();
  let refreshMaxAgeSec = 1;
  const run = deps.sqlite.transaction(() => {
    const current = deps.db.select().from(refreshSessions).where(eq(refreshSessions.id, existing.id)).get();
    const currentAbsolute = Date.parse(current?.absoluteExpiresAt || '') || absoluteMs;
    if (!current || current.revokedAt || Date.parse(current.expiresAt) <= Date.now() || currentAbsolute <= Date.now()) {
      throw Errors.unauthorized('Invalid refresh token');
    }
    refreshMaxAgeSec = insertRefreshSession(deps, user.id, nextRefresh, new Date(currentAbsolute).toISOString(), current.userAgent);
    deps.db.update(refreshSessions).set({ revokedAt }).where(eq(refreshSessions.id, current.id)).run();
  });
  try {
    run.immediate();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw err;
  }
  return {
    accessToken,
    refreshToken: nextRefresh,
    refreshMaxAgeSec,
    expiresIn: deps.config.JWT_ACCESS_TTL_SEC,
    user: toPublicUser(user),
  };
}

export function logout(deps: AuthDeps, refreshToken: string | undefined): void {
  if (!refreshToken) return;
  const existing = deps.db
    .select()
    .from(refreshSessions)
    .where(eq(refreshSessions.tokenHash, hashToken(refreshToken)))
    .get();
  if (!existing || existing.revokedAt) return;
  deps.db
    .update(refreshSessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(refreshSessions.id, existing.id))
    .run();
}
