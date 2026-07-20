const PERSISTED_PATH_SEGMENT_MAX_LENGTH = 100;
const DOT_PATH_SEGMENT_ESCAPE_PREFIX = '~'.repeat(PERSISTED_PATH_SEGMENT_MAX_LENGTH + 1);

/**
 * Encode an identifier as one opaque URL path segment.
 *
 * WHATWG URL parsing normalizes `.` and `..` even when their dots are percent-encoded. Prefix
 * those two values with a sentinel longer than every persisted identifier that uses this helper,
 * then reverse that transport through the server's paired `decodePathSegment` helper.
 */
export const encodePathSegment = (value: string): string => {
  const escapedValue =
    value === '.' || value === '..' ? `${DOT_PATH_SEGMENT_ESCAPE_PREFIX}${value}` : value;
  return encodeURIComponent(escapedValue);
};
