import { describe, expect, mock, test } from 'bun:test';
import { ApiError } from '../../services/api';
import { isTransientError, retryTransient, sleep } from '../../utils/retry';

describe('utils/retry', () => {
  describe('isTransientError', () => {
    test('network errors are transient', () => {
      expect(isTransientError(new ApiError('offline', 0, true))).toBe(true);
    });

    test('5xx are transient', () => {
      expect(isTransientError(new ApiError('boom', 500))).toBe(true);
      expect(isTransientError(new ApiError('boom', 503))).toBe(true);
    });

    test('4xx are NOT transient (retrying just wastes time on a definite no)', () => {
      expect(isTransientError(new ApiError('nope', 400))).toBe(false);
      expect(isTransientError(new ApiError('auth', 401))).toBe(false);
      expect(isTransientError(new ApiError('forbidden', 403))).toBe(false);
      expect(isTransientError(new ApiError('not found', 404))).toBe(false);
    });

    test('non-ApiError errors are treated as transient', () => {
      expect(isTransientError(new Error('???'))).toBe(true);
      expect(isTransientError('weird')).toBe(true);
    });
  });

  describe('retryTransient', () => {
    test('returns immediately on success without sleeping', async () => {
      const fn = mock(() => Promise.resolve('ok'));
      const result = await retryTransient(fn, { delaysMs: [10, 20, 30] });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries transient errors until success', async () => {
      let calls = 0;
      const fn = mock(() => {
        calls += 1;
        if (calls < 3) return Promise.reject(new ApiError('flaky', 503));
        return Promise.resolve('ok');
      });
      const result = await retryTransient(fn, { delaysMs: [0, 0, 0] });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('throws after exhausting all retries on transient errors', async () => {
      const fn = mock(() => Promise.reject(new ApiError('boom', 500)));
      await expect(retryTransient(fn, { delaysMs: [0, 0] })).rejects.toThrow('boom');
      // delays.length + 1 attempts = 3
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('throws immediately on non-transient (4xx) errors — no retries', async () => {
      const fn = mock(() => Promise.reject(new ApiError('nope', 400)));
      await expect(retryTransient(fn, { delaysMs: [0, 0, 0] })).rejects.toThrow('nope');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('returns null when cancelled before the first attempt', async () => {
      const fn = mock(() => Promise.resolve('ok'));
      const result = await retryTransient(fn, { isCancelled: () => true });
      expect(result).toBeNull();
      expect(fn).not.toHaveBeenCalled();
    });

    test('returns null when cancelled mid-retry', async () => {
      let cancelled = false;
      const fn = mock(() => {
        cancelled = true;
        return Promise.reject(new ApiError('flaky', 503));
      });
      const result = await retryTransient(fn, {
        delaysMs: [0, 0, 0],
        isCancelled: () => cancelled,
      });
      expect(result).toBeNull();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('sleep', () => {
    test('resolves after the given delay', async () => {
      const start = performance.now();
      await sleep(10);
      expect(performance.now() - start).toBeGreaterThanOrEqual(8);
    });
  });
});
