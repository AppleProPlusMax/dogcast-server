import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/modules/users/service.js';
import { TEST_PASSWORD, createTestApp, listen } from './helpers.js';
import { TestClient } from './wsClient.js';

async function login(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: TEST_PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().accessToken as string;
}

describe('websocket signaling', () => {
  let app: FastifyInstance;
  let port = 0;
  let tokens: Record<string, string> = {};
  const clients: TestClient[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    for (const username of ['admin', 'pub', 'viewer1', 'viewer2', 'viewer3', 'viewer4', 'viewer5']) {
      await createUser(
        { db: app.db, sqlite: app.sqlite, config: app.config },
        {
          username,
          password: TEST_PASSWORD,
          displayName: username,
          role: username === 'admin' ? 'admin' : 'member',
        },
      );
      tokens[username] = await login(app, username);
    }
    port = await listen(app);
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    const start = Date.now();
    while (app.hub.connectionCount > 0) {
      if (Date.now() - start > 2000) throw new Error('connections did not close');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function open(username: string): Promise<TestClient> {
    const client = new TestClient(`ws://127.0.0.1:${port}/ws`);
    clients.push(client);
    await client.ready();
    const auth = client.waitFor((message) => message.type === 'auth.ok' || message.type === 'auth.error');
    client.send('auth', { accessToken: tokens[username] }, `auth-${username}`);
    const message = await auth;
    expect(message.type).toBe('auth.ok');
    return client;
  }

  async function join(client: TestClient) {
    const snapshot = client.waitFor((message) => message.type === 'room.snapshot');
    client.send('room.join', { slug: 'home' }, 'join');
    return snapshot;
  }

  it('closes the socket when auth does not arrive in time', async () => {
    const timeoutApp = await createTestApp({ WS_AUTH_TIMEOUT_MS: '400', WS_IDLE_TIMEOUT_MS: '10000' });
    const timeoutPort = await listen(timeoutApp);
    const client = new TestClient(`ws://127.0.0.1:${timeoutPort}/ws`);
    try {
      await client.ready();
      expect(await client.closed()).toBe(4001);
    } finally {
      client.close();
      await timeoutApp.close();
    }
  });

  it('rejects a bad token and answers ping after auth', async () => {
    const client = new TestClient(`ws://127.0.0.1:${port}/ws`);
    clients.push(client);
    await client.ready();
    const failed = client.waitFor((message) => message.type === 'auth.error');
    client.send('auth', { accessToken: 'not-a-jwt' }, 'bad');
    expect((await failed).payload.code).toBe('UNAUTHORIZED');
    expect(await client.closed()).toBe(4001);

    const authed = await open('pub');
    const pong = authed.waitFor((message) => message.type === 'pong');
    authed.send('ping', {}, 'ping-1');
    expect((await pong).requestId).toBe('ping-1');

    const unknown = authed.waitFor((message) => message.type === 'error');
    authed.ws.send(JSON.stringify({ v: 1, type: 'nope', payload: {} }));
    expect((await unknown).payload.code).toBe('UNKNOWN_TYPE');
  });

  it('shares to one viewer, rejects a second publisher, and forwards only legal signals', async () => {
    const publisher = await open('pub');
    const viewer = await open('viewer1');
    const publisherSnap = await join(publisher);
    const joined = publisher.waitFor((message) => message.type === 'presence.joined');
    const viewerSnap = await join(viewer);
    await joined;
    expect(viewerSnap.payload.membersOnline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'pub' }),
        expect.objectContaining({ displayName: 'viewer1' }),
      ]),
    );

    const started = viewer.waitFor((message) => message.type === 'share.started');
    const granted = publisher.waitFor((message) => message.type === 'share.granted');
    publisher.send('share.request', {}, 'share');
    expect((await granted).payload.roomId).toBe(publisherSnap.payload.room.id);
    expect((await started).payload.publisherConnId).toBe(publisherSnap.payload.self.connId);

    const denied = viewer.waitFor((message) => message.type === 'share.denied');
    viewer.send('share.request', {}, 'steal');
    expect((await denied).payload.reason).toBe('SHARE_SLOT_TAKEN');

    const updated = publisher.waitFor((message) => message.type === 'viewer.updated');
    viewer.send('viewer.claim', {}, 'claim');
    const viewerState = await updated;
    expect(viewerState.payload.viewerCount).toBe(1);

    const roomId = publisherSnap.payload.room.id as string;
    const publisherConnId = publisherSnap.payload.self.connId as string;
    const viewerConnId = viewerSnap.payload.self.connId as string;
    const offer = viewer.waitFor((message) => message.type === 'signal.offer');
    publisher.send('signal.offer', {
      roomId,
      toConnId: viewerConnId,
      fromConnId: publisherConnId,
      sdp: { type: 'offer', sdp: 'v=0' },
    });
    expect((await offer).payload.sdp).toEqual({ type: 'offer', sdp: 'v=0' });

    const rejected = viewer.waitFor((message) => message.type === 'error' && message.payload.code === 'SIGNAL_FORBIDDEN');
    viewer.send('signal.offer', {
      roomId,
      toConnId: publisherConnId,
      fromConnId: viewerConnId,
      sdp: { type: 'offer', sdp: 'v=nope' },
    });
    await rejected;
    expect(publisher.messages.filter((message) => message.type === 'signal.offer')).toHaveLength(0);

    const ended = viewer.waitFor((message) => message.type === 'share.ended');
    publisher.send('share.stop', {}, 'stop');
    expect((await ended).payload.reason).toBe('publisher_stop');
  });

  it('denies the fifth distinct viewer and lets an admin kick', async () => {
    const publisher = await open('pub');
    const viewers = [];
    for (const name of ['viewer1', 'viewer2', 'viewer3', 'viewer4', 'viewer5']) viewers.push(await open(name));
    const admin = await open('admin');
    await join(publisher);
    for (const viewer of viewers) await join(viewer);
    await join(admin);

    const granted = publisher.waitFor((message) => message.type === 'share.granted');
    publisher.send('share.request', {}, 'share');
    await granted;

    for (const viewer of viewers.slice(0, 4)) {
      const updated = publisher.waitFor((message) => message.type === 'viewer.updated');
      viewer.send('viewer.claim', {}, `claim-${viewer}`);
      await updated;
    }
    const denied = viewers[4]!.waitFor((message) => message.type === 'viewer.denied');
    viewers[4]!.send('viewer.claim', {}, 'claim-5');
    expect((await denied).payload).toMatchObject({ reason: 'ROOM_FULL_VIEWERS', maxViewers: 4 });

    const kicked = publisher.waitFor((message) => message.type === 'share.ended');
    admin.send('share.kick', {}, 'kick');
    expect((await kicked).payload.reason).toBe('kicked');
  });

  it('ends the share when the publisher socket drops', async () => {
    const publisher = await open('pub');
    const viewer = await open('viewer2');
    await join(publisher);
    await join(viewer);
    const granted = publisher.waitFor((message) => message.type === 'share.granted');
    publisher.send('share.request', {}, 'share');
    await granted;
    const ended = viewer.waitFor((message) => message.type === 'share.ended');
    publisher.close();
    expect((await ended).payload.reason).toBe('publisher_disconnect');
  });

  it('closes an idle authenticated socket', async () => {
    const idleApp = await createTestApp({ WS_IDLE_TIMEOUT_MS: '700', WS_AUTH_TIMEOUT_MS: '5000' });
    try {
      await createUser(
        { db: idleApp.db, sqlite: idleApp.sqlite, config: idleApp.config },
        { username: 'idle', password: TEST_PASSWORD, displayName: 'Idle', role: 'member' },
      );
      const idlePort = await listen(idleApp);
      const token = await login(idleApp, 'idle');
      const client = new TestClient(`ws://127.0.0.1:${idlePort}/ws`);
      await client.ready();
      const authed = client.waitFor((message) => message.type === 'auth.ok');
      client.send('auth', { accessToken: token }, 'auth');
      await authed;
      expect(await client.closed()).toBe(4000);
    } finally {
      await idleApp.close();
    }
  });
});
