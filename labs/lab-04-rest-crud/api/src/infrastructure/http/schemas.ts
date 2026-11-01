import { z } from 'zod';
import type { OperationTypeInput } from '../../domain/operation-type.ts';
import {
  OPERATION_TYPE_DESCRIPTION_LENGTH,
  OPERATION_TYPE_NAME_LENGTH,
} from '../../domain/operation-type.ts';
import {
  normalizeDesignation,
  PART_DESIGNATION_PATTERN,
  PART_MATERIAL_LENGTH,
  PART_NAME_LENGTH,
  type PartInput,
} from '../../domain/part.ts';
import {
  DURATION_MINUTES,
  EQUIPMENT_LENGTH,
  isValidDuration,
  OPERATIONS_COUNT,
  type ProcessCardInput,
} from '../../domain/process-card.ts';
import { normalizeText } from '../../domain/text.ts';
import { RequestValidationError } from './errors.ts';

interface Limits {
  readonly min: number;
  readonly max: number;
}

function text(limits: Limits) {
  return z.string().refine((value) => {
    const { length } = normalizeText(value);
    return length >= limits.min && length <= limits.max;
  }, `Must be ${limits.min}-${limits.max} characters long`);
}

function optionalText(limits: Limits) {
  return z
    .string()
    .refine(
      (value) => normalizeText(value).length <= limits.max,
      `Must be at most ${limits.max} characters long`,
    )
    .nullish();
}

const id = z.string().trim().min(1).max(64);

export const partSchema: z.ZodType<PartInput> = z.strictObject({
  designation: z
    .string()
    .max(64)
    .refine(
      (value) => PART_DESIGNATION_PATTERN.test(normalizeDesignation(value)),
      'Must be 3-40 letters, digits, dots, dashes or slashes, starting and ending with a letter or digit',
    ),
  name: text(PART_NAME_LENGTH),
  material: optionalText(PART_MATERIAL_LENGTH),
});

export const operationTypeSchema: z.ZodType<OperationTypeInput> = z.strictObject({
  name: text(OPERATION_TYPE_NAME_LENGTH),
  description: optionalText(OPERATION_TYPE_DESCRIPTION_LENGTH),
});

export const processCardSchema: z.ZodType<ProcessCardInput> = z.strictObject({
  partId: id,
  operations: z
    .array(
      z.strictObject({
        operationTypeId: id,
        equipment: optionalText(EQUIPMENT_LENGTH),
        durationMinutes: z
          .number()
          .refine(
            isValidDuration,
            `Must be ${DURATION_MINUTES.min}-${DURATION_MINUTES.max} minutes with at most one decimal place`,
          ),
      }),
    )
    .min(OPERATIONS_COUNT.min)
    .max(OPERATIONS_COUNT.max),
});

export const idParamsSchema = z.object({ id });

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : 'body',
        message: issue.message,
      })),
    );
  }
  return result.data;
}
