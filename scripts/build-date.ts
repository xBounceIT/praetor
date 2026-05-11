/**
 * Returns the build date as a YYYYMMDD string.
 *
 * Exposed as a helper so vite.config.ts and tests share one implementation.
 */
export const getBuildDate = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10).replace(/-/g, '');
