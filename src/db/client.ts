import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { AppConfig } from '../config.js';
import { migrate } from './migrate.js';
import * as schema from './schema.js';
import { backfillHomeMembers } from './seed.js';
import type { AppDb } from './types.js';

export type { AppDb };

export function openDatabase(config: AppConfig): { sqlite: Database.Database; db: AppDb } {
  if (config.DATABASE_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(config.DATABASE_PATH)), { recursive: true });
  }
  const sqlite = new Database(config.DATABASE_PATH);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 3000');
  if (config.DATABASE_PATH !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(path.resolve(config.DATABASE_PATH), 0o600);
      } catch {
        // Permissions are best-effort outside production Unix hosts.
      }
    }
  }
  migrate(sqlite);
  const db = drizzle(sqlite, { schema });
  backfillHomeMembers(db, config);
  return { sqlite, db };
}
