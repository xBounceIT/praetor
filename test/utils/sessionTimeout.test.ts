import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  getSessionMaxExpiresAtMs,
  getSessionTimeoutThresholds,
  SESSION_MAX_DURATION_MS,
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

  test('caps browser timers to the remaining absolute session duration from the JWT', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    setSystemTime(now);
    const sessionStart = now.getTime() - 7 * 60 * 60 * 1000;
    const token = tokenWithPayload({ sessionStart });

    const thresholds = getSessionTimeoutThresholds(1440, token);

    expect(thresholds.absoluteSessionExpiresAtMs).toBe(sessionStart + SESSION_MAX_DURATION_MS);
    expect(thresholds.logoutAfterMs).toBe(60 * 60 * 1000);
    expect(thresholds.warnAfterMs).toBe(50 * 60 * 1000);
  });

  test('falls back to the configured idle timeout when the JWT payload is unavailable', () => {
    setSystemTime(new Date('2026-07-09T12:00:00.000Z'));

    expect(getSessionMaxExpiresAtMs('not-a-jwt')).toBeNull();
    expect(getSessionTimeoutThresholds(45, 'not-a-jwt')).toEqual({
      warnAfterMs: 35 * 60 * 1000,
      logoutAfterMs: 45 * 60 * 1000,
      absoluteSessionExpiresAtMs: null,
    });
  });
});
