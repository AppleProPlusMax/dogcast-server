import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdBy: text('created_by'),
  maxViewers: integer('max_viewers').notNull().default(4),
  createdAt: text('created_at').notNull(),
});

export const roomMembers = sqliteTable(
  'room_members',
  {
    roomId: text('room_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.userId] })],
);

export const refreshSessions = sqliteTable('refresh_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  absoluteExpiresAt: text('absolute_expires_at'),
  revokedAt: text('revoked_at'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
});

export const watchLinks = sqliteTable('watch_links', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  roomId: text('room_id').notNull(),
  createdBy: text('created_by').notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
});

export const inviteCodes = sqliteTable('invite_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  createdBy: text('created_by').notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
});
