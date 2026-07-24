import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { HOURS_BATCH_MAX_PROJECT_IDS, tasksApi } = await import('../../services/api/tasks');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => respondWith({}));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const projectIds = (count: number) => Array.from({ length: count }, (_, i) => `p-${i + 1}`);

const idsFromUrl = (url: string): string[] => {
  const match = String(url).match(/projectIds=([^&]*)/);
  if (!match?.[1]) return [];
  return match[1].split(',').map(decodeURIComponent).filter(Boolean);
};

describe('tasksApi.getHoursForProjects', () => {
  test('returns {} without calling the API when projectIds is empty', async () => {
    const result = await tasksApi.getHoursForProjects([]);

    expect(result).toEqual({});
    expect(fetchMock.mock.calls).toHaveLength(0);
  });

  test('issues a single batch request when project count is within the limit', async () => {
    const ids = projectIds(3);
    fetchMock.mockImplementation(async (input) => {
      const requested = idsFromUrl(String(input));
      return respondWith({
        [requested[0]]: { t1: 1 },
        [requested[1]]: { t2: 2 },
        [requested[2]]: { t3: 3 },
      });
    });

    const result = await tasksApi.getHoursForProjects(ids);

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(idsFromUrl(String(fetchMock.mock.calls[0][0]))).toEqual(ids);
    expect(result).toEqual({
      'p-1': { t1: 1 },
      'p-2': { t2: 2 },
      'p-3': { t3: 3 },
    });
  });

  test('chunks requests at the backend limit and merges hour maps', async () => {
    const ids = projectIds(HOURS_BATCH_MAX_PROJECT_IDS + 50);
    fetchMock.mockImplementation(async (input) => {
      const requested = idsFromUrl(String(input));
      expect(requested.length).toBeLessThanOrEqual(HOURS_BATCH_MAX_PROJECT_IDS);
      const body: Record<string, Record<string, number>> = {};
      for (const id of requested) {
        body[id] = { [`task-${id}`]: 1 };
      }
      return respondWith(body);
    });

    const result = await tasksApi.getHoursForProjects(ids);

    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(idsFromUrl(String(fetchMock.mock.calls[0][0]))).toHaveLength(
      HOURS_BATCH_MAX_PROJECT_IDS,
    );
    expect(idsFromUrl(String(fetchMock.mock.calls[1][0]))).toHaveLength(50);
    expect(Object.keys(result)).toHaveLength(ids.length);
    expect(result['p-1']).toEqual({ 'task-p-1': 1 });
    expect(result['p-250']).toEqual({ 'task-p-250': 1 });
  });

  test('returns merged data when some chunks succeed and only warns on partial failure', async () => {
    const ids = projectIds(HOURS_BATCH_MAX_PROJECT_IDS + 1);
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;

    try {
      fetchMock.mockImplementation(async (input) => {
        const requested = idsFromUrl(String(input));
        if (requested.length === 1) {
          return respondWith({ error: 'chunk failed' }, 400);
        }
        const body: Record<string, Record<string, number>> = {};
        for (const id of requested) {
          body[id] = { ok: 4 };
        }
        return respondWith(body);
      });

      const result = await tasksApi.getHoursForProjects(ids);

      expect(Object.keys(result)).toHaveLength(HOURS_BATCH_MAX_PROJECT_IDS);
      expect(result['p-1']).toEqual({ ok: 4 });
      expect(result[`p-${HOURS_BATCH_MAX_PROJECT_IDS + 1}`]).toBeUndefined();
      expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('throws when every chunk fails', async () => {
    const ids = projectIds(HOURS_BATCH_MAX_PROJECT_IDS + 1);
    fetchMock.mockImplementation(async () => respondWith({ error: 'nope' }, 400));

    await expect(tasksApi.getHoursForProjects(ids)).rejects.toThrow();
  });

  test('rethrows when the request is aborted', async () => {
    const ids = projectIds(HOURS_BATCH_MAX_PROJECT_IDS + 1);
    const controller = new AbortController();
    controller.abort();

    fetchMock.mockImplementation(async (_input, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return respondWith({});
    });

    await expect(tasksApi.getHoursForProjects(ids, controller.signal)).rejects.toThrow(/aborted/i);
  });
});
