import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema>;
