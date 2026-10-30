import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { ZodError } from 'zod';
import { asAppError, formatZodError, zodDetails } from '../lib/errors.js';
import { newId } from '../lib/tokens.js';
import { findUserById } from '../modules/users/service.js';
import { handleRoomJoin, handleRoomLeave } from './handlers/presence.js';
import { handleShareKick, handleShareRequest, handleShareStop, handleViewerClaim, handleViewerRelease } from './handlers/share.js';
import { handleSignal } from './handlers/signal.js';
import { CLIENT_MESSAGE_TYPES, clientEnvelopeSchema, envelope, type ServerMessage } from './protocol.js';
import type { HubConn } from './rooms.hub.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export function attachConnection(app: FastifyInstance, socket: WebSocket): void {
  let conn: HubConn | null = null;
  let closed = false;
  let queue = Promise.resolve();

  const sendRaw = (message: ServerMessage) => {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Ignore a socket that closed while we were writing.
    }
  };

  const authTimer = setTimeout(() => {
    if (!conn && !closed) socket.close(4001, 'auth timeout');
  }, app.config.WS_AUTH_TIMEOUT_MS);
  authTimer.unref();

  let idleTimer: NodeJS.Timeout;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!closed) socket.close(4000, 'idle timeout');
    }, app.config.WS_IDLE_TIMEOUT_MS);
    idleTimer.unref();
  };
  resetIdle();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(authTimer);
    clearTimeout(idleTimer);
    if (conn) app.hub.removeConnection(conn.connId);
  };

  socket.on('close', cleanup);
  socket.on('error', (err: unknown) => {
    app.log.debug({ err }, 'websocket error');
  });

  const authenticate = async (payload: unknown, requestId?: string) => {
    const token =
      typeof payload === 'object' && payload !== null && 'accessToken' in payload
        ? (payload as { accessToken?: unknown }).accessToken
        : undefined;
    if (typeof token !== 'string' || token.length === 0) {
      sendRaw(envelope('auth.error', { code: 'UNAUTHORIZED', message: 'accessToken is required' }, requestId));
      socket.close(4001, 'unauthorized');
      return;
    }
    try {
      const verified = await app.jwt.verify<{
        sub?: string;
        guest?: boolean;
        host?: boolean;
        name?: string;
        roomId?: string;
        exp?: number;
      }>(token);
      if (verified?.host && verified.sub && verified.roomId) {
        clearTimeout(authTimer);
        conn = app.hub.addConnection({
          connId: newId('conn'),
          userId: verified.sub,
          username: 'host',
          displayName: verified.name || '分享者',
          role: 'member',
          guest: false,
          guestRoomId: verified.roomId,
          guestExpiresAt: typeof verified.exp === 'number' ? verified.exp * 1000 : null,
          socket,
        });
        sendRaw(envelope('auth.ok', { userId: verified.sub, connId: conn.connId }, requestId));
        return;
      }
      if (verified?.guest && verified.sub && verified.roomId) {
        clearTimeout(authTimer);
        conn = app.hub.addConnection({
          connId: newId('conn'),
          userId: verified.sub,
          username: 'guest',
          displayName: verified.name || '访客',
          role: 'member',
          guest: true,
          guestRoomId: verified.roomId,
          guestExpiresAt: typeof verified.exp === 'number' ? verified.exp * 1000 : null,
          socket,
        });
        sendRaw(envelope('auth.ok', { userId: verified.sub, connId: conn.connId }, requestId));
        return;
      }
      const user = verified?.sub ? findUserById(app.db, verified.sub) : null;
      if (!user) {
        sendRaw(envelope('auth.error', { code: 'UNAUTHORIZED', message: 'Unauthorized' }, requestId));
        socket.close(4001, 'unauthorized');
        return;
      }
      if (!user.isActive) {
        sendRaw(envelope('auth.error', { code: 'FORBIDDEN', message: 'Account disabled' }, requestId));
        socket.close(4001, 'unauthorized');
        return;
      }
      clearTimeout(authTimer);
      const created = app.hub.addConnection({
        connId: newId('conn'),
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        socket,
      });
      conn = created;
      sendRaw(envelope('auth.ok', { userId: user.id, connId: created.connId }, requestId));
    } catch {
      sendRaw(envelope('auth.error', { code: 'UNAUTHORIZED', message: 'Unauthorized' }, requestId));
      socket.close(4001, 'unauthorized');
    }
  };

  const onMessage = async (data: RawData) => {
    if (closed) return;
    resetIdle();
    const text = rawToString(data);
    if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) {
      sendRaw(envelope('error', { code: 'VALIDATION_ERROR', message: 'Message too large' }));
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      sendRaw(envelope('error', { code: 'VALIDATION_ERROR', message: 'Invalid JSON' }));
      return;
    }
    const envelopeResult = clientEnvelopeSchema.safeParse(parsedJson);
    if (!envelopeResult.success) {
      sendRaw(envelope('error', { code: 'VALIDATION_ERROR', message: 'Invalid message envelope' }));
      return;
    }
    const msg = envelopeResult.data;
    if (!CLIENT_MESSAGE_TYPES.has(msg.type)) {
      sendRaw(envelope('error', { code: 'UNKNOWN_TYPE', message: 'Unknown message type' }, msg.requestId));
      return;
    }
    if (!conn) {
      if (msg.type !== 'auth') {
        sendRaw(envelope('auth.error', { code: 'UNAUTHORIZED', message: 'Authenticate first' }, msg.requestId));
        return;
      }
      await authenticate(msg.payload, msg.requestId);
      return;
    }
    if (msg.type === 'auth') {
      sendRaw(envelope('auth.error', { code: 'UNAUTHORIZED', message: 'Already authenticated' }, msg.requestId));
      return;
    }

    const deps = { db: app.db, hub: app.hub, log: app.log };
    try {
      switch (msg.type) {
        case 'room.join':
          handleRoomJoin(deps, conn, msg.payload, msg.requestId);
          break;
        case 'room.leave':
          handleRoomLeave(deps, conn, msg.requestId);
          break;
        case 'share.request':
          handleShareRequest(deps, conn, msg.requestId);
          break;
        case 'share.stop':
          handleShareStop(deps, conn, msg.requestId);
          break;
        case 'share.kick':
          handleShareKick(deps, conn, msg.requestId);
          break;
        case 'viewer.claim':
          handleViewerClaim(deps, conn, msg.requestId);
          break;
        case 'viewer.release':
          handleViewerRelease(deps, conn);
          break;
        case 'signal.offer':
        case 'signal.answer':
        case 'signal.ice-candidate':
        case 'signal.renegotiate-ask':
          handleSignal(deps, conn, msg.type, msg.payload);
          break;
        case 'ping': {
          if (conn.guest || conn.guestRoomId) {
            if (conn.guestExpiresAt !== null && Date.now() >= conn.guestExpiresAt) {
              sendRaw(envelope('auth.error', { code: 'UNAUTHORIZED', message: 'Unauthorized' }, msg.requestId));
              socket.close(4001, 'unauthorized');
              break;
            }
            app.hub.send(conn, envelope('pong', {}, msg.requestId));
            break;
          }
          let account: ReturnType<typeof findUserById> | undefined;
          try {
            account = findUserById(app.db, conn.userId);
          } catch (err) {
            app.log.error({ err }, 'account check failed');
            app.hub.send(conn, envelope('pong', {}, msg.requestId));
            break;
          }
          if (!account || !account.isActive) {
            sendRaw(
              envelope(
                'auth.error',
                {
                  code: account ? 'FORBIDDEN' : 'UNAUTHORIZED',
                  message: account ? 'Account disabled' : 'Unauthorized',
                },
                msg.requestId,
              ),
            );
            socket.close(4001, 'unauthorized');
            break;
          }
          app.hub.send(conn, envelope('pong', {}, msg.requestId));
          break;
        }
        case 'pong':
          break;
        default:
          break;
      }
    } catch (err) {
      const appError = asAppError(err);
      if (appError) {
        app.hub.send(conn, envelope('error', { code: appError.code, message: appError.message }, msg.requestId));
        return;
      }
      if (err instanceof ZodError) {
        app.hub.send(
          conn,
          envelope(
            'error',
            { code: 'VALIDATION_ERROR', message: formatZodError(err), details: zodDetails(err) },
            msg.requestId,
          ),
        );
        return;
      }
      app.log.error({ err }, 'websocket handler failed');
      app.hub.send(conn, envelope('error', { code: 'INTERNAL', message: 'Internal server error' }, msg.requestId));
    }
  };

  socket.on('message', (data: RawData) => {
    queue = queue.then(() => onMessage(data)).catch((err: unknown) => {
      app.log.error({ err }, 'websocket message failed');
    });
  });
}

export async function registerWsGateway(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    attachConnection(app, socket);
  });
}
