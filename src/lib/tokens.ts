import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ulid } from 'ulid';

export const REFRESH_COOKIE_NAME = 'dogcast_refresh';

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i += 1) {
    raw += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
