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
    expect(result.current.loadingModules.size).toBe(0);
    expect(result.current.isModuleLoading('crm')).toBe(false);
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

  test('loadDatasets tracks module loading until requests settle', async () => {
    const { result } = renderHook(() => useModuleLoader());
    const apply = mock((_data: unknown) => {});
    let resolveLoad!: (value: string) => void;
    const pendingLoad = new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });

    let failuresPromise!: Promise<string[]>;
    act(() => {
      failuresPromise = result.current.loadDatasets('crm', [
        {
          dataset: 'clients',
          enabled: true,
          load: () => pendingLoad,
          apply,
        },
      ]);
    });

    expect(result.current.loadingModules.has('crm')).toBe(true);
    expect(result.current.isModuleLoading('crm')).toBe(true);

    await act(async () => {
      resolveLoad('clients-data');
      expect(await failuresPromise).toEqual([]);
    });

    expect(apply).toHaveBeenCalledWith('clients-data');
    expect(result.current.loadingModules.has('crm')).toBe(false);
    expect(result.current.isModuleLoading('crm')).toBe(false);
  });

  test('loadDatasets skips stale applies and failure reporting when guard expires', async () => {
    const { result } = renderHook(() => useModuleLoader());
    const applyOk = mock((_data: unknown) => {});
    const applyBroken = mock((_data: unknown) => {});
    let isCurrent = true;
    let resolveOk!: (value: string) => void;
    let rejectBroken!: (reason: Error) => void;
    const pendingOk = new Promise<string>((resolve) => {
      resolveOk = resolve;
    });
    const pendingBroken = new Promise<string>((_resolve, reject) => {
      rejectBroken = reject;
    });

    let failuresPromise!: Promise<string[]>;
    act(() => {
      failuresPromise = result.current.loadDatasets(
        'crm',
        [
          {
            dataset: 'clients',
            enabled: true,
            load: () => pendingOk,
            apply: applyOk,
          },
          {
            dataset: 'suppliers',
            enabled: true,
            load: () => pendingBroken,
            apply: applyBroken,
          },
        ],
        { shouldApply: () => isCurrent },
      );
    });

    expect(result.current.loadingModules.has('crm')).toBe(true);

    consoleErrorMock.mockClear();
    isCurrent = false;
    await act(async () => {
      resolveOk('clients-data');
      rejectBroken(new Error('stale network failure'));
      expect(await failuresPromise).toEqual([]);
    });

    expect(applyOk).not.toHaveBeenCalled();
    expect(applyBroken).not.toHaveBeenCalled();
    expect(consoleErrorMock).not.toHaveBeenCalled();
    expect(result.current.loadingModules.has('crm')).toBe(false);
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

  test('invalidateModules removes named modules from loaded set and their errors', () => {
    const { result } = renderHook(() => useModuleLoader());

    act(() => {
      result.current.markModuleLoaded('crm');
      result.current.markModuleLoaded('sales');
      result.current.markModuleLoaded('projects');
      result.current.recordFailures('crm', ['clients']);
      result.current.recordFailures('sales', ['quotes']);
    });
    expect(result.current.loadedModules.size).toBe(3);

    act(() => {
      result.current.invalidateModules(['crm', 'sales']);
    });

    expect(result.current.loadedModules.has('crm')).toBe(false);
    expect(result.current.loadedModules.has('sales')).toBe(false);
    expect(result.current.loadedModules.has('projects')).toBe(true);
    expect(result.current.moduleLoadErrors.crm).toBeUndefined();
    expect(result.current.moduleLoadErrors.sales).toBeUndefined();
  });

  test('invalidateModules is a no-op when given an empty list', () => {
    const { result } = renderHook(() => useModuleLoader());
    act(() => {
      result.current.markModuleLoaded('crm');
    });
    const before = result.current.loadedModules;
    act(() => {
      result.current.invalidateModules([]);
    });
    // Same identity — proves we didn't allocate a new Set.
    expect(result.current.loadedModules).toBe(before);
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
    expect(result.current.loadingModules.size).toBe(0);
  });
});
