export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 24 * 60;
export const SESSION_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

type SessionTokenPayload = {
  sessionStart?: unknown;
};

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

const decodeTokenPayload = (token: string | null | undefined): SessionTokenPayload | null => {
  const payload = token?.split('.')[1];
  if (!payload) return null;

  try {
    const padded = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as SessionTokenPayload;
  } catch {
    return null;
  }
};

export const getSessionMaxExpiresAtMs = (token: string | null | undefined): number | null => {
  const sessionStart = Number(decodeTokenPayload(token)?.sessionStart);
  if (!Number.isFinite(sessionStart) || sessionStart <= 0) return null;
  return sessionStart + SESSION_MAX_DURATION_MS;
};

export const getSessionTimeoutThresholds = (minutes: unknown, token?: string | null) => {
  const timeoutMs = normalizeSessionIdleTimeoutMinutes(minutes) * 60 * 1000;
  const absoluteSessionExpiresAtMs = getSessionMaxExpiresAtMs(token);
  const effectiveTimeoutMs =
    absoluteSessionExpiresAtMs === null
      ? timeoutMs
      : Math.min(timeoutMs, Math.max(0, absoluteSessionExpiresAtMs - Date.now()));
  const tenMinutesMs = 10 * 60 * 1000;
  const warningLeadMs =
    effectiveTimeoutMs >= 15 * 60 * 1000
      ? tenMinutesMs
      : Math.max(60_000, Math.floor(effectiveTimeoutMs / 3));
  return {
    warnAfterMs: Math.max(0, effectiveTimeoutMs - warningLeadMs),
    logoutAfterMs: effectiveTimeoutMs,
    absoluteSessionExpiresAtMs,
  };
};
