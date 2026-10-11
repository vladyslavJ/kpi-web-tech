import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLES,
  USERNAME_PATTERN,
} from '../../domain/user.ts';
import { RequestValidationError } from './errors.ts';

export const registerSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .regex(USERNAME_PATTERN, 'Username must be 3-32 letters, digits, dots, dashes or underscores'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .regex(/\S/, 'Password must not consist of spaces only'),
});

export const loginSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const changeRoleSchema = z.strictObject({
  role: z.enum(ROLES),
});

export const userIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues
        .map(
          (issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'body'}: ${issue.message}`,
        )
        .join('; '),
    );
  }
  return result.data;
}
