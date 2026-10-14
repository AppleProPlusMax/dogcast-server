import { z } from 'zod';

export const usernameSchema = z.string().regex(/^[a-zA-Z0-9_]{3,32}$/);
export const passwordSchema = z.string().min(8).max(128);
export const displayNameSchema = z.string().trim().min(1).max(64);
export const roleSchema = z.enum(['admin', 'member']);

export type UserRole = z.infer<typeof roleSchema>;
