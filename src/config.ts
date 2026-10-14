import { z } from 'zod';

export const APP_VERSION = '0.1.0';

const DEV_ACCESS_SECRET = 'dev-only-access-secret-change-me';
const DEV_TURN_SECRET = 'dev-only-turn-secret-change-me';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().min(1).default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_PATH: z.string().min(1).default('./data/dogcast.db'),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_SEC: z.coerce.number().int().positive().default(1_209_600),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  AUTH_PUBLIC_REGISTER: z.enum(['true', 'false']).default('false'),
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(65_536),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(4),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  TURN_AUTH_SECRET: z.string().optional(),
  TURN_URLS: z.string().default(''),
  TURNS_URLS: z.string().default(''),
  STUN_URLS: z.string().default(''),
  TURN_CREDENTIAL_TTL_SEC: z.coerce.number().int().positive().default(3600),
  DEFAULT_ROOM_SLUG: z.string().min(1).default('home'),
  DEFAULT_ROOM_NAME: z.string().min(1).default('家庭房'),
  MAX_VIEWERS: z.coerce.number().int().positive().default(4),
  WS_AUTH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
});

export type AppConfig = {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  PUBLIC_BASE_URL: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  DATABASE_PATH: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SEC: number;
  REFRESH_TTL_SEC: number;
  COOKIE_SECURE: boolean;
  AUTH_PUBLIC_REGISTER: boolean;
  ARGON2_MEMORY_COST: number;
  ARGON2_TIME_COST: number;
  ARGON2_PARALLELISM: number;
  CORS_ORIGINS: string[];
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_TIME_WINDOW_MS: number;
  LOGIN_RATE_LIMIT_MAX: number;
  LOGIN_RATE_LIMIT_WINDOW_MS: number;
  TURN_AUTH_SECRET: string;
  TURN_URLS: string[];
  TURNS_URLS: string[];
  STUN_URLS: string[];
  TURN_CREDENTIAL_TTL_SEC: number;
  DEFAULT_ROOM_SLUG: string;
  DEFAULT_ROOM_NAME: string;
  MAX_VIEWERS: number;
  WS_AUTH_TIMEOUT_MS: number;
  WS_IDLE_TIMEOUT_MS: number;
};

function csv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function requireSecret(name: string, value: string | undefined, devFallback: string, nodeEnv: string): string {
  const secret = value && value.length > 0 ? value : nodeEnv === 'production' ? '' : devFallback;
  if (!secret || secret.length < 16) {
    throw new Error(`${name} must be set to at least 16 characters`);
  }
  if (nodeEnv === 'production' && secret === devFallback) {
    throw new Error(`${name} must be replaced in production`);
  }
  return secret;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  const raw = parsed.data;
  return {
    NODE_ENV: raw.NODE_ENV,
    HOST: raw.HOST,
    PORT: raw.PORT,
    PUBLIC_BASE_URL: raw.PUBLIC_BASE_URL,
    LOG_LEVEL: raw.LOG_LEVEL,
    DATABASE_PATH: raw.DATABASE_PATH,
    JWT_ACCESS_SECRET: requireSecret('JWT_ACCESS_SECRET', raw.JWT_ACCESS_SECRET, DEV_ACCESS_SECRET, raw.NODE_ENV),
    JWT_ACCESS_TTL_SEC: raw.JWT_ACCESS_TTL_SEC,
    REFRESH_TTL_SEC: raw.REFRESH_TTL_SEC,
    COOKIE_SECURE: raw.COOKIE_SECURE ? raw.COOKIE_SECURE === 'true' : raw.NODE_ENV === 'production',
    AUTH_PUBLIC_REGISTER: raw.AUTH_PUBLIC_REGISTER === 'true',
    ARGON2_MEMORY_COST: raw.ARGON2_MEMORY_COST,
    ARGON2_TIME_COST: raw.ARGON2_TIME_COST,
    ARGON2_PARALLELISM: raw.ARGON2_PARALLELISM,
    CORS_ORIGINS: csv(raw.CORS_ORIGINS),
    RATE_LIMIT_MAX: raw.RATE_LIMIT_MAX,
    RATE_LIMIT_TIME_WINDOW_MS: raw.RATE_LIMIT_TIME_WINDOW_MS,
    LOGIN_RATE_LIMIT_MAX: raw.LOGIN_RATE_LIMIT_MAX,
    LOGIN_RATE_LIMIT_WINDOW_MS: raw.LOGIN_RATE_LIMIT_WINDOW_MS,
    TURN_AUTH_SECRET: requireSecret('TURN_AUTH_SECRET', raw.TURN_AUTH_SECRET, DEV_TURN_SECRET, raw.NODE_ENV),
    TURN_URLS: csv(raw.TURN_URLS),
    TURNS_URLS: csv(raw.TURNS_URLS),
    STUN_URLS: csv(raw.STUN_URLS),
    TURN_CREDENTIAL_TTL_SEC: raw.TURN_CREDENTIAL_TTL_SEC,
    DEFAULT_ROOM_SLUG: raw.DEFAULT_ROOM_SLUG,
    DEFAULT_ROOM_NAME: raw.DEFAULT_ROOM_NAME,
    MAX_VIEWERS: raw.MAX_VIEWERS,
    WS_AUTH_TIMEOUT_MS: raw.WS_AUTH_TIMEOUT_MS,
    WS_IDLE_TIMEOUT_MS: raw.WS_IDLE_TIMEOUT_MS,
  };
}
