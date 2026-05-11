import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => buildResponse({ status: 200 }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { suppliersApi } = await import('../../services/api/suppliers');

beforeEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('suppliersApi normalization', () => {
  test('list() normalizes each supplier (nulls → undefined, isDisabled → boolean)', async () => {
    fetchMock.mockImplementationOnce(async () =>
      buildResponse({
        status: 200,
        json: () => [
          {
            id: 's-1',
            name: 'SupplierA',
            isDisabled: null,
            supplierCode: null,
            email: null,
            phone: null,
          },
          { id: 's-2', name: 'SupplierB', isDisabled: true, email: 'b@x.com' },
        ],
      }),
    );

    const suppliers = await suppliersApi.list();
    expect(suppliers).toHaveLength(2);
    expect(suppliers[0]).toMatchObject({
      id: 's-1',
      name: 'SupplierA',
      isDisabled: false,
      supplierCode: undefined,
      email: undefined,
      phone: undefined,
    });
    expect(suppliers[1]).toMatchObject({
      id: 's-2',
      isDisabled: true,
      email: 'b@x.com',
    });
  });

  test('create() returns a normalized supplier', async () => {
    fetchMock.mockImplementationOnce(async () =>
      buildResponse({
        status: 200,
        json: () => ({ id: 's-3', name: 'New', isDisabled: 0, email: null }),
      }),
    );

    const created = await suppliersApi.create({ name: 'New' });
    expect(created.isDisabled).toBe(false);
    expect(created.email).toBeUndefined();
  });

  test('update() returns a normalized supplier', async () => {
    fetchMock.mockImplementationOnce(async () =>
      buildResponse({
        status: 200,
        json: () => ({ id: 's-1', name: 'Updated', isDisabled: 1, contactName: null }),
      }),
    );

    const updated = await suppliersApi.update('s-1', { name: 'Updated' });
    expect(updated.isDisabled).toBe(true);
    expect(updated.contactName).toBeUndefined();
  });
});
