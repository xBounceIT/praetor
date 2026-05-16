import { ApiError } from '../services/api';

export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Retry on flaky infrastructure (network, 0, 5xx). 4xx/auth are definite
// failures — retrying just wastes the user's time on an answer the server
// already gave.
export const isTransientError = (err: unknown): boolean => {
  if (err instanceof ApiError) {
    return err.isNetworkError || err.status === 0 || err.status >= 500;
  }
  return true;
};

export type RetryOptions = {
  delaysMs?: readonly number[];
  isCancelled?: () => boolean;
};

// Returns the function's result, or `null` if the caller cancelled mid-flight.
// Throws on persistent failure (non-transient error or all retries exhausted)
// so callers can attach context with try/catch.
export const retryTransient = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T | null> => {
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const isCancelled = options.isCancelled ?? (() => false);
  let attempt = 0;
  while (true) {
    if (isCancelled()) return null;
    try {
      return await fn();
    } catch (err) {
      if (isCancelled()) return null;
      if (!isTransientError(err) || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
      attempt += 1;
    }
  }
};
