/** Encode an untrusted identifier as one opaque URL path segment. */
export const encodePathSegment = (value: string): string => encodeURIComponent(value);
