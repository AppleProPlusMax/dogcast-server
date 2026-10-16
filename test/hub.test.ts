import { describe, expect, it } from 'vitest';
import { RoomsHub, type SocketLike } from '../src/ws/rooms.hub.js';

class FakeSocket implements SocketLike {
  readyState = 1;
  sent: Array<{ type: string; payload: any; requestId?: string }> = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3;
  }

  ofType(type: string) {
    return this.sent.filter((message) => message.type === type);
  }
}

const room = { id: 'room_home', slug: 'home', name: '家庭房', maxViewers: 4 };

function connect(hub: RoomsHub, id: string, userId = id, role: 'admin' | 'member' = 'member') {
  const socket = new FakeSocket();
  const conn = hub.addConnection({
    connId: `conn_${id}`,
    userId: `user_${userId}`,
    username: id,
    displayName: id,
    role,
    socket,
  });
  hub.joinRoom(conn, room);
  return { conn, socket };
}

describe('RoomsHub', () => {
  it('grants one publisher and denies the next requester', () => {
    const hub = new RoomsHub();
    const publisher = connect(hub, 'pub');
    const other = connect(hub, 'other');

    hub.requestShare(publisher.conn, 'req-1');
    hub.requestShare(publisher.conn, 'req-2');
    hub.requestShare(other.conn, 'req-3');

    expect(publisher.socket.ofType('share.granted')).toHaveLength(2);
    expect(publisher.socket.ofType('share.started')).toHaveLength(1);
    expect(other.socket.ofType('share.denied')[0]?.payload.reason).toBe('SHARE_SLOT_TAKEN');
    expect(other.socket.ofType('share.started')).toHaveLength(1);
  });

  it('keeps only the newest connection for one account', () => {
    const hub = new RoomsHub();
    const first = connect(hub, 'a', 'same');
    const second = connect(hub, 'b', 'same');
    expect(first.socket.ofType('session.replaced')[0]?.payload.reason).toBe('SIGNED_IN_ELSEWHERE');
    expect(first.socket.readyState).toBe(3);
    expect(hub.connectionCount).toBe(1);
    hub.requestShare(second.conn);
    expect(second.socket.ofType('share.granted')).toHaveLength(1);
    expect(first.socket.ofType('share.denied')).toHaveLength(0);
  });

  it('limits viewer slots by user and ignores the publisher', () => {
    const hub = new RoomsHub();
    const publisher = connect(hub, 'pub');
    hub.requestShare(publisher.conn);
    const viewers = ['v1', 'v2', 'v3', 'v4'].map((id) => connect(hub, id));
    const fifth = connect(hub, 'v5');

    hub.claimViewer(publisher.conn);
    expect(publisher.socket.ofType('viewer.denied')[0]?.payload.reason).toBe('IS_PUBLISHER');

    for (const viewer of viewers) hub.claimViewer(viewer.conn);
    hub.claimViewer(fifth.conn);

    expect(fifth.socket.ofType('viewer.denied')[0]?.payload).toEqual({ reason: 'ROOM_FULL_VIEWERS', maxViewers: 4 });
    const updates = viewers[3]?.socket.ofType('viewer.updated') ?? [];
    const latest = updates[updates.length - 1]?.payload;
    expect(latest.viewerCount).toBe(4);
  });

  it('returns to idle when the publisher disconnects', () => {
    const hub = new RoomsHub();
    const publisher = connect(hub, 'pub');
    const viewer = connect(hub, 'view');
    hub.requestShare(publisher.conn);
    hub.claimViewer(viewer.conn);
    hub.removeConnection(publisher.conn.connId);
    expect(viewer.socket.ofType('share.ended')[0]?.payload.reason).toBe('publisher_disconnect');
    expect(viewer.socket.ofType('viewer.updated').at(-1)?.payload).toEqual({ viewers: [], viewerCount: 0 });
    expect(viewer.socket.ofType('presence.left')[0]?.payload.connId).toBe(publisher.conn.connId);
  });

  it('routes offers, answers, and ICE only between the publisher and a viewer', () => {
    const hub = new RoomsHub();
    const publisher = connect(hub, 'pub');
    const viewer = connect(hub, 'view');
    const outsider = connect(hub, 'out');
    hub.requestShare(publisher.conn);
    hub.claimViewer(viewer.conn);

    const offer = {
      roomId: room.id,
      toConnId: viewer.conn.connId,
      fromConnId: publisher.conn.connId,
      sdp: { type: 'offer' as const, sdp: 'v=0' },
    };
    expect(hub.routeSignal(publisher.conn, 'signal.offer', offer).ok).toBe(true);
    expect(viewer.socket.ofType('signal.offer')[0]?.payload.sdp.sdp).toBe('v=0');

    expect(
      hub.routeSignal(viewer.conn, 'signal.offer', { ...offer, fromConnId: viewer.conn.connId, toConnId: publisher.conn.connId }).ok,
    ).toBe(false);
    expect(publisher.socket.ofType('signal.offer')).toHaveLength(0);

    expect(
      hub.routeSignal(viewer.conn, 'signal.answer', {
        roomId: room.id,
        toConnId: publisher.conn.connId,
        fromConnId: viewer.conn.connId,
        sdp: { type: 'answer', sdp: 'v=answer' },
      }).ok,
    ).toBe(true);

    expect(
      hub.routeSignal(viewer.conn, 'signal.ice-candidate', {
        roomId: room.id,
        toConnId: publisher.conn.connId,
        fromConnId: viewer.conn.connId,
        candidate: null,
      }).ok,
    ).toBe(true);
    expect(
      hub.routeSignal(publisher.conn, 'signal.ice-candidate', {
        roomId: room.id,
        toConnId: viewer.conn.connId,
        fromConnId: publisher.conn.connId,
        candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
      }).ok,
    ).toBe(true);

    expect(
      hub.routeSignal(viewer.conn, 'signal.renegotiate-ask', {
        roomId: room.id,
        toConnId: publisher.conn.connId,
        fromConnId: viewer.conn.connId,
      }).ok,
    ).toBe(true);

    const mismatched = hub.routeSignal(publisher.conn, 'signal.offer', { ...offer, fromConnId: 'conn_other' });
    expect(mismatched).toMatchObject({ ok: false, code: 'SIGNAL_FORBIDDEN' });

    const toOutsider = hub.routeSignal(publisher.conn, 'signal.offer', { ...offer, toConnId: outsider.conn.connId });
    expect(toOutsider).toMatchObject({ ok: false, code: 'SIGNAL_FORBIDDEN' });
    expect(outsider.socket.ofType('signal.offer')).toHaveLength(0);
  });

  it('disconnects the account without announcing a replacement', () => {
    const hub = new RoomsHub();
    const current = connect(hub, 'a', 'same');
    hub.disconnectUser('user_same');
    expect(current.socket.readyState).toBe(3);
    expect(current.socket.ofType('session.replaced')).toHaveLength(0);
    expect(hub.connectionCount).toBe(0);
  });

  it('lets an admin kick and only the publisher stop', () => {
    const hub = new RoomsHub();
    const publisher = connect(hub, 'pub');
    const viewer = connect(hub, 'view');
    const admin = connect(hub, 'admin', 'admin', 'admin');
    hub.requestShare(publisher.conn);
    expect(hub.kickShare(viewer.conn)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(hub.stopShare(viewer.conn)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(hub.kickShare(admin.conn).ok).toBe(true);
    expect(publisher.socket.ofType('share.ended')[0]?.payload.reason).toBe('kicked');
    expect(hub.stopShare(publisher.conn)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
