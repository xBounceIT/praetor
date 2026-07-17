import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input?: unknown, _init?: unknown): Promise<unknown> =>
    buildResponse({ status: 200, json: () => [] }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { reportsApi } = await import('../../services/api/reports');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(buildResponse({ status: 200, json: () => [] }));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('reportsApi.getSessionMessages', () => {
  test('serializes the exact message cursor used for history pagination', async () => {
    await reportsApi.getSessionMessages('rpt-chat-1', {
      limit: 20,
      beforeId: 'rpt-msg-20',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/ai-reporting/sessions/rpt-chat-1/messages?limit=20&beforeId=rpt-msg-20',
      expect.anything(),
    );
  });
});
