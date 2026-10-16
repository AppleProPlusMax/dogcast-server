import { z } from 'zod';

export type ShareEndReason = 'publisher_stop' | 'publisher_disconnect' | 'kicked' | 'replaced_denied';

export type ServerMessage = {
  v: 1;
  type: string;
  requestId?: string;
  ts: number;
  payload: unknown;
};

export function envelope(type: string, payload: unknown, requestId?: string): ServerMessage {
  return {
    v: 1,
    type,
    ...(requestId ? { requestId } : {}),
    ts: Date.now(),
    payload,
  };
}

export const clientEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.string().min(1).max(64),
  requestId: z.string().min(1).max(80).optional(),
  ts: z.number().optional(),
  payload: z.unknown().optional(),
});

export const roomJoinSchema = z
  .object({
    roomId: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.roomId || value.slug), { message: 'roomId or slug is required' });

const iceCandidateSchema = z.object({
  candidate: z.string().optional(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

export const signalSchema = z.object({
  roomId: z.string().min(1),
  toConnId: z.string().min(1),
  fromConnId: z.string().min(1),
  sdp: z
    .object({
      type: z.enum(['offer', 'answer']),
      sdp: z.string().max(60_000),
    })
    .optional(),
  candidate: iceCandidateSchema.nullable().optional(),
});

export type SignalPayload = z.infer<typeof signalSchema>;

export const CLIENT_MESSAGE_TYPES = new Set([
  'auth',
  'room.join',
  'room.leave',
  'share.request',
  'share.stop',
  'share.kick',
  'viewer.claim',
  'viewer.release',
  'signal.offer',
  'signal.answer',
  'signal.ice-candidate',
  'signal.renegotiate-ask',
  'ping',
  'pong',
]);
