import { requireNonEmptyString } from './validation.ts';

/**
 * Decode the reversible transport escape produced by `services/api/path.ts` after Fastify has
 * percent-decoded a route parameter. Ordinary and legacy unescaped segments pass through.
 */
export const decodePathSegment = (value: string): string => {
  if (value === '@.' || value === '@..' || value.startsWith('@@')) return value.slice(1);
  return value;
};

/** Validate a Fastify route parameter after reversing the shared client transport escape. */
export const requirePathSegment = (value: unknown, fieldName: string) =>
  requireNonEmptyString(typeof value === 'string' ? decodePathSegment(value) : value, fieldName);
