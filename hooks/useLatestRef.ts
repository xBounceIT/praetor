import { type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * Keeps a stable ref synchronized with the latest committed value.
 *
 * Updating during the layout phase preserves render purity while ensuring event handlers and
 * async continuations observe the new value before the browser can deliver another interaction.
 */
export const useLatestRef = <T>(value: T): RefObject<T> => {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
};
