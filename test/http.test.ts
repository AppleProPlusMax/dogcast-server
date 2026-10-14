import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { refreshSessions, users } from '../src/db/schema.js';
import { hashToken } from '../src/lib/tokens.js';
import { createInvite } from '../src/modules/invites/service.js';
import { createUser } from '../src/modules/users/service.js';
import { TEST_PASSWORD, createTestApp } from './helpers.js';

describe('HTTP API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health without auth and uses the error envelope for unknown routes', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true, version: '0.1.0' });

    const missing = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('logs in, rotates refresh tokens, and logs out', async () => {
    const admin = await createUser(
      { db: app.db, sqlite: app.sqlite, config: app.config },
      { username: 'hao', password: TEST_PASSWORD, displayName: 'Hao', role: 'admin' },
    );

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'hao', password: 'nope-nope' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('UNAUTHORIZED');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'x', password: 'short' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'user-agent': 'vitest-agent' },
      payload: { username: 'hao', password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.user).toEqual({ id: admin.id, username: 'hao', displayName: 'Hao', role: 'admin' });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const cookieHeader = String(login.headers['set-cookie']);
    expect(cookieHeader).toMatch(/dogcast_refresh=/);
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/Path=\/api\/auth/i);
    const payload = JSON.parse(Buffer.from(body.accessToken.split('.')[1], 'base64url').toString());
    expect(payload.sub).toBe(admin.id);
    expect(payload.username).toBe('hao');
    expect(payload.role).toBe('admin');
    expect(payload.exp - payload.iat).toBe(900);

    const refreshCookie = login.cookies.find((cookie) => cookie.name === 'dogcast_refresh');
    expect(refreshCookie?.value).toBeTruthy();
    const session = app.db.select().from(refreshSessions).where(eq(refreshSessions.userId, admin.id)).get();
    expect(session?.userAgent).toBe('vitest-agent');
    expect(session?.tokenHash).toBe(hashToken(refreshCookie!.value));

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('hao');

    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anonymous.statusCode).toBe(401);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `dogcast_refresh=${refreshCookie!.value}` },
    });
    expect(refreshed.statusCode).toBe(200);
    const nextCookie = refreshed.cookies.find((cookie) => cookie.name === 'dogcast_refresh');
    expect(nextCookie?.value).toBeTruthy();
    expect(nextCookie?.value).not.toBe(refreshCookie!.value);

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `dogcast_refresh=${refreshCookie!.value}` },
    });
    expect(reused.statusCode).toBe(401);

    const rotated = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `dogcast_refresh=${nextCookie!.value}` },
    });
    expect(rotated.statusCode).toBe(200);
    const latest = rotated.cookies.find((cookie) => cookie.name === 'dogcast_refresh')!.value;

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `dogcast_refresh=${latest}` },
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `dogcast_refresh=${latest}` },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('rejects a disabled account after the password matches', async () => {
    await createUser(
      { db: app.db, sqlite: app.sqlite, config: app.config },
      { username: 'disabled', password: TEST_PASSWORD, displayName: 'Disabled', role: 'member' },
    );
    app.db.update(users).set({ isActive: 0 }).where(eq(users.username, 'disabled')).run();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'disabled', password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('registers with an invite, joins home, and keeps admin APIs closed', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'hao', password: TEST_PASSWORD },
    });
    const token = login.json().accessToken as string;
    const auth = { authorization: `Bearer ${token}` };

    const closed = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', password: TEST_PASSWORD, displayName: 'Alice' },
    });
    expect(closed.statusCode).toBe(403);
    expect(closed.json().error.code).toBe('REGISTER_DISABLED');

    const invite = await app.inject({
      method: 'POST',
      url: '/api/admin/invites',
      headers: auth,
      payload: { maxUses: 1, expiresInHours: 72 },
    });
    expect(invite.statusCode).toBe(201);
    const code = invite.json().code as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', password: TEST_PASSWORD, displayName: 'Alice', inviteCode: code.toLowerCase() },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().user).toMatchObject({ username: 'alice', displayName: 'Alice', role: 'member' });

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'bob', password: TEST_PASSWORD, displayName: 'Bob', inviteCode: code },
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json().error.code).toBe('INVITE_INVALID');

    const room = await app.inject({ method: 'GET', url: '/api/rooms/default', headers: { authorization: `Bearer ${registered.json().accessToken}` } });
    expect(room.statusCode).toBe(200);
    expect(room.json().room).toMatchObject({ id: 'room_home', slug: 'home', name: '家庭房', maxViewers: 4 });
    expect(room.json().membership.role).toBe('member');

    const members = await app.inject({
      method: 'GET',
      url: `/api/rooms/${room.json().room.id}/members`,
      headers: { authorization: `Bearer ${registered.json().accessToken}` },
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().members.map((member: { username: string }) => member.username)).toEqual(expect.arrayContaining(['hao', 'alice']));

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${registered.json().accessToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth,
      payload: { username: 'bob', password: TEST_PASSWORD, displayName: 'Bob', role: 'member' },
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain('password');
    expect(listed.json().users.map((user: { username: string }) => user.username)).toContain('bob');
  });

  it('returns TURN temporary credentials derived with HMAC-SHA1', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'hao', password: TEST_PASSWORD },
    });
    const denied = await app.inject({ method: 'GET', url: '/api/ice/servers' });
    expect(denied.statusCode).toBe(401);

    const res = await app.inject({
      method: 'GET',
      url: '/api/ice/servers',
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ttlSeconds).toBe(3600);
    const turn = body.iceServers.find((server: { username?: string }) => server.username);
    const [expiry, userId] = String(turn.username).split(':');
    expect(userId).toBe(login.json().user.id);
    expect(Number(expiry)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const expected = createHmac('sha1', app.config.TURN_AUTH_SECRET).update(turn.username).digest('base64');
    expect(turn.credential).toBe(expected);
    expect(turn.urls).toEqual([
      'turn:turn.dogleaf.cn:3478?transport=udp',
      'turn:turn.dogleaf.cn:3478?transport=tcp',
      'turns:turn.dogleaf.cn:5349?transport=tcp',
    ]);
  });

  it('allows the configured browser origin and rejects others', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });

  it('does not store invite codes in plaintext', async () => {
    const admin = app.db.select().from(users).where(eq(users.username, 'hao')).get();
    const invite = createInvite(app.db, { createdBy: admin!.id, maxUses: 1, expiresInHours: 1 });
    const { inviteCodes } = await import('../src/db/schema.js');
    const row = app.db.select().from(inviteCodes).where(eq(inviteCodes.id, invite.id)).get();
    expect(row?.codeHash).toBe(hashToken(invite.code));
    expect(row?.codeHash).not.toBe(invite.code);
  });
});

describe('rate limit', () => {
  it('returns RATE_LIMITED on the login route', async () => {
    const app = await createTestApp({ LOGIN_RATE_LIMIT_MAX: '2', LOGIN_RATE_LIMIT_WINDOW_MS: '60000' });
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'hao', password: TEST_PASSWORD },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'hao', password: TEST_PASSWORD },
      });
      const third = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'hao', password: TEST_PASSWORD },
      });
      expect(first.statusCode).toBe(401);
      expect(second.statusCode).toBe(401);
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });
});

describe('public register', () => {
  it('allows registration when public register is enabled', async () => {
    const app = await createTestApp({ AUTH_PUBLIC_REGISTER: 'true' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'public_user', password: TEST_PASSWORD, displayName: 'Public' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().user.username).toBe('public_user');
    } finally {
      await app.close();
    }
  });
});
