import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

const apiMocks = {
  suppliersCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 's-new', ...(data as object) }),
  ),
  suppliersUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  suppliersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
};

mock.module('../../services/api', () => ({
  default: {
    suppliers: {
      create: (data: unknown) => apiMocks.suppliersCreate(data),
      update: (id: string, updates: unknown) => apiMocks.suppliersUpdate(id, updates),
      delete: (id: string) => apiMocks.suppliersDelete(id),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const { makeSupplierHandlers } = await import('../../hooks/handlers/supplierHandlers');

type SupplierLike = { id: string; name?: string };

const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = (updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  };
  return {
    setter: setter as never,
    get: () => value,
  };
};

const silenceConsole = () => {
  const original = console.error;
  console.error = mock(() => {}) as unknown as typeof console.error;
  return () => {
    console.error = original;
  };
};

describe('makeSupplierHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('add appends supplier to list', async () => {
    apiMocks.suppliersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 's-new', ...(data as object) }),
    );
    const suppliers = makeStubSetter<SupplierLike>([{ id: 's1' }]);
    const handlers = makeSupplierHandlers({ setSuppliers: suppliers.setter });

    await handlers.add({ name: 'Acme' } as never);
    expect(apiMocks.suppliersCreate).toHaveBeenCalledWith({ name: 'Acme' });
    expect(suppliers.get()).toEqual([{ id: 's1' }, { id: 's-new', name: 'Acme' }]);
  });

  test('add rethrows api error and keeps suppliers list unchanged', async () => {
    apiMocks.suppliersCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const suppliers = makeStubSetter<SupplierLike>([]);
    const handlers = makeSupplierHandlers({ setSuppliers: suppliers.setter });

    const restore = silenceConsole();
    try {
      await expect(handlers.add({ name: 'Acme' } as never)).rejects.toThrow('boom');
      expect(suppliers.get()).toEqual([]);
    } finally {
      restore();
    }
  });

  test('update replaces matching supplier', async () => {
    apiMocks.suppliersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const suppliers = makeStubSetter<SupplierLike>([
      { id: 's1', name: 'Old' },
      { id: 's2', name: 'B' },
    ]);
    const handlers = makeSupplierHandlers({ setSuppliers: suppliers.setter });

    await handlers.update('s1', { name: 'New' } as never);
    expect(suppliers.get()[0]).toEqual({ id: 's1', name: 'New' });
    expect(suppliers.get()[1]).toEqual({ id: 's2', name: 'B' });
  });

  test('update rethrows api error and keeps supplier unchanged', async () => {
    apiMocks.suppliersUpdate.mockImplementation(() => Promise.reject(new Error('nope')));
    const suppliers = makeStubSetter<SupplierLike>([{ id: 's1', name: 'Old' }]);
    const handlers = makeSupplierHandlers({ setSuppliers: suppliers.setter });

    const restore = silenceConsole();
    try {
      await expect(handlers.update('s1', { name: 'X' } as never)).rejects.toThrow('nope');
      expect(suppliers.get()).toEqual([{ id: 's1', name: 'Old' }]);
    } finally {
      restore();
    }
  });

  test('delete removes matching supplier', async () => {
    apiMocks.suppliersDelete.mockImplementation(() => Promise.resolve());
    const suppliers = makeStubSetter<SupplierLike>([{ id: 's1' }, { id: 's2' }]);
    const handlers = makeSupplierHandlers({ setSuppliers: suppliers.setter });

    await handlers.delete('s1');
    expect(apiMocks.suppliersDelete).toHaveBeenCalledWith('s1');
    expect(suppliers.get()).toEqual([{ id: 's2' }]);
  });

  test('delete rethrows api error and keeps supplier in list', async () => {
    apiMocks.suppliersDelete.mockImplementation(() => Promise.reject(new Error('fail')));
    const suppliers = makeStubSetter<SupplierLike>([{ id: 's1' }]);
    const handlers = makeSupplierHandlers({ setSuppliers: suppliers.setter });

    const restore = silenceConsole();
    try {
      await expect(handlers.delete('s1')).rejects.toThrow('fail');
      expect(suppliers.get()).toEqual([{ id: 's1' }]);
    } finally {
      restore();
    }
  });
});
