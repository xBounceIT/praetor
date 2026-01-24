/**
 * Shared validation helpers for API routes
 * Returns { ok, value, message } objects for type-safe validation
 */

/**
 * Check if value is a non-empty string after trimming
 */
export function isNonEmptyString(
  value: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { ok: true, value: value.trim() };
  }
  return { ok: false, message: 'Must be a non-empty string' };
}

/**
 * Validate required non-empty string
 */
export function requireNonEmptyString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} is required` };
  }
  return result;
}

/**
 * Validate optional non-empty string (if provided, must be valid)
 */
export function optionalNonEmptyString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} must be a non-empty string if provided` };
  }
  return result;
}

/**
 * Parse a number (accept number or numeric string)
 */
export function parseNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof value === 'number' && !isNaN(value)) {
    return { ok: true, value };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { ok: false, message: `${fieldName} cannot be an empty string` };
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      return { ok: true, value: parsed };
    }
  }
  return { ok: false, message: `${fieldName} must be a valid number` };
}

const localizedNumberPattern = /^[0-9]*([.][0-9]*)?$/;

const normalizeLocalizedNumber = (value: string) => value.replace(/,/g, '.');

export function parseLocalizedNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, value };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { ok: false, message: `${fieldName} cannot be an empty string` };
    }
    const normalized = normalizeLocalizedNumber(trimmed);
    if (!localizedNumberPattern.test(normalized) || !/[0-9]/.test(normalized)) {
      return { ok: false, message: `${fieldName} must be a valid number` };
    }
    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      return { ok: false, message: `${fieldName} must be a valid number` };
    }
    return { ok: true, value: parsed };
  }
  return { ok: false, message: `${fieldName} must be a valid number` };
}

export function optionalLocalizedNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parseLocalizedNumber(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Parse optional number (accept number, numeric string, null, or undefined)
 */
export function optionalNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parseNumber(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Parse a non-negative number
 */
export function parseNonNegativeNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number } | { ok: false; message: string } {
  const result = parseNumber(value, fieldName);
  if (!result.ok) {
    return result;
  }
  if (result.value < 0) {
    return { ok: false, message: `${fieldName} must be zero or positive` };
  }
  return result;
}

export function parseLocalizedNonNegativeNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number } | { ok: false; message: string } {
  const result = parseLocalizedNumber(value, fieldName);
  if (!result.ok) {
    return result;
  }
  if (result.value < 0) {
    return { ok: false, message: `${fieldName} must be zero or positive` };
  }
  return result;
}

/**
 * Parse optional non-negative number
 */
export function optionalNonNegativeNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parseNonNegativeNumber(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

export function optionalLocalizedNonNegativeNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parseLocalizedNonNegativeNumber(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Parse a positive number (> 0)
 */
export function parsePositiveNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number } | { ok: false; message: string } {
  const result = parseNumber(value, fieldName);
  if (!result.ok) {
    return result;
  }
  if (result.value <= 0) {
    return { ok: false, message: `${fieldName} must be greater than zero` };
  }
  return result;
}

export function parseLocalizedPositiveNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number } | { ok: false; message: string } {
  const result = parseLocalizedNumber(value, fieldName);
  if (!result.ok) {
    return result;
  }
  if (result.value <= 0) {
    return { ok: false, message: `${fieldName} must be greater than zero` };
  }
  return result;
}

/**
 * Parse optional positive number
 */
export function optionalPositiveNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parsePositiveNumber(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

export function optionalLocalizedPositiveNumber(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parseLocalizedPositiveNumber(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Parse a boolean (accept boolean or string 'true'/'false')
 */
export function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === 'true';
  }
  return value ? true : false;
}

/**
 * Validate optional boolean
 */
export function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return parseBoolean(value);
}

/**
 * Validate a date string in YYYY-MM-DD format
 */
export function parseDateString(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: string } | { ok: false; message: string } {
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} must be a date string` };
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(result.value)) {
    return { ok: false, message: `${fieldName} must be in YYYY-MM-DD format` };
  }
  const date = new Date(result.value);
  if (isNaN(date.getTime())) {
    return { ok: false, message: `${fieldName} must be a valid date` };
  }
  return result;
}

/**
 * Validate optional date string
 */
export function optionalDateString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = parseDateString(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Validate enum values
 */
export function validateEnum(
  value: unknown,
  allowedValues: string[],
  fieldName: string = 'value',
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: false, message: `${fieldName} cannot be empty` };
  }
  if (!allowedValues.includes(trimmed)) {
    return { ok: false, message: `${fieldName} must be one of: ${allowedValues.join(', ')}` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate optional enum
 */
export function optionalEnum(
  value: unknown,
  allowedValues: string[],
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = validateEnum(value, allowedValues, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Ensure value is an array of strings
 */
export function ensureArrayOfStrings(
  value: unknown,
  fieldName: string,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: `${fieldName} must be an array` };
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== 'string' || item.trim() === '') {
      return { ok: false, message: `${fieldName}[${i}] must be a non-empty string` };
    }
  }
  return { ok: true, value: value.map((v: string) => v.trim()) };
}

/**
 * Validate optional array of strings (can be undefined/null)
 */
export function optionalArrayOfStrings(
  value: unknown,
  fieldName: string,
): { ok: true; value: string[] | null } | { ok: false; message: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  const result = ensureArrayOfStrings(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Validate that a string array is non-empty
 */
export function requireNonEmptyArrayOfStrings(
  value: unknown,
  fieldName: string,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: `${fieldName} must be an array` };
  }
  if (value.length === 0) {
    return { ok: false, message: `${fieldName} must contain at least one item` };
  }
  return ensureArrayOfStrings(value, fieldName);
}

/**
 * Validate query string parameter is one of 'true' or 'false'
 */
export function parseQueryBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const str = String(value).trim().toLowerCase();
  if (str === 'true') return true;
  if (str === 'false') return false;
  return null;
}

/**
 * Send a 400 Bad Request response with error message
 */
export function badRequest(reply: any, message: string): any {
  return reply.code(400).send({ error: message });
}

/**
 * Validate email format (basic regex)
 */
export function isValidEmail(value: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

export function validateEmail(
  value: unknown,
  fieldName: string = 'email',
): { ok: true; value: string } | { ok: false; message: string } {
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} must be a non-empty string` };
  }
  if (!isValidEmail(result.value)) {
    return { ok: false, message: `${fieldName} must be a valid email address` };
  }
  return result;
}

export function optionalEmail(
  value: unknown,
  fieldName: string = 'email',
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const result = validateEmail(value, fieldName);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return result;
}

/**
 * Validate hex color string (e.g., #3b82f6)
 */
export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value) || /^#[0-9A-Fa-f]{3}$/.test(value);
}

export function validateHexColor(
  value: unknown,
  fieldName: string = 'color',
): { ok: true; value: string } | { ok: false; message: string } {
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} must be a non-empty string` };
  }
  if (!isHexColor(result.value)) {
    return { ok: false, message: `${fieldName} must be a valid hex color (e.g., #3b82f6)` };
  }
  return result;
}
