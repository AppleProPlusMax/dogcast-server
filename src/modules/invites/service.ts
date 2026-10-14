import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import type { AppDb } from '../../db/types.js';
import { inviteCodes } from '../../db/schema.js';
import { Errors, isUniqueConstraint } from '../../lib/errors.js';
import { hashToken, newId, newInviteCode } from '../../lib/tokens.js';

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export function consumeInvite(db: AppDb, code: string, now = new Date()): void {
  const normalized = normalizeInviteCode(code);
  if (!normalized) throw Errors.inviteInvalid();
  const invite = db.select().from(inviteCodes).where(eq(inviteCodes.codeHash, hashToken(normalized))).get();
  if (!invite || invite.revokedAt) throw Errors.inviteInvalid();
  if (invite.expiresAt && Date.parse(invite.expiresAt) <= now.getTime()) throw Errors.inviteInvalid();
  if (invite.usedCount >= invite.maxUses) throw Errors.inviteInvalid();
  db.update(inviteCodes)
    .set({ usedCount: invite.usedCount + 1 })
    .where(eq(inviteCodes.id, invite.id))
    .run();
}

export function createInvite(
  db: AppDb,
  input: { createdBy: string; maxUses: number; expiresInHours?: number },
): { code: string; id: string; expiresAt: string | null } {
  const expiresAt =
    input.expiresInHours === undefined
      ? null
      : new Date(Date.now() + input.expiresInHours * 3_600_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newInviteCode();
    const id = newId('invite');
    try {
      db.insert(inviteCodes)
        .values({
          id,
          codeHash: hashToken(normalizeInviteCode(code)),
          createdBy: input.createdBy,
          maxUses: input.maxUses,
          usedCount: 0,
          expiresAt,
          revokedAt: null,
          createdAt: new Date().toISOString(),
        })
        .run();
      return { code, id, expiresAt };
    } catch (err) {
      if (!isUniqueConstraint(err)) throw err;
    }
  }
  throw Errors.internal('Could not allocate invite code');
}
