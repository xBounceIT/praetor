import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useModuleLoader } from '../../hooks/useModuleLoader';

describe('useModuleLoader', () => {
  let consoleErrorMock: ReturnType<typeof mock>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorMock = mock(() => {});
    console.error = consoleErrorMock as unknown as typeof console.error;
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test('initial state is empty', () => {
    const { result } = renderHook(() => useModuleLoader());
    expect(result.current.loadedModules.size).toBe(0);
    expect(result.current.moduleLoadErrors).toEqual({});
  });

  test('loadDatasets filters by enabled and applies fulfilled results', async () => {
    const { result } = renderHook(() => useModuleLoader());
    const apply1 = mock((_data: unknown) => {});
    const apply2 = mock((_data: unknown) => {});
    const apply3 = mock((_data: unknown) => {});

    let failures: string[] = [];
    await act(async () => {
      failures = await result.current.loadDatasets('crm', [
        {
          dataset: 'a',
          enabled: true,
          load: () => Promise.resolve('A-data'),
          apply: apply1,
        },
        {
          dataset: 'b',
          enabled: false,
          load: () => Promise.resolve('B-data'),
          apply: apply2,
        },
        {
          dataset: 'c',
          enabled: true,
          load: () => Promise.resolve('C-data'),
          apply: apply3,
        },
      ]);
    });

    expect(failures).toEqual([]);
    expect(apply1).toHaveBeenCalledWith('A-data');
    expect(apply2).not.toHaveBeenCalled();
    expect(apply3).toHaveBeenCalledWith('C-data');
  });

  test('loadDatasets returns failed dataset names and logs them', async () => {
    const { result } = renderHook(() => useModuleLoader());
    const applyOk = mock((_data: unknown) => {});
    const applyFail = mock((_data: unknown) => {});

    let failures: string[] = [];
    await act(async () => {
      failures = await result.current.loadDatasets('crm', [
        {
          dataset: 'ok',
          enabled: true,
          load: () => Promise.resolve('ok-data'),
          apply: applyOk,
        },
        {
          dataset: 'broken',
          enabled: true,
          load: () => Promise.reject(new Error('network down')),
          apply: applyFail,
        },
      ]);
    });

    expect(failures).toEqual(['broken']);
    expect(applyOk).toHaveBeenCalledWith('ok-data');
    expect(applyFail).not.toHaveBeenCalled();
    expect(consoleErrorMock).toHaveBeenCalled();
  });

  test('loadDatasets returns empty when no requests are enabled', async () => {
    const { result } = renderHook(() => useModuleLoader());
    const apply = mock((_data: unknown) => {});

    let failures: string[] = [];
    await act(async () => {
      failures = await result.current.loadDatasets('crm', [
        { dataset: 'a', enabled: false, load: () => Promise.resolve(1), apply },
      ]);
    });

    expect(failures).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });

  test('markModuleLoaded adds module to set', () => {
    const { result } = renderHook(() => useModuleLoader());

    act(() => {
      result.current.markModuleLoaded('crm');
    });
    expect(result.current.loadedModules.has('crm')).toBe(true);

    act(() => {
      result.current.markModuleLoaded('hr');
    });
    expect(result.current.loadedModules.has('hr')).toBe(true);
    expect(result.current.loadedModules.size).toBe(2);
  });

  test('recordFailures sets errors for module', () => {
    const { result } = renderHook(() => useModuleLoader());

    act(() => {
      result.current.recordFailures('crm', ['clients', 'suppliers']);
    });

    expect(result.current.moduleLoadErrors.crm).toEqual(['clients', 'suppliers']);
  });

  test('recordFailures with empty array clears the module entry', () => {
    const { result } = renderHook(() => useModuleLoader());

    act(() => {
      result.current.recordFailures('crm', ['clients']);
    });
    expect(result.current.moduleLoadErrors.crm).toEqual(['clients']);

    act(() => {
      result.current.recordFailures('crm', []);
    });
    expect(result.current.moduleLoadErrors.crm).toBeUndefined();
  });

  test('reset clears loaded modules and errors', () => {
    const { result } = renderHook(() => useModuleLoader());

    act(() => {
      result.current.markModuleLoaded('crm');
      result.current.recordFailures('hr', ['employees']);
    });
    expect(result.current.loadedModules.size).toBe(1);
    expect(result.current.moduleLoadErrors.hr).toEqual(['employees']);

    act(() => {
      result.current.reset();
    });
    expect(result.current.loadedModules.size).toBe(0);
    expect(result.current.moduleLoadErrors).toEqual({});
  });
});
