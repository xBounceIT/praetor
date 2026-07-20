const PATH_SEGMENT_ESCAPE_PREFIX = '@';

/**
 * Encode an identifier as one opaque URL path segment.
 *
 * WHATWG URL parsing normalizes `.` and `..` even when their dots are percent-encoded. Prefix
 * those two values before normal encoding, and double an existing prefix so the transport remains
 * reversible through the server's paired `decodePathSegment` helper.
 */
export const encodePathSegment = (value: string): string => {
  const escapedValue =
    value === '.' || value === '..' || value.startsWith(PATH_SEGMENT_ESCAPE_PREFIX)
      ? `${PATH_SEGMENT_ESCAPE_PREFIX}${value}`
      : value;
  return encodeURIComponent(escapedValue);
};
