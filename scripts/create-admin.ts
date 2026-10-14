import 'dotenv/config';
import { ZodError } from 'zod';
import { formatZodError } from '../src/lib/errors.js';
import { main } from '../src/cli/create-admin.js';

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof ZodError) {
    console.error(formatZodError(err));
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
