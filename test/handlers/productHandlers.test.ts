import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  productsCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'p-new', ...(data as object) }),
  ),
  productsUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  productsDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  productsList: mock((): Promise<unknown[]> => Promise.resolve([])),
  productsCreateInternalCategory: mock((..._args: unknown[]) => Promise.resolve()),
  productsUpdateInternalCategory: mock((..._args: unknown[]) => Promise.resolve()),
  productsDeleteInternalCategory: mock((..._args: unknown[]) => Promise.resolve()),
  productsCreateInternalSubcategory: mock((..._args: unknown[]) => Promise.resolve()),
  productsRenameInternalSubcategory: mock((..._args: unknown[]) => Promise.resolve()),
  productsDeleteInternalSubcategory: mock((..._args: unknown[]) => Promise.resolve()),
  productsCreateProductType: mock((..._args: unknown[]) => Promise.resolve()),
  productsUpdateProductType: mock((..._args: unknown[]) => Promise.resolve()),
  productsDeleteProductType: mock((..._args: unknown[]) => Promise.resolve()),
};

mock.module('../../services/api', () => ({
  default: {
    products: {
      create: (data: unknown) => apiMocks.productsCreate(data),
      update: (id: string, updates: unknown) => apiMocks.productsUpdate(id, updates),
      delete: (id: string) => apiMocks.productsDelete(id),
      list: () => apiMocks.productsList(),
      createInternalCategory: (...args: unknown[]) =>
        apiMocks.productsCreateInternalCategory(...args),
      updateInternalCategory: (...args: unknown[]) =>
        apiMocks.productsUpdateInternalCategory(...args),
      deleteInternalCategory: (...args: unknown[]) =>
        apiMocks.productsDeleteInternalCategory(...args),
      createInternalSubcategory: (...args: unknown[]) =>
        apiMocks.productsCreateInternalSubcategory(...args),
      renameInternalSubcategory: (...args: unknown[]) =>
        apiMocks.productsRenameInternalSubcategory(...args),
      deleteInternalSubcategory: (...args: unknown[]) =>
        apiMocks.productsDeleteInternalSubcategory(...args),
      createProductType: (...args: unknown[]) => apiMocks.productsCreateProductType(...args),
      updateProductType: (...args: unknown[]) => apiMocks.productsUpdateProductType(...args),
      deleteProductType: (...args: unknown[]) => apiMocks.productsDeleteProductType(...args),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeProductHandlers } = await import('../../hooks/handlers/productHandlers');

type ProductLike = { id: string; name?: string };

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

describe('makeProductHandlers', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockClear());
  });

  afterEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockReset());
  });

  test('add appends product', async () => {
    apiMocks.productsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'p-new', ...(data as object) }),
    );
    const products = makeStubSetter<ProductLike>([{ id: 'p1' }]);
    const handlers = makeProductHandlers({ setProducts: products.setter });

    await handlers.add({ name: 'Widget' });
    expect(products.get()).toEqual([{ id: 'p1' }, { id: 'p-new', name: 'Widget' }]);
  });

  test('update replaces matching product', async () => {
    apiMocks.productsUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const products = makeStubSetter<ProductLike>([
      { id: 'p1', name: 'Old' },
      { id: 'p2', name: 'B' },
    ]);
    const handlers = makeProductHandlers({ setProducts: products.setter });

    await handlers.update('p1', { name: 'New' });
    expect(products.get()[0]).toEqual({ id: 'p1', name: 'New' });
    expect(products.get()[1]).toEqual({ id: 'p2', name: 'B' });
  });

  test('delete filters product', async () => {
    apiMocks.productsDelete.mockImplementation(() => Promise.resolve());
    const products = makeStubSetter<ProductLike>([{ id: 'p1' }, { id: 'p2' }]);
    const handlers = makeProductHandlers({ setProducts: products.setter });

    await handlers.delete('p1');
    expect(products.get()).toEqual([{ id: 'p2' }]);
  });

  test('updateInternalCategory refetches products list', async () => {
    apiMocks.productsUpdateInternalCategory.mockImplementation(() => Promise.resolve());
    apiMocks.productsList.mockImplementation(() =>
      Promise.resolve([{ id: 'p-fresh', name: 'fresh' }]),
    );
    const products = makeStubSetter<ProductLike>([{ id: 'p-stale' }]);
    const handlers = makeProductHandlers({ setProducts: products.setter });

    await handlers.updateInternalCategory('cat-1', { name: 'Renamed' });
    expect(apiMocks.productsUpdateInternalCategory).toHaveBeenCalledWith('cat-1', {
      name: 'Renamed',
    });
    expect(apiMocks.productsList).toHaveBeenCalled();
    expect(products.get()).toEqual([{ id: 'p-fresh', name: 'fresh' }]);
  });

  test('renameInternalSubcategory refetches products list', async () => {
    apiMocks.productsRenameInternalSubcategory.mockImplementation(() => Promise.resolve());
    apiMocks.productsList.mockImplementation(() => Promise.resolve([{ id: 'p-x' }]));
    const products = makeStubSetter<ProductLike>([{ id: 'p-old' }]);
    const handlers = makeProductHandlers({ setProducts: products.setter });

    await handlers.renameInternalSubcategory('old', 'new', 'service', 'cat');
    expect(apiMocks.productsRenameInternalSubcategory).toHaveBeenCalledWith(
      'old',
      'new',
      'service',
      'cat',
    );
    expect(products.get()).toEqual([{ id: 'p-x' }]);
  });

  test('createInternalSubcategory does not refetch on success', async () => {
    apiMocks.productsCreateInternalSubcategory.mockImplementation(() => Promise.resolve());
    const products = makeStubSetter<ProductLike>([{ id: 'p1' }]);
    const handlers = makeProductHandlers({ setProducts: products.setter });

    await handlers.createInternalSubcategory({ name: 'Sub', type: 'service', category: 'cat' });
    expect(apiMocks.productsCreateInternalSubcategory).toHaveBeenCalled();
    expect(apiMocks.productsList).not.toHaveBeenCalled();
    expect(products.get()).toEqual([{ id: 'p1' }]);
  });

  test('deleteInternalCategory rethrows api error', async () => {
    apiMocks.productsDeleteInternalCategory.mockImplementation(() =>
      Promise.reject(new Error('cannot delete')),
    );
    const handlers = makeProductHandlers({
      setProducts: makeStubSetter<ProductLike>([]).setter,
    });
    await expect(handlers.deleteInternalCategory('cat-1')).rejects.toThrow('cannot delete');
  });
});
