import { envelope } from '../protocol.js';
import type { HandlerDeps } from './presence.js';
import type { HubConn } from '../rooms.hub.js';

function fail(deps: HandlerDeps, conn: HubConn, requestId: string | undefined, code: string, message: string): void {
  deps.hub.send(conn, envelope('error', { code, message }, requestId));
}

export function handleShareRequest(deps: HandlerDeps, conn: HubConn, requestId?: string): void {
  deps.hub.requestShare(conn, requestId);
}

export function handleShareStop(deps: HandlerDeps, conn: HubConn, requestId?: string): void {
  const result = deps.hub.stopShare(conn);
  if (!result.ok) fail(deps, conn, requestId, result.code, result.message);
  else deps.log.info({ connId: conn.connId, roomId: conn.roomId }, 'share stopped');
}

export function handleShareKick(deps: HandlerDeps, conn: HubConn, requestId?: string): void {
  const result = deps.hub.kickShare(conn);
  if (!result.ok) fail(deps, conn, requestId, result.code, result.message);
  else deps.log.info({ connId: conn.connId, roomId: conn.roomId }, 'share kicked');
}

export function handleViewerClaim(deps: HandlerDeps, conn: HubConn, requestId?: string): void {
  deps.hub.claimViewer(conn, requestId);
}

export function handleViewerRelease(deps: HandlerDeps, conn: HubConn): void {
  deps.hub.releaseViewer(conn);
}
