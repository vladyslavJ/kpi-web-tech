export const PART_DESIGNATION_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}./-]{1,38}[\p{L}\p{N}]$/u;
export const PART_DESIGNATION_HINT =
  '3–40 символів: літери, цифри, крапка, дефіс або скісна риска, наприклад КПІ.301.011';
export const PART_NAME_LENGTH = { min: 2, max: 120 } as const;
export const PART_MATERIAL_MAX_LENGTH = 80;

export const OPERATION_TYPE_NAME_LENGTH = { min: 2, max: 60 } as const;
export const OPERATION_TYPE_DESCRIPTION_MAX_LENGTH = 300;

export const OPERATIONS_MAX = 30;
export const DURATION_MINUTES = { min: 0.1, max: 1440 } as const;
export const DURATION_HINT = 'від 0,1 до 1440 хв, з точністю до 0,1';
export const EQUIPMENT_MAX_LENGTH = 120;

export function isTenthOfMinute(minutes: number): boolean {
  const tenths = minutes * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-9;
}
