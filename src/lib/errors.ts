import type { ZodType } from 'zod';
import { ZodError } from 'zod';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const Errors = {
  validation: (message: string) => new AppError('VALIDATION_ERROR', 400, message),
  unauthorized: (message = 'Unauthorized') => new AppError('UNAUTHORIZED', 401, message),
  forbidden: (message = 'Forbidden') => new AppError('FORBIDDEN', 403, message),
  notFound: (message = 'Not found') => new AppError('NOT_FOUND', 404, message),
  conflict: (message: string) => new AppError('CONFLICT', 409, message),
  inviteInvalid: () => new AppError('INVITE_INVALID', 400, 'Invite code is invalid or used up'),
  registerDisabled: () => new AppError('REGISTER_DISABLED', 403, 'Public registration is disabled'),
  internal: (message = 'Internal server error') => new AppError('INTERNAL', 500, message),
};

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Errors.validation(formatZodError(result.error));
  }
  return result.data;
}

export function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    String((err as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT')
  );
}

export function asAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof Error && err.cause instanceof AppError) return err.cause;
  return null;
}
