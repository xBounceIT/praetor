import { useRef } from 'react';

/**
 * Returns a stable getter that always reads the latest value, without forcing
 * downstream consumers (e.g. memoized handler factories) to re-run when the
 * value changes. The ref is synced during render so reads after commit observe
 * the value rendered in the same commit. The returned getter has stable
 * identity across renders, so it is safe to put in a `useMemo`/`useCallback`
 * dependency array.
 */
export const useLatestRef = <T>(value: T): (() => T) => {
  const valueRef = useRef(value);
  valueRef.current = value;
  const getterRef = useRef<() => T>(() => valueRef.current);
  return getterRef.current;
};
