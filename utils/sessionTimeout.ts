export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 24 * 60;

type SessionTokenPayload = {
  exp?: unknown;
  sessionMaxExpiresAt?: unknown;
  sessionVersion?: unknown;
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

const normalizeFutureTimestampMs = (value: unknown): number | null => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

const getPayloadTokenExpiresAtMs = (payload: SessionTokenPayload | null): number | null => {
  const expSeconds = normalizeFutureTimestampMs(payload?.exp);
  return expSeconds === null ? null : expSeconds * 1000;
};

const getPayloadSessionMaxExpiresAtMs = (payload: SessionTokenPayload | null): number | null =>
  normalizeFutureTimestampMs(payload?.sessionMaxExpiresAt);

export const getTokenExpiresAtMs = (token: string | null | undefined): number | null =>
  getPayloadTokenExpiresAtMs(decodeTokenPayload(token));

export const getSessionMaxExpiresAtMs = (token: string | null | undefined): number | null =>
  getPayloadSessionMaxExpiresAtMs(decodeTokenPayload(token));

export const getTokenSessionVersion = (token: string | null | undefined): number | null => {
  const sessionVersion = decodeTokenPayload(token)?.sessionVersion;
  return typeof sessionVersion === 'number' && Number.isSafeInteger(sessionVersion)
    ? sessionVersion
    : null;
};

const getEffectiveTokenExpiresAtMs = (token: string | null | undefined): number | null => {
  const payload = decodeTokenPayload(token);
  const expiresAtValues = [
    getPayloadTokenExpiresAtMs(payload),
    getPayloadSessionMaxExpiresAtMs(payload),
  ].filter((value): value is number => value !== null);
  return expiresAtValues.length === 0 ? null : Math.min(...expiresAtValues);
};

export const getSessionTimeoutThresholds = (minutes: unknown, token?: string | null) => {
  const timeoutMs = normalizeSessionIdleTimeoutMinutes(minutes) * 60 * 1000;
  const absoluteSessionExpiresAtMs = getEffectiveTokenExpiresAtMs(token);
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
