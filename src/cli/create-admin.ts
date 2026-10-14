import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { formatZodError } from '../lib/errors.js';
import { displayNameSchema, passwordSchema, roleSchema, usernameSchema } from '../modules/users/schemas.js';
import { createUser } from '../modules/users/service.js';
import { ZodError } from 'zod';

function usage(): string {
  return 'Usage: npm run create-admin -- --username <name> --password <password> [--display-name <name>] [--role admin|member]';
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help')) {
    console.log(usage());
    return;
  }
  if (argv.length === 0) {
    throw new Error(usage());
  }
  const args = parseArgs(argv);
  const username = usernameSchema.parse(args.username);
  const password = passwordSchema.parse(args.password);
  const displayName = displayNameSchema.parse(args['display-name'] ?? username);
  const role = roleSchema.parse(args.role ?? 'admin');
  const config = loadConfig();
  const { db, sqlite } = openDatabase(config);
  try {
    const user = await createUser({ db, sqlite, config }, { username, password, displayName, role });
    console.log(`Created user id=${user.id} username=${user.username} role=${user.role}`);
  } catch (err) {
    if (err instanceof ZodError) throw new Error(formatZodError(err));
    throw err;
  } finally {
    sqlite.close();
  }
}
