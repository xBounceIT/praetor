import { useLayoutEffect, useRef } from 'react';

/**
 * Returns a stable getter that always reads the latest *committed* value,
 * without forcing downstream consumers (e.g. memoized handler factories) to
 * re-run when the value changes. The ref is synced in `useLayoutEffect` so
 * interrupted/discarded transition renders don't leak uncommitted state to
 * handlers (e.g. attributing an entry to a user the UI hasn't switched to
 * yet). The returned getter has stable identity across renders, so it is safe
 * to put in a `useMemo`/`useCallback` dependency array.
 */
export const useLatestRef = <T>(value: T): (() => T) => {
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  const getterRef = useRef<() => T>(() => valueRef.current);
  return getterRef.current;
};
