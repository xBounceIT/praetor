export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 24 * 60;

export const normalizeSessionIdleTimeoutMinutes = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_SESSION_IDLE_TIMEOUT_MINUTES ||
    parsed > MAX_SESSION_IDLE_TIMEOUT_MINUTES
  ) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES;
  }
  return parsed;
};

export const sessionIdleTimeoutMinutesToMs = (minutes: number): number =>
  normalizeSessionIdleTimeoutMinutes(minutes) * 60 * 1000;
