import type { ShareEndReason } from './protocol.js';
import { envelope, type ServerMessage, type SignalPayload } from './protocol.js';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export type HubConn = {
  connId: string;
  userId: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  guest: boolean;
  guestRoomId: string | null;
  roomId: string | null;
  socket: SocketLike;
  joinedAt: number;
};

export type RoomMeta = {
  id: string;
  slug: string;
  name: string;
  maxViewers: number;
};

type ShareState =
  | { status: 'idle' }
  | {
      status: 'someone_sharing';
      publisherUserId: string;
      publisherConnId: string;
      startedAt: number;
    };

type RoomRuntime = RoomMeta & {
  share: ShareState;
  viewers: Map<string, string>;
  parents: Map<string, string>;
};

export type RouteResult = { ok: true } | { ok: false; code: string; message: string };

const OPEN = 1;

export class RoomsHub {
  private readonly connections = new Map<string, HubConn>();
  private readonly rooms = new Map<string, RoomRuntime>();

  get connectionCount(): number {
    return this.connections.size;
  }

  addConnection(input: Omit<HubConn, 'roomId' | 'joinedAt' | 'guest' | 'guestRoomId'> & {
    guest?: boolean;
    guestRoomId?: string | null;
    joinedAt?: number;
  }): HubConn {
    if (!input.guest) {
      for (const existing of [...this.connections.values()]) {
        if (existing.userId !== input.userId) continue;
        this.send(existing, envelope('session.replaced', { reason: 'SIGNED_IN_ELSEWHERE' }));
        this.removeConnection(existing.connId);
        try {
          existing.socket.close(4000, 'signed in elsewhere');
        } catch {
          // 旧连接可能已经断开。
        }
      }
    }
    const conn: HubConn = {
      ...input,
      guest: input.guest ?? false,
      guestRoomId: input.guestRoomId ?? null,
      roomId: null,
      joinedAt: input.joinedAt ?? Date.now(),
    };
    this.connections.set(conn.connId, conn);
    return conn;
  }

  getConnection(connId: string): HubConn | undefined {
    return this.connections.get(connId);
  }

  connectionsForRoom(roomId: string): Array<{ userId: string; connId: string }> {
    const found: Array<{ userId: string; connId: string }> = [];
    for (const conn of this.connections.values()) {
      if (conn.roomId === roomId) found.push({ userId: conn.userId, connId: conn.connId });
    }
    return found;
  }

  disconnectUser(userId: string): void {
    for (const conn of [...this.connections.values()]) {
      if (conn.userId !== userId) continue;
      this.removeConnection(conn.connId);
      try {
        conn.socket.close(4000, 'logged out');
      } catch {
        // 连接可能已经关掉。
      }
    }
  }

  removeConnection(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;
    this.connections.delete(connId);
    this.detach(conn);
  }

  joinRoom(conn: HubConn, room: RoomMeta, requestId?: string): void {
    if (conn.roomId === room.id) {
      this.ensureRoom(room);
      this.send(conn, envelope('room.snapshot', this.buildSnapshot(room.id, conn), requestId));
      return;
    }
    if (conn.roomId) this.detach(conn);
    conn.roomId = room.id;
    this.ensureRoom(room);
    this.send(conn, envelope('room.snapshot', this.buildSnapshot(room.id, conn), requestId));
    this.broadcast(
      room.id,
      envelope('presence.joined', {
        userId: conn.userId,
        connId: conn.connId,
        username: conn.username,
        displayName: conn.displayName,
        role: conn.role,
      }),
      conn.connId,
    );
  }

  leaveRoom(conn: HubConn): RouteResult {
    if (!conn.roomId) return { ok: false, code: 'NOT_IN_ROOM', message: 'Not in a room' };
    this.detach(conn);
    return { ok: true };
  }

  requestShare(conn: HubConn, requestId?: string): void {
    if (conn.guest) {
      this.send(conn, envelope('share.denied', { reason: 'GUEST' }, requestId));
      return;
    }
    if (!conn.roomId) {
      this.send(conn, envelope('share.denied', { reason: 'NOT_IN_ROOM' }, requestId));
      return;
    }
    const room = this.requireRoom(conn.roomId);
    if (room.share.status === 'someone_sharing') {
      if (room.share.publisherConnId === conn.connId) {
        this.send(conn, envelope('share.granted', { roomId: room.id }, requestId));
        return;
      }
      const reason = room.share.publisherUserId === conn.userId ? 'ALREADY_PUBLISHER' : 'SHARE_SLOT_TAKEN';
      this.send(conn, envelope('share.denied', { reason }, requestId));
      return;
    }
    room.share = {
      status: 'someone_sharing',
      publisherUserId: conn.userId,
      publisherConnId: conn.connId,
      startedAt: Date.now(),
    };
    this.send(conn, envelope('share.granted', { roomId: room.id }, requestId));
    this.broadcast(
      room.id,
      envelope('share.started', {
        publisherUserId: conn.userId,
        publisherConnId: conn.connId,
        displayName: conn.displayName,
      }),
    );
  }

  stopShare(conn: HubConn): RouteResult {
    if (!conn.roomId) return { ok: false, code: 'NOT_IN_ROOM', message: 'Not in a room' };
    const room = this.requireRoom(conn.roomId);
    if (room.share.status !== 'someone_sharing' || room.share.publisherConnId !== conn.connId) {
      return { ok: false, code: 'FORBIDDEN', message: 'Only the active publisher can stop sharing' };
    }
    this.endShare(conn.roomId, 'publisher_stop');
    return { ok: true };
  }

  kickShare(conn: HubConn): RouteResult {
    if (!conn.roomId) return { ok: false, code: 'NOT_IN_ROOM', message: 'Not in a room' };
    const room = this.requireRoom(conn.roomId);
    if (room.share.status !== 'someone_sharing') {
      return { ok: false, code: 'SHARE_NOT_ACTIVE', message: 'Nobody is sharing' };
    }
    const isPublisher = room.share.publisherConnId === conn.connId;
    if (conn.role !== 'admin' && !isPublisher) {
      return { ok: false, code: 'FORBIDDEN', message: 'Only an admin or the publisher can end the share' };
    }
    this.endShare(conn.roomId, 'kicked');
    return { ok: true };
  }

  claimViewer(conn: HubConn, requestId?: string): void {
    if (!conn.roomId) {
      this.send(conn, envelope('viewer.denied', { reason: 'NOT_IN_ROOM' }, requestId));
      return;
    }
    const room = this.requireRoom(conn.roomId);
    if (room.share.status !== 'someone_sharing') {
      this.send(conn, envelope('viewer.denied', { reason: 'NOT_SHARING' }, requestId));
      return;
    }
    if (room.share.publisherConnId === conn.connId) {
      this.send(conn, envelope('viewer.denied', { reason: 'IS_PUBLISHER' }, requestId));
      return;
    }
    if (room.viewers.has(conn.connId)) return;

    const countsTowardQuota = conn.userId !== room.share.publisherUserId;
    const userAlreadyViewing = [...room.viewers.values()].includes(conn.userId);
    if (countsTowardQuota && !userAlreadyViewing && this.viewerQuota(room) >= room.maxViewers) {
      this.send(
        conn,
        envelope('viewer.denied', { reason: 'ROOM_FULL_VIEWERS', maxViewers: room.maxViewers }, requestId),
      );
      return;
    }
    const parentConnId = this.pickParent(room);
    room.viewers.set(conn.connId, conn.userId);
    room.parents.set(conn.connId, parentConnId);
    this.broadcastViewers(room.id);
  }

  releaseViewer(conn: HubConn): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || !room.viewers.delete(conn.connId)) return;
    this.broadcastViewers(room.id);
  }

  routeSignal(sender: HubConn, type: string, payload: SignalPayload): RouteResult {
    if (!sender.roomId) return { ok: false, code: 'NOT_IN_ROOM', message: 'Not in a room' };
    if (payload.fromConnId !== sender.connId) {
      return { ok: false, code: 'SIGNAL_FORBIDDEN', message: 'fromConnId does not match this connection' };
    }
    if (payload.toConnId === payload.fromConnId) {
      return { ok: false, code: 'SIGNAL_FORBIDDEN', message: 'Cannot signal yourself' };
    }
    if (payload.roomId !== sender.roomId) {
      return { ok: false, code: 'SIGNAL_FORBIDDEN', message: 'Signal room does not match' };
    }
    const target = this.connections.get(payload.toConnId);
    if (!target || target.roomId !== sender.roomId) {
      return { ok: false, code: 'SIGNAL_FORBIDDEN', message: 'Target is not in this room' };
    }
    const room = this.requireRoom(sender.roomId);
    if (room.share.status !== 'someone_sharing') {
      return { ok: false, code: 'SIGNAL_FORBIDDEN', message: 'No active share' };
    }
    const senderIsPublisher = sender.connId === room.share.publisherConnId;
    const targetIsPublisher = target.connId === room.share.publisherConnId;
    const senderIsViewer = room.viewers.has(sender.connId);
    const targetIsViewer = room.viewers.has(target.connId);
    const senderIsParent = room.parents.get(target.connId) === sender.connId;
    const targetIsParent = room.parents.get(sender.connId) === target.connId;

    let allowed = false;
    if (type === 'signal.offer') allowed = senderIsParent && (senderIsPublisher || senderIsViewer) && targetIsViewer;
    else if (type === 'signal.answer') allowed = targetIsParent && senderIsViewer && (targetIsPublisher || targetIsViewer);
    else if (type === 'signal.renegotiate-ask') allowed = targetIsParent && senderIsViewer;
    else if (type === 'signal.ice-candidate') allowed = senderIsParent || targetIsParent;
    if (!allowed) return { ok: false, code: 'SIGNAL_FORBIDDEN', message: 'Signal path not allowed' };

    this.send(target, envelope(type, payload));
    return { ok: true };
  }

  send(conn: HubConn, message: ServerMessage): void {
    if (conn.socket.readyState !== OPEN) return;
    try {
      conn.socket.send(JSON.stringify(message));
    } catch {
      // The socket can close between the readyState check and send.
    }
  }

  private detach(conn: HubConn): void {
    const roomId = conn.roomId;
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    const wasPublisher = room?.share.status === 'someone_sharing' && room.share.publisherConnId === conn.connId;
    const wasViewer = room?.viewers.has(conn.connId) ?? false;
    conn.roomId = null;
    if (wasPublisher) {
      this.endShare(roomId, 'publisher_disconnect');
    } else if (wasViewer && room) {
      room.viewers.delete(conn.connId);
      this.reparent(room, conn.connId);
      this.broadcastViewers(roomId);
    }
    this.broadcast(
      roomId,
      envelope('presence.left', {
        userId: conn.userId,
        connId: conn.connId,
        username: conn.username,
        displayName: conn.displayName,
        role: conn.role,
      }),
    );
  }

  private endShare(roomId: string, reason: ShareEndReason): void {
    const room = this.rooms.get(roomId);
    if (!room || room.share.status !== 'someone_sharing') return;
    room.share = { status: 'idle' };
    const hadViewers = room.viewers.size > 0;
    room.viewers.clear();
    room.parents.clear();
    this.broadcast(roomId, envelope('share.ended', { reason }));
    if (hadViewers) this.broadcastViewers(roomId);
  }

  private ensureRoom(meta: RoomMeta): RoomRuntime {
    const existing = this.rooms.get(meta.id);
    if (existing) {
      existing.name = meta.name;
      existing.slug = meta.slug;
      existing.maxViewers = meta.maxViewers;
      return existing;
    }
    const created: RoomRuntime = {
      ...meta,
      share: { status: 'idle' },
      viewers: new Map(),
      parents: new Map(),
    };
    this.rooms.set(meta.id, created);
    return created;
  }

  private requireRoom(roomId: string): RoomRuntime {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room runtime missing: ${roomId}`);
    return room;
  }

  private viewerQuota(room: RoomRuntime): number {
    const publisherUserId = room.share.status === 'someone_sharing' ? room.share.publisherUserId : undefined;
    return new Set([...room.viewers.values()].filter((userId) => userId !== publisherUserId)).size;
  }

  private broadcastViewers(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const viewers = this.viewerRefs(room);
    this.broadcast(roomId, envelope('viewer.updated', { viewers, viewerCount: this.viewerQuota(room) }));
  }

  private viewerRefs(room: RoomRuntime) {
    return [...room.viewers.entries()].map(([connId, userId]) => ({
      userId,
      connId,
      parentConnId: room.parents.get(connId) ?? null,
    }));
  }

  private pickParent(room: RoomRuntime): string {
    if (room.share.status !== 'someone_sharing') return '';
    const publisher = room.share.publisherConnId;
    const root = [...room.viewers.keys()].find((id) => room.parents.get(id) === publisher);
    return root ?? publisher;
  }

  private reparent(room: RoomRuntime, goneConnId: string): void {
    room.parents.delete(goneConnId);
    if (room.share.status !== 'someone_sharing') return;
    const publisher = room.share.publisherConnId;
    const ids = [...room.viewers.keys()];
    if (ids.length === 0) return;
    let root = ids.find((id) => room.parents.get(id) === publisher);
    if (!root) {
      root = ids[0] ?? publisher;
      if (room.viewers.has(root)) room.parents.set(root, publisher);
    }
    for (const id of ids) {
      if (id === root) continue;
      const parent = room.parents.get(id);
      if (parent === goneConnId || !parent || !room.viewers.has(parent)) room.parents.set(id, root);
    }
  }

  private buildSnapshot(roomId: string, self: HubConn) {
    const room = this.requireRoom(roomId);
    const membersOnline = [...this.connections.values()]
      .filter((conn) => conn.roomId === roomId)
      .map((conn) => ({
        userId: conn.userId,
        connId: conn.connId,
        username: conn.username,
        displayName: conn.displayName,
        role: conn.role,
      }));
    const viewers = this.viewerRefs(room);
    return {
      room: { id: room.id, slug: room.slug, name: room.name, maxViewers: room.maxViewers },
      self: { userId: self.userId, connId: self.connId },
      membersOnline,
      share:
        room.share.status === 'idle'
          ? { status: 'idle' as const }
          : {
              status: 'someone_sharing' as const,
              publisherUserId: room.share.publisherUserId,
              publisherConnId: room.share.publisherConnId,
              startedAt: room.share.startedAt,
            },
      viewers,
      viewerCount: this.viewerQuota(room),
    };
  }

  private broadcast(roomId: string, message: ServerMessage, exceptConnId?: string): void {
    const payload = JSON.stringify(message);
    for (const conn of [...this.connections.values()]) {
      if (conn.roomId !== roomId || conn.connId === exceptConnId) continue;
      if (conn.socket.readyState !== OPEN) continue;
      try {
        conn.socket.send(payload);
      } catch {
        // Ignore a peer that disappeared mid-broadcast.
      }
    }
  }
}
