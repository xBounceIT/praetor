import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  getSessionMaxExpiresAtMs,
  getSessionTimeoutThresholds,
  getTokenExpiresAtMs,
} from '../../utils/sessionTimeout';

const tokenWithPayload = (payload: Record<string, unknown>) => {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${encodedPayload}.signature`;
};

describe('session timeout thresholds', () => {
  afterEach(() => {
    setSystemTime();
  });

  test('uses the JWT exp when settings are still at their default value', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    setSystemTime(now);
    const expiresAtMs = now.getTime() + 5 * 60 * 1000;
    const token = tokenWithPayload({ exp: expiresAtMs / 1000 });

    const thresholds = getSessionTimeoutThresholds(30, token);

    expect(getTokenExpiresAtMs(token)).toBe(expiresAtMs);
    expect(thresholds.absoluteSessionExpiresAtMs).toBe(expiresAtMs);
    expect(thresholds.logoutAfterMs).toBe(5 * 60 * 1000);
    expect(thresholds.warnAfterMs).toBe(200_000);
  });

  test('caps browser timers to the server-provided absolute session expiry', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    setSystemTime(now);
    const sessionMaxExpiresAt = now.getTime() + 60 * 60 * 1000;
    const token = tokenWithPayload({
      exp: now.getTime() / 1000 + 12 * 60 * 60,
      sessionMaxExpiresAt,
    });

    const thresholds = getSessionTimeoutThresholds(1440, token);

    expect(getSessionMaxExpiresAtMs(token)).toBe(sessionMaxExpiresAt);
    expect(thresholds.absoluteSessionExpiresAtMs).toBe(sessionMaxExpiresAt);
    expect(thresholds.logoutAfterMs).toBe(60 * 60 * 1000);
    expect(thresholds.warnAfterMs).toBe(50 * 60 * 1000);
  });

  test('does not hard-code the absolute session cap to eight hours', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    setSystemTime(now);
    const sessionMaxExpiresAt = now.getTime() + 12 * 60 * 60 * 1000;
    const token = tokenWithPayload({
      exp: sessionMaxExpiresAt / 1000,
      sessionMaxExpiresAt,
    });

    const thresholds = getSessionTimeoutThresholds(1440, token);

    expect(thresholds.logoutAfterMs).toBe(12 * 60 * 60 * 1000);
    expect(thresholds.warnAfterMs).toBe(11 * 60 * 60 * 1000 + 50 * 60 * 1000);
  });

  test('falls back to the configured idle timeout when the JWT payload is unavailable', () => {
    setSystemTime(new Date('2026-07-09T12:00:00.000Z'));

    expect(getSessionMaxExpiresAtMs('not-a-jwt')).toBeNull();
    expect(getTokenExpiresAtMs('not-a-jwt')).toBeNull();
    expect(getSessionTimeoutThresholds(45, 'not-a-jwt')).toEqual({
      warnAfterMs: 35 * 60 * 1000,
      logoutAfterMs: 45 * 60 * 1000,
      absoluteSessionExpiresAtMs: null,
    });
  });
});
