/**
 * Shared validation helpers for API routes
 * Returns { ok, value, message } objects for type-safe validation
 */

import type { FastifyReply } from 'fastify';
import { DURATION_UNITS, type DurationUnit } from './duration-unit.ts';

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
 * Validate a required non-empty string but preserve the original value.
 * Use for external credentials where leading/trailing whitespace can be meaningful.
 */
export function requireNonEmptyStringRaw(
  value: unknown,
  fieldName: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, message: `${fieldName} is required` };
  }
  return { ok: true, value };
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
 * Validate a batch of optional string fields against `optionalNonEmptyString`. Only fields
 * present on `body` (per `Object.hasOwn`) are validated; absent fields are omitted from `values`
 * so callers can still distinguish "not provided" from "explicitly null/empty".
 */
export function parseOptionalStringFields<F extends string>(
  body: Record<string, unknown>,
  fields: readonly F[],
):
  | { ok: true; values: Partial<Record<F, string | null>> }
  | { ok: false; field: F; message: string } {
  const values: Partial<Record<F, string | null>> = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) continue;
    const result = optionalNonEmptyString(body[field], field);
    if (!result.ok) return { ok: false, field, message: result.message };
    values[field] = result.value;
  }
  return { ok: true, values };
}

/**
 * Parse a number (accept number or numeric string)
 */
export function parseNumber(
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
    const parsed = parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
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
 * Duration in whole months (issue #757): an optional positive integer. Absent/empty → null so
 * the caller can default to 1 (a one-off line). Fractional values are rejected because the
 * `duration_months` columns are integers. Shared by the quote/offer/order/invoice line-item
 * validators so the rule stays identical across the document chain.
 */
export function optionalDurationMonths(
  value: unknown,
  fieldName: string = 'durationMonths',
): { ok: true; value: number | null } | { ok: false; message: string } {
  const result = optionalLocalizedPositiveNumber(value, fieldName);
  if (!result.ok) return result;
  if (result.value !== null && !Number.isInteger(result.value)) {
    return { ok: false, message: `${fieldName} must be a whole number of months` };
  }
  return result;
}

// Display unit for a line-item duration (issue #757). Absent/empty → null so the caller can
// default to 'months'. The unit allow-list lives in `duration-unit.ts` (shared with the repos).
export function optionalDurationUnit(
  value: unknown,
  fieldName: string = 'durationUnit',
): { ok: true; value: DurationUnit | null } | { ok: false; message: string } {
  return optionalEnum(value, DURATION_UNITS, fieldName);
}

const TRUE_STRINGS = new Set(['true', '1', 'yes']);
const FALSE_STRINGS = new Set(['false', '0', 'no']);
const BOOLEAN_VALUES_DESCRIPTION = 'true, false, 1, 0, yes, no';

/**
 * Lenient boolean coercion for legacy callers. Use parseBooleanStrict or parseBooleanField
 * when an invalid value should be rejected instead of treated as false.
 */
export function parseBoolean(value: unknown): boolean {
  const result = parseBooleanStrict(value);
  return result.ok ? result.value : false;
}

/**
 * Parse a boolean strictly. Accepts native booleans and a fixed allow-list of strings
 * ('true'/'false'/'1'/'0'/'yes'/'no', case-insensitive, trimmed). Anything else is invalid.
 */
export function parseBooleanStrict(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: boolean } | { ok: false; message: string } {
  if (typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUE_STRINGS.has(normalized)) return { ok: true, value: true };
    if (FALSE_STRINGS.has(normalized)) return { ok: true, value: false };
  }
  return {
    ok: false,
    message: `${fieldName} must be a boolean or one of: ${BOOLEAN_VALUES_DESCRIPTION}`,
  };
}

/**
 * Parse an optional PATCH-style boolean field. A missing property means "not provided";
 * if the property is present, even as null or undefined, it must be a valid boolean value.
 */
export function parseBooleanField(
  source: object,
  fieldName: string,
): { ok: true; value: boolean | undefined } | { ok: false; message: string } {
  if (!Object.hasOwn(source, fieldName)) {
    return { ok: true, value: undefined };
  }
  return parseBooleanStrict((source as Record<string, unknown>)[fieldName], fieldName);
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

const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a date string in YYYY-MM-DD format.
 */
export function parseDateString(
  value: unknown,
  fieldName: string = 'value',
): { ok: true; value: string } | { ok: false; message: string } {
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} must be a date string` };
  }
  if (!DATE_STRING_PATTERN.test(result.value)) {
    return { ok: false, message: `${fieldName} must be in YYYY-MM-DD format` };
  }
  const date = new Date(result.value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, message: `${fieldName} must be a valid date` };
  }
  // JS silently rolls 2023-02-29 → Mar 1; the round-trip catches the normalization mismatch.
  if (date.toISOString().slice(0, 10) !== result.value) {
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
export function validateEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string = 'value',
): { ok: true; value: T } | { ok: false; message: string } {
  if (typeof value !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: false, message: `${fieldName} cannot be empty` };
  }
  if (!allowedValues.includes(trimmed as T)) {
    return { ok: false, message: `${fieldName} must be one of: ${allowedValues.join(', ')}` };
  }
  return { ok: true, value: trimmed as T };
}

/**
 * Validate optional enum
 */
export function optionalEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
): { ok: true; value: T | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  return validateEnum(value, allowedValues, fieldName);
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
export function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

/**
 * Send a 403 Forbidden response with error message
 */
export function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ error: message });
}

/**
 * Validate email format. Stricter than a simple `x@y.z` regex:
 * - rejects whitespace, leading/trailing whitespace
 * - rejects leading/consecutive/trailing dots in either side
 * - rejects domain labels with leading/trailing hyphens
 * - requires the top-level domain label to be ≥ 2 alpha chars
 * - restricts characters to the printable ASCII subset RFC 5321 allows in practice
 */
const EMAIL_LOCAL_CHARS = /^[A-Za-z0-9._+-]+$/;
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const EMAIL_TLD = /^[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  if (typeof value !== 'string' || !value) return false;
  if (value !== value.trim()) return false;
  if (/\s/.test(value)) return false;

  const atIndex = value.indexOf('@');
  if (atIndex <= 0 || atIndex !== value.lastIndexOf('@')) return false;

  const localPart = value.slice(0, atIndex);
  const domainPart = value.slice(atIndex + 1);
  if (!localPart || !domainPart) return false;
  if (localPart.length > 64 || domainPart.length > 253) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (localPart.includes('..') || domainPart.includes('..')) return false;
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) return false;
  if (!EMAIL_LOCAL_CHARS.test(localPart)) return false;
  if (!domainPart.includes('.')) return false;

  const domainLabels = domainPart.split('.');
  if (domainLabels.length < 2) return false;
  if (!domainLabels.every((label) => EMAIL_DOMAIN_LABEL.test(label))) return false;

  const tld = domainLabels[domainLabels.length - 1];
  if (!EMAIL_TLD.test(tld)) return false;

  return true;
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
 * Validate client identifier (alphanumeric, -, _ only)
 */
export function validateClientIdentifier(
  value: unknown,
  fieldName: string = 'id',
): { ok: true; value: string } | { ok: false; message: string } {
  const result = isNonEmptyString(value);
  if (!result.ok) {
    return { ok: false, message: `${fieldName} must be a non-empty string` };
  }

  const regex = /^[a-zA-Z0-9_-]+$/;
  if (!regex.test(result.value)) {
    return {
      ok: false,
      message: `${fieldName} can only contain letters, numbers, dashes (-), and underscores (_)`,
    };
  }

  return result;
}

/**
 * Check if a date string (YYYY-MM-DD format) falls on a weekend
 * @param dateString - Date in YYYY-MM-DD format
 * @returns true if Saturday (6) or Sunday (0)
 */
export function isWeekendDate(dateString: string): boolean {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}
