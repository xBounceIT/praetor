import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';

type BootstrapAdminModule = typeof import('../../db/bootstrapAdmin.ts');

const drizzleSnap = { ...realDrizzle };
const usersRepoSnap = { ...realUsersRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };

const advisoryLockMock = mock();
const withDbTransactionMock = mock(async (callback: (tx: unknown) => unknown): Promise<unknown> => {
  const tx = { execute: advisoryLockMock };
  return callback(tx);
});
const findLoginUserByExactUsernameMock = mock();
const findLoginUserByIdMock = mock();
const createUserMock = mock();
const addUserRoleMock = mock();
const upsertAdminPasswordWarningMock = mock();
const deleteAdminPasswordWarningMock = mock();
const bcryptHashMock = mock();
const bcryptCompareMock = mock();

let bootstrapAdmin: BootstrapAdminModule;

beforeAll(async () => {
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findLoginUserByExactUsername: findLoginUserByExactUsernameMock,
    findLoginUserById: findLoginUserByIdMock,
    createUser: createUserMock,
    addUserRole: addUserRoleMock,
  }));
  mock.module('../../repositories/notificationsRepo.ts', () => ({
    ...notificationsRepoSnap,
    upsertAdminPasswordWarning: upsertAdminPasswordWarningMock,
    deleteAdminPasswordWarning: deleteAdminPasswordWarningMock,
  }));
  mock.module('bcryptjs', () => ({
    default: { hash: bcryptHashMock, compare: bcryptCompareMock },
    hash: bcryptHashMock,
    compare: bcryptCompareMock,
  }));

  bootstrapAdmin = await import('../../db/bootstrapAdmin.ts');
});

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('bcryptjs', () => bcryptSnap);
});

const allMocks = [
  advisoryLockMock,
  withDbTransactionMock,
  findLoginUserByExactUsernameMock,
  findLoginUserByIdMock,
  createUserMock,
  addUserRoleMock,
  upsertAdminPasswordWarningMock,
  deleteAdminPasswordWarningMock,
  bcryptHashMock,
  bcryptCompareMock,
];

const ADMIN_PASSWORD_ENV = 'ADMIN_DEFAULT_PASSWORD';
const SECURE_ADMIN_PASSWORD = 'op-chosen-strong-pw';
const originalAdminPasswordEnv = process.env[ADMIN_PASSWORD_ENV];

beforeEach(() => {
  for (const mockedFn of allMocks) mockedFn.mockReset();
  advisoryLockMock.mockResolvedValue({ rows: [] });
  withDbTransactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => {
    const tx = { execute: advisoryLockMock };
    return callback(tx);
  });
  findLoginUserByExactUsernameMock.mockResolvedValue(null);
  findLoginUserByIdMock.mockResolvedValue(null);
  createUserMock.mockResolvedValue(undefined);
  addUserRoleMock.mockResolvedValue(undefined);
  upsertAdminPasswordWarningMock.mockResolvedValue(undefined);
  deleteAdminPasswordWarningMock.mockResolvedValue(undefined);
  process.env[ADMIN_PASSWORD_ENV] = SECURE_ADMIN_PASSWORD;
});

afterEach(() => {
  if (originalAdminPasswordEnv === undefined) {
    delete process.env[ADMIN_PASSWORD_ENV];
  } else {
    process.env[ADMIN_PASSWORD_ENV] = originalAdminPasswordEnv;
  }
});

describe('ensureBootstrapAdmin', () => {
  test('refuses to create the bootstrap admin without an operator-provided password', async () => {
    delete process.env[ADMIN_PASSWORD_ENV];
    bcryptHashMock.mockResolvedValue('$2a$password-hash');

    await expect(bootstrapAdmin.ensureBootstrapAdmin()).rejects.toThrow(
      'ADMIN_DEFAULT_PASSWORD must be set to a non-default value before creating the bootstrap admin.',
    );

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('concurrent startup creates the bootstrap admin only once', async () => {
    let admin: { id: string; passwordHash: string } | null = null;
    let lockTail = Promise.resolve();
    let lockAcquisitions = 0;
    withDbTransactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const previousLock = lockTail;
      let releaseLock: () => void = () => undefined;
      lockTail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const tx = {
        execute: async () => {
          lockAcquisitions += 1;
          await previousLock;
          return { rows: [] };
        },
      };
      try {
        return await callback(tx);
      } finally {
        releaseLock();
      }
    });
    findLoginUserByExactUsernameMock.mockImplementation(async () => admin);
    createUserMock.mockImplementation(async (user: { id: string; passwordHash: string }) => {
      admin = { id: user.id, passwordHash: user.passwordHash };
    });
    bcryptHashMock.mockResolvedValue('$2a$password-hash');
    bcryptCompareMock.mockResolvedValue(true);

    const adminIds = await Promise.all([
      bootstrapAdmin.ensureBootstrapAdmin(),
      bootstrapAdmin.ensureBootstrapAdmin(),
    ]);

    expect(adminIds).toEqual(['u1', 'u1']);
    expect(lockAcquisitions).toBe(2);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(addUserRoleMock).toHaveBeenCalledTimes(2);
  });

  test('creates a fresh admin with the configured password', async () => {
    bcryptHashMock.mockResolvedValue('$2a$operator-password-hash');
    bcryptCompareMock.mockResolvedValue(false);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(bcryptHashMock).toHaveBeenCalledWith(SECURE_ADMIN_PASSWORD, 12);
    expect(createUserMock).toHaveBeenCalledWith(
      {
        id: 'u1',
        name: 'Admin User',
        username: 'admin',
        passwordHash: '$2a$operator-password-hash',
        role: 'admin',
        avatarInitials: 'AD',
      },
      expect.anything(),
    );
    const transaction = createUserMock.mock.calls[0][1];
    expect(addUserRoleMock).toHaveBeenCalledWith('u1', 'admin', transaction);
    expect(advisoryLockMock).toHaveBeenCalledTimes(1);
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
  });

  test('keeps user creation and role assignment in the same transaction', async () => {
    addUserRoleMock.mockRejectedValue(new Error('role assignment failed'));
    bcryptHashMock.mockResolvedValue('$2a$password-hash');

    await expect(bootstrapAdmin.ensureBootstrapAdmin()).rejects.toThrow('role assignment failed');

    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(createUserMock.mock.calls[0][1]).toBe(addUserRoleMock.mock.calls[0][2]);
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('existing admin with default password gets the warning', async () => {
    delete process.env[ADMIN_PASSWORD_ENV];
    findLoginUserByExactUsernameMock.mockResolvedValue({
      id: 'u1',
      passwordHash: '$2a$existing',
    });
    bcryptCompareMock.mockResolvedValue(true);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).toHaveBeenCalledWith('password', '$2a$existing');
    expect(upsertAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('existing admin with changed password removes the warning', async () => {
    findLoginUserByExactUsernameMock.mockResolvedValue({
      id: 'u1',
      passwordHash: '$2a$changed',
    });
    bcryptCompareMock.mockResolvedValue(false);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).toHaveBeenCalledWith('password', '$2a$changed');
    expect(bcryptCompareMock).toHaveBeenCalledWith(
      'change-me-strong-admin-password',
      '$2a$changed',
    );
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledTimes(1);
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
  });

  test('fresh admin uses ADMIN_DEFAULT_PASSWORD when set', async () => {
    process.env[ADMIN_PASSWORD_ENV] = 'another-op-chosen-strong-pw';
    bcryptHashMock.mockResolvedValue('$2a$op-hash');
    bcryptCompareMock.mockResolvedValue(false);

    await bootstrapAdmin.ensureBootstrapAdmin();

    expect(bcryptHashMock).toHaveBeenCalledWith('another-op-chosen-strong-pw', 12);
    expect(bcryptHashMock).not.toHaveBeenCalledWith('password', 12);
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: '$2a$op-hash' }),
      expect.anything(),
    );
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledTimes(1);
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
  });

  test('refuses to create the bootstrap admin when the configured password is whitespace', async () => {
    process.env[ADMIN_PASSWORD_ENV] = '   ';

    await expect(bootstrapAdmin.ensureBootstrapAdmin()).rejects.toThrow(
      'ADMIN_DEFAULT_PASSWORD must be set to a non-default value before creating the bootstrap admin.',
    );

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test.each([
    'password',
    'change-me-strong-admin-password',
  ])('refuses to create the bootstrap admin with the known password %s', async (knownPassword) => {
    process.env[ADMIN_PASSWORD_ENV] = knownPassword;

    await expect(bootstrapAdmin.ensureBootstrapAdmin()).rejects.toThrow(
      'ADMIN_DEFAULT_PASSWORD must be set to a non-default value before creating the bootstrap admin.',
    );

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('does not require ADMIN_DEFAULT_PASSWORD when the bootstrap admin already exists', async () => {
    delete process.env[ADMIN_PASSWORD_ENV];
    findLoginUserByExactUsernameMock.mockResolvedValue({
      id: 'u1',
      passwordHash: '$2a$changed',
    });
    bcryptCompareMock.mockResolvedValue(false);

    await expect(bootstrapAdmin.ensureBootstrapAdmin()).resolves.toBe('u1');

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('existing admin still using the .env.example placeholder gets the warning', async () => {
    findLoginUserByExactUsernameMock.mockResolvedValue({
      id: 'u1',
      passwordHash: '$2a$placeholder',
    });
    bcryptCompareMock.mockImplementation(
      async (candidate: string) => candidate === 'change-me-strong-admin-password',
    );

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(upsertAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });
});
