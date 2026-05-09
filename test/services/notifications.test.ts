import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

// Load the real notifications module - it pulls the real client.ts which calls our fetch mock.
const { notificationsApi } = await import('../../services/api/notifications');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => respondWith({}));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('notificationsApi', () => {
  test('list() GETs /notifications and returns the response payload', async () => {
    const payload = {
      notifications: [
        { id: 'n1', message: 'hello', read: false },
        { id: 'n2', message: 'world', read: true },
      ],
      unreadCount: 1,
    };
    fetchMock.mockImplementation(async () => respondWith(payload));

    const result = await notificationsApi.list();

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain('/notifications');
    expect(result).toEqual(payload as never);
  });

  test('markAsRead() PUTs to /notifications/:id/read', async () => {
    fetchMock.mockImplementation(async () => respondWith({ success: true }));

    const result = await notificationsApi.markAsRead('abc-123');

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain('/notifications/abc-123/read');
    expect((call[1] as { method: string }).method).toBe('PUT');
    expect(result).toEqual({ success: true } as never);
  });

  test('markAllAsRead() PUTs to /notifications/read-all', async () => {
    fetchMock.mockImplementation(async () => respondWith({ success: true }));

    const result = await notificationsApi.markAllAsRead();

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain('/notifications/read-all');
    expect((call[1] as { method: string }).method).toBe('PUT');
    expect(result).toEqual({ success: true } as never);
  });

  test('delete() DELETEs to /notifications/:id', async () => {
    // 204 → fetchApi returns {} without parsing body.
    fetchMock.mockImplementation(async () => respondWith({}, 204));

    await notificationsApi.delete('xyz-789');

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain('/notifications/xyz-789');
    expect((call[1] as { method: string }).method).toBe('DELETE');
  });

  test('errors thrown by the underlying client propagate to the caller', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });

    await expect(notificationsApi.list()).rejects.toThrow('network down');
    await expect(notificationsApi.markAsRead('1')).rejects.toThrow('network down');
    await expect(notificationsApi.markAllAsRead()).rejects.toThrow('network down');
    await expect(notificationsApi.delete('1')).rejects.toThrow('network down');
  });

  test('id segments are interpolated literally (no URL encoding)', async () => {
    // The current implementation embeds the id directly; this test pins that
    // behaviour so future refactors are intentional.
    fetchMock.mockImplementation(async () => respondWith({ success: true }));

    await notificationsApi.markAsRead('id with spaces');
    await notificationsApi.delete('id/with/slashes');

    expect(String(fetchMock.mock.calls[0][0])).toContain('/notifications/id with spaces/read');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/notifications/id/with/slashes');
  });
});
