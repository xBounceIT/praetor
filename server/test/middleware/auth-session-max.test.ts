// Isolated test for SESSION_MAX_DURATION_MS configuration. The auth middleware caches the
// env var on first use, so each test sets process.env.SESSION_MAX_DURATION_MS and invokes
// the cache-reset hook so the next request re-resolves the configured window.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  __resetSessionMaxDurationCacheForTests,
  authenticateToken,
} from '../../middleware/auth.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnapshot = { ...realUsersRepo };
const rolesRepoSnapshot = { ...realRolesRepo };
const permissionsSnapshot = { ...realPermissions };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const HAPPY_PERMISSIONS = ['timesheets.tracker.view'];

const ORIGINAL_SESSION_MAX = process.env.SESSION_MAX_DURATION_MS;

beforeAll(() => {
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnapshot,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnapshot,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnapshot,
    getRolePermissions: getRolePermissionsMock,
  }));
});

afterAll(() => {
  if (ORIGINAL_SESSION_MAX === undefined) {
    delete process.env.SESSION_MAX_DURATION_MS;
  } else {
    process.env.SESSION_MAX_DURATION_MS = ORIGINAL_SESSION_MAX;
  }
  // Restore the default cache value for any subsequent tests.
  __resetSessionMaxDurationCacheForTests();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnapshot);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnapshot);
  mock.module('../../utils/permissions.ts', () => permissionsSnapshot);
});

type FakeReply = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  code(c: number): FakeReply;
  send(body: unknown): FakeReply;
  header(name: string, value: string): FakeReply;
};

const buildFakeReply = (): FakeReply => {
  const reply: FakeReply = {
    statusCode: 0,
    body: undefined,
    headers: {},
    code(c: number) {
      reply.statusCode = c;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
  };
  return reply;
};

type FakeRequest = { headers: Record<string, string | undefined> };
const buildFakeRequest = (token: string): FakeRequest => ({
  headers: { authorization: `Bearer ${token}` },
});

beforeEach(() => {
  findAuthUserByIdMock.mockReset();
  userHasRoleMock.mockReset();
  getRolePermissionsMock.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);
  // Apply our overridden window and reset the cached value so the next request re-resolves.
  process.env.SESSION_MAX_DURATION_MS = '1000';
  __resetSessionMaxDurationCacheForTests();
});

describe('SESSION_MAX_DURATION_MS env override', () => {
  test('rejects a session older than the configured max (1s) with 401', async () => {
    // sessionStart 2 seconds ago should exceed our 1s SESSION_MAX_DURATION_MS.
    const sessionStart = Date.now() - 2_000;
    const token = signToken({ userId: 'u1', sessionStart });
    const reply = buildFakeReply();

    await authenticateToken(buildFakeRequest(token) as never, reply as never);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Session expired (max duration exceeded)' });
    // The handler short-circuits before loading the user.
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });

  test('a fresh session (sessionStart = now) is still accepted', async () => {
    const token = signToken({ userId: 'u1', sessionStart: Date.now() });
    const reply = buildFakeReply();

    await authenticateToken(buildFakeRequest(token) as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
    expect(findAuthUserByIdMock).toHaveBeenCalledWith('u1');
  });

  test('non-positive values fall back to the default 8h window', async () => {
    process.env.SESSION_MAX_DURATION_MS = 'not-a-number';
    __resetSessionMaxDurationCacheForTests();

    // A session 10s old would have been rejected under the 1s override but must be accepted
    // when we fall back to the 8h default.
    const sessionStart = Date.now() - 10_000;
    const token = signToken({ userId: 'u1', sessionStart });
    const reply = buildFakeReply();

    await authenticateToken(buildFakeRequest(token) as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
  });
});
