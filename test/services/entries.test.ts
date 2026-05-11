import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { UpdateTimeEntryInput } from '../../services/api/entries';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => buildResponse({ status: 200 }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { entriesApi } = await import('../../services/api/entries');

const baseEntry = {
  id: 'e-1',
  userId: 'u-1',
  date: '2026-01-01',
  clientId: 'c-1',
  clientName: 'Acme',
  projectId: 'p-1',
  projectName: 'Project',
  task: 'Task',
  duration: 1,
  hourlyCost: 50,
  createdAt: 0,
};

beforeEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('entriesApi.update', () => {
  test('PUTs to /entries/:id with the DTO body and normalizes the response', async () => {
    fetchMock.mockImplementationOnce(async () =>
      buildResponse({ status: 200, json: () => ({ ...baseEntry, duration: '2.5' }) }),
    );

    const updates: UpdateTimeEntryInput = { duration: 2.5, notes: 'note', location: 'office' };
    const result = await entriesApi.update('e-1', updates);

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain('/entries/e-1');
    expect((call[1] as { method: string }).method).toBe('PUT');
    expect((call[1] as { body: string }).body).toBe(JSON.stringify(updates));

    // Normalizer coerced the string duration back to a number.
    expect(result.duration).toBe(2.5);
  });

  test('UpdateTimeEntryInput type rejects unknown fields at compile time', () => {
    // The TS compiler must reject unknown keys like `clientId` or `task`.
    // ts-expect-error proves the type contract holds; if the contract is
    // accidentally widened, the test file fails to compile.
    // @ts-expect-error - task is silently dropped server-side and excluded from the DTO
    const _bad: UpdateTimeEntryInput = { task: 'new task' };
    // @ts-expect-error - clientId is silently dropped server-side
    const _bad2: UpdateTimeEntryInput = { clientId: 'other' };
    void _bad;
    void _bad2;
    expect(true).toBe(true);
  });
});
