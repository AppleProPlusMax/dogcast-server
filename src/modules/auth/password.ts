import argon2 from 'argon2';
import type { AppConfig } from '../../config.js';

export async function hashPassword(password: string, config: AppConfig): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.ARGON2_MEMORY_COST,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

const DUMMY_PASSWORD = 'dogcast-dummy-password-timing-equalizer';
const dummyHashes = new Map<string, Promise<string>>();

export function dummyPasswordHash(config: AppConfig): Promise<string> {
  const key = `${config.ARGON2_MEMORY_COST}:${config.ARGON2_TIME_COST}:${config.ARGON2_PARALLELISM}`;
  const existing = dummyHashes.get(key);
  if (existing) return existing;
  const pending = hashPassword(DUMMY_PASSWORD, config).catch((err: unknown) => {
    dummyHashes.delete(key);
    throw err;
  });
  dummyHashes.set(key, pending);
  return pending;
}
