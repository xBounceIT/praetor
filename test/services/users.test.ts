import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { UpdateUserInput } from '../../services/api/users';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => buildResponse({ status: 200 }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { usersApi } = await import('../../services/api/users');

const baseUser = {
  id: 'u-1',
  name: 'Alice',
  role: 'admin',
  avatarInitials: 'AL',
  username: 'alice',
  email: 'alice@x.com',
  costPerHour: 50,
  employeeType: 'app_user' as const,
};

beforeEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('usersApi.update', () => {
  test('PUTs to /users/:id with the DTO body and normalizes the response', async () => {
    fetchMock.mockImplementationOnce(async () =>
      buildResponse({ status: 200, json: () => ({ ...baseUser, costPerHour: '75' }) }),
    );

    const updates: UpdateUserInput = { name: 'Alice B.', costPerHour: 75, email: 'a@x.com' };
    const result = await usersApi.update('u-1', updates);

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain('/users/u-1');
    expect((call[1] as { method: string }).method).toBe('PUT');
    expect((call[1] as { body: string }).body).toBe(JSON.stringify(updates));

    expect(result.costPerHour).toBe(75);
  });

  test('UpdateUserInput type rejects fields the server silently drops', () => {
    // @ts-expect-error - permissions cannot be set via PUT /users/:id
    const _bad: UpdateUserInput = { permissions: ['*'] };
    // @ts-expect-error - availableRoles cannot be set via PUT /users/:id
    const _bad2: UpdateUserInput = { availableRoles: [] };
    // @ts-expect-error - hasTopManagerRole is server-derived
    const _bad3: UpdateUserInput = { hasTopManagerRole: true };
    // @ts-expect-error - id is the path param, not a body field
    const _bad4: UpdateUserInput = { id: 'other' };
    void _bad;
    void _bad2;
    void _bad3;
    void _bad4;
    expect(true).toBe(true);
  });
});
