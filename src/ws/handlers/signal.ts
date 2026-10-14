import { AppError, Errors } from '../../lib/errors.js';
import { signalSchema } from '../protocol.js';
import type { HubConn } from '../rooms.hub.js';
import type { HandlerDeps } from './presence.js';

export function handleSignal(deps: HandlerDeps, conn: HubConn, type: string, payload: unknown): void {
  const parsed = signalSchema.parse(payload ?? {});
  if (type === 'signal.offer' && parsed.sdp?.type !== 'offer') {
    throw Errors.validation('sdp.type must be offer');
  }
  if (type === 'signal.answer' && parsed.sdp?.type !== 'answer') {
    throw Errors.validation('sdp.type must be answer');
  }
  if (type === 'signal.ice-candidate' && (payload === null || typeof payload !== 'object' || !('candidate' in payload))) {
    throw Errors.validation('candidate is required');
  }
  const result = deps.hub.routeSignal(conn, type, parsed);
  if (!result.ok) throw new AppError(result.code, 403, result.message);
  deps.log.debug({ type, from: conn.connId, to: parsed.toConnId }, 'signal forwarded');
}
