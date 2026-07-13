import { describe, expect, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useLatestRef } from '../../hooks/useLatestRef';

describe('useLatestRef', () => {
  test('keeps its identity and exposes the latest committed value', () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState('first');
      return { latest: useLatestRef(value), setValue };
    });
    const initialRef = result.current.latest;

    act(() => result.current.setValue('second'));

    expect(result.current.latest).toBe(initialRef);
    expect(result.current.latest.current).toBe('second');
  });
});
