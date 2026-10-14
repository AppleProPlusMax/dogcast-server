import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('create-admin', () => {
  it('stores an argon2id password hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dogcast-admin-'));
    const dbPath = path.join(dir, 'dogcast.db');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/create-admin.ts', '--username', 'hao', '--password', 'super-secret', '--display-name', 'Hao'],
      {
        cwd: serverRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_PATH: dbPath,
          JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
          TURN_AUTH_SECRET: 'test-turn-secret-0123456789',
          ARGON2_MEMORY_COST: '8192',
          ARGON2_TIME_COST: '1',
          ARGON2_PARALLELISM: '1',
        },
      },
    );
    expect(result.stderr || result.stdout).toBeTruthy();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('username=hao');

    const { db, sqlite } = openDatabase(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_PATH: dbPath,
        JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
        TURN_AUTH_SECRET: 'test-turn-secret-0123456789',
        ARGON2_MEMORY_COST: '8192',
        ARGON2_TIME_COST: '1',
        ARGON2_PARALLELISM: '1',
      }),
    );
    try {
      const user = db.select().from(users).where(eq(users.username, 'hao')).get();
      expect(user?.role).toBe('admin');
      expect(user?.displayName).toBe('Hao');
      expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);
    } finally {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
