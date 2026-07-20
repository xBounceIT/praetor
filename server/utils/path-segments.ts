import { requireNonEmptyString } from './validation.ts';

const PERSISTED_PATH_SEGMENT_MAX_LENGTH = 100;
const DOT_PATH_SEGMENT_ESCAPE_PREFIX = '~'.repeat(PERSISTED_PATH_SEGMENT_MAX_LENGTH + 1);

/**
 * Bound route parameters while allowing a 100-character persisted Unicode identifier to be
 * percent-encoded at its longest practical representation.
 */
export const PATH_PARAMETER_MAX_LENGTH = 2048;

/**
 * Decode the reversible transport escape produced by `services/api/path.ts` after Fastify has
 * percent-decoded a route parameter. The sentinel cannot collide with persisted identifiers
 * because it is longer than their varchar(100) maximum; all legacy unescaped segments pass through.
 */
export const decodePathSegment = (value: string): string => {
  if (value === `${DOT_PATH_SEGMENT_ESCAPE_PREFIX}.`) return '.';
  if (value === `${DOT_PATH_SEGMENT_ESCAPE_PREFIX}..`) return '..';
  return value;
};

/** Validate a Fastify route parameter after reversing the shared client transport escape. */
export const requirePathSegment = (value: unknown, fieldName: string) =>
  requireNonEmptyString(typeof value === 'string' ? decodePathSegment(value) : value, fieldName);
