import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

export function migrate(sqlite: Database.Database): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sqlPath = path.join(here, 'migrations', '0001_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  sqlite.exec(sql);
  const applied = sqlite.prepare('SELECT id FROM schema_migrations WHERE id = 1').get();
  if (!applied) {
    sqlite
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (1, ?)')
      .run(new Date().toISOString());
  }
}
