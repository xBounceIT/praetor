import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { __resetJwtSecretCacheForTests, authenticateToken } from '../../middleware/auth.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';
import { DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES } from '../../utils/sessionTimeout.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnapshot = { ...realUsersRepo };
const rolesRepoSnapshot = { ...realRolesRepo };
const generalSettingsRepoSnapshot = { ...realGeneralSettingsRepo };
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

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

const SECRET_A = 'praetor-test-secret-A-aaaaaaaaaaaaaaaa';
const SECRET_B = 'praetor-test-secret-B-bbbbbbbbbbbbbbbb';

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
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnapshot,
    get: async () => ({ sessionIdleTimeoutMinutes: DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES }),
  }));
});

afterAll(() => {
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
  __resetJwtSecretCacheForTests();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnapshot);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnapshot);
  mock.module('../../utils/permissions.ts', () => permissionsSnapshot);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnapshot);
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
  __resetJwtSecretCacheForTests();
});

describe('JWT_SECRET lazy resolution', () => {
  test('after reset, the next request honors the new process.env.JWT_SECRET', async () => {
    process.env.JWT_SECRET = SECRET_A;
    __resetJwtSecretCacheForTests();

    const tokenA = signToken({ userId: 'u1', secret: SECRET_A });
    const replyA = buildFakeReply();
    await authenticateToken(buildFakeRequest(tokenA) as never, replyA as never);

    expect(replyA.statusCode).toBe(0);
    expect(typeof replyA.headers['x-auth-token']).toBe('string');

    process.env.JWT_SECRET = SECRET_B;
    __resetJwtSecretCacheForTests();

    const replyStale = buildFakeReply();
    await authenticateToken(buildFakeRequest(tokenA) as never, replyStale as never);

    expect(replyStale.statusCode).toBe(403);
    expect(replyStale.body).toEqual({ error: 'Invalid or expired token' });

    const tokenB = signToken({ userId: 'u1', secret: SECRET_B });
    const replyB = buildFakeReply();
    await authenticateToken(buildFakeRequest(tokenB) as never, replyB as never);

    expect(replyB.statusCode).toBe(0);
  });

  test('without calling the reset hook, the cached secret persists despite env mutation', async () => {
    process.env.JWT_SECRET = SECRET_A;
    __resetJwtSecretCacheForTests();
    const warmup = buildFakeReply();
    await authenticateToken(
      buildFakeRequest(signToken({ userId: 'u1', secret: SECRET_A })) as never,
      warmup as never,
    );
    expect(warmup.statusCode).toBe(0);

    process.env.JWT_SECRET = SECRET_B;

    const replyCached = buildFakeReply();
    await authenticateToken(
      buildFakeRequest(signToken({ userId: 'u1', secret: SECRET_A })) as never,
      replyCached as never,
    );
    expect(replyCached.statusCode).toBe(0);

    const replyNew = buildFakeReply();
    await authenticateToken(
      buildFakeRequest(signToken({ userId: 'u1', secret: SECRET_B })) as never,
      replyNew as never,
    );
    expect(replyNew.statusCode).toBe(403);
    expect(replyNew.body).toEqual({ error: 'Invalid or expired token' });
  });
});
