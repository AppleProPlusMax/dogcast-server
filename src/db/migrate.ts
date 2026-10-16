import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

export function migrate(sqlite: Database.Database): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sqlPath = path.join(here, 'migrations', '0001_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  sqlite.exec(sql);
  ensureAbsoluteExpiryColumn(sqlite);
  const applied = sqlite.prepare('SELECT id FROM schema_migrations WHERE id = 1').get();
  if (!applied) {
    sqlite
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (1, ?)')
      .run(new Date().toISOString());
  }
}

function ensureAbsoluteExpiryColumn(sqlite: Database.Database): void {
  const columns = sqlite.prepare('PRAGMA table_info(refresh_sessions)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'absolute_expires_at')) {
    sqlite.exec('ALTER TABLE refresh_sessions ADD COLUMN absolute_expires_at TEXT');
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS watch_links (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  )`);
  const applied = sqlite.prepare('SELECT id FROM schema_migrations WHERE id = 2').get();
  if (applied) return;
  const now = Date.now();
  const idleMs = 12 * 60 * 60 * 1000;
  const absoluteMs = 7 * 24 * 60 * 60 * 1000;
  const rows = sqlite
    .prepare('SELECT id, created_at, expires_at, absolute_expires_at FROM refresh_sessions')
    .all() as Array<{ id: string; created_at: string; expires_at: string; absolute_expires_at: string | null }>;
  const update = sqlite.prepare(
    'UPDATE refresh_sessions SET expires_at = ?, absolute_expires_at = ? WHERE id = ?',
  );
  for (const row of rows) {
    const created = Date.parse(row.created_at);
    const createdMs = Number.isNaN(created) ? now : created;
    const absolute = row.absolute_expires_at ? Date.parse(row.absolute_expires_at) : createdMs + absoluteMs;
    const idle = Date.parse(row.expires_at);
    const expires = Math.min(Number.isNaN(idle) ? createdMs + idleMs : idle, createdMs + idleMs, absolute);
    update.run(new Date(expires).toISOString(), new Date(absolute).toISOString(), row.id);
  }
  sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (2, ?)').run(new Date().toISOString());
}
