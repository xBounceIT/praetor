import { describe, expect, test } from 'bun:test';
import {
  GLOBAL_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  STANDARD_ROUTE_RATE_LIMIT,
} from '../../utils/rate-limit.ts';

describe('GLOBAL_RATE_LIMIT', () => {
  test('has the documented max and timeWindow', () => {
    expect(GLOBAL_RATE_LIMIT.max).toBe(1000);
    expect(GLOBAL_RATE_LIMIT.timeWindow).toBe('1 minute');
  });
});

describe('STANDARD_ROUTE_RATE_LIMIT', () => {
  test('has the documented max and timeWindow', () => {
    expect(STANDARD_ROUTE_RATE_LIMIT.max).toBe(120);
    expect(STANDARD_ROUTE_RATE_LIMIT.timeWindow).toBe('1 minute');
  });
});

describe('LOGIN_RATE_LIMIT', () => {
  test('has the documented max and timeWindow', () => {
    expect(LOGIN_RATE_LIMIT.max).toBe(10);
    expect(LOGIN_RATE_LIMIT.timeWindow).toBe('15 minutes');
  });
});

describe('rate-limit invariants', () => {
  test('login is the strictest', () => {
    expect(LOGIN_RATE_LIMIT.max).toBeLessThan(STANDARD_ROUTE_RATE_LIMIT.max);
    expect(STANDARD_ROUTE_RATE_LIMIT.max).toBeLessThan(GLOBAL_RATE_LIMIT.max);
  });

  test('all configs expose a numeric max', () => {
    for (const cfg of [GLOBAL_RATE_LIMIT, STANDARD_ROUTE_RATE_LIMIT, LOGIN_RATE_LIMIT]) {
      expect(typeof cfg.max).toBe('number');
      expect(cfg.max).toBeGreaterThan(0);
    }
  });

  test('all configs expose a non-empty timeWindow string', () => {
    for (const cfg of [GLOBAL_RATE_LIMIT, STANDARD_ROUTE_RATE_LIMIT, LOGIN_RATE_LIMIT]) {
      expect(typeof cfg.timeWindow).toBe('string');
      expect(cfg.timeWindow.length).toBeGreaterThan(0);
    }
  });
});
