import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import * as realDbIndex from '../../db/index.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';

type BootstrapAdminModule = typeof import('../../db/bootstrapAdmin.ts');

const dbIndexSnap = { ...realDbIndex };
const usersRepoSnap = { ...realUsersRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };

const queryMock = mock();
const createUserMock = mock();
const upsertAdminPasswordWarningMock = mock();
const deleteAdminPasswordWarningMock = mock();
const bcryptHashMock = mock();
const bcryptCompareMock = mock();

let bootstrapAdmin: BootstrapAdminModule;

beforeAll(async () => {
  mock.module('../../db/index.ts', () => ({
    ...dbIndexSnap,
    query: queryMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    createUser: createUserMock,
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
  mock.module('../../db/index.ts', () => dbIndexSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('bcryptjs', () => bcryptSnap);
});

const allMocks = [
  queryMock,
  createUserMock,
  upsertAdminPasswordWarningMock,
  deleteAdminPasswordWarningMock,
  bcryptHashMock,
  bcryptCompareMock,
];

beforeEach(() => {
  for (const mockedFn of allMocks) mockedFn.mockReset();
  createUserMock.mockResolvedValue(undefined);
  upsertAdminPasswordWarningMock.mockResolvedValue(undefined);
  deleteAdminPasswordWarningMock.mockResolvedValue(undefined);
});

describe('resolveAdminBootstrapPassword', () => {
  test('uses env value when provided', () => {
    const resolved = bootstrapAdmin.resolveAdminBootstrapPassword('s3cret-from-env');
    expect(resolved).toEqual({ password: 's3cret-from-env', source: 'env' });
  });

  test('generates a random password when env value is absent', () => {
    const resolved = bootstrapAdmin.resolveAdminBootstrapPassword(undefined);
    expect(resolved.source).toBe('generated');
    expect(resolved.password).not.toBe('password');
    expect(resolved.password.length).toBeGreaterThanOrEqual(20);
  });

  test('generates a random password when env value is empty', () => {
    const resolved = bootstrapAdmin.resolveAdminBootstrapPassword('');
    expect(resolved.source).toBe('generated');
    expect(resolved.password).not.toBe('');
  });

  test('successive generated passwords differ', () => {
    const a = bootstrapAdmin.resolveAdminBootstrapPassword(undefined);
    const b = bootstrapAdmin.resolveAdminBootstrapPassword(undefined);
    expect(a.password).not.toBe(b.password);
  });
});

describe('ensureBootstrapAdmin', () => {
  const ORIGINAL_ENV = process.env.ADMIN_DEFAULT_PASSWORD;

  beforeEach(() => {
    delete process.env.ADMIN_DEFAULT_PASSWORD;
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ADMIN_DEFAULT_PASSWORD;
    } else {
      process.env.ADMIN_DEFAULT_PASSWORD = ORIGINAL_ENV;
    }
  });

  test('creates a fresh admin with a generated password when env is unset', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    bcryptHashMock.mockResolvedValue('$2a$generated-hash');
    bcryptCompareMock.mockResolvedValue(false);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(bcryptHashMock).toHaveBeenCalledTimes(1);
    const [hashedPassword, cost] = bcryptHashMock.mock.calls[0];
    expect(hashedPassword).not.toBe('password');
    expect(typeof hashedPassword).toBe('string');
    expect((hashedPassword as string).length).toBeGreaterThanOrEqual(20);
    expect(cost).toBe(12);
    expect(createUserMock).toHaveBeenCalledWith({
      id: 'u1',
      name: 'Admin User',
      username: 'admin',
      passwordHash: '$2a$generated-hash',
      role: 'admin',
      avatarInitials: 'AD',
    });
    // Random password is not the legacy default so we must NOT raise the warning.
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledTimes(1);
  });

  test('creates a fresh admin with the env-supplied password when set', async () => {
    process.env.ADMIN_DEFAULT_PASSWORD = 'operator-chosen';
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    bcryptHashMock.mockResolvedValue('$2a$env-hash');
    bcryptCompareMock.mockResolvedValue(false);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(bcryptHashMock).toHaveBeenCalledWith('operator-chosen', 12);
    expect(createUserMock).toHaveBeenCalledWith({
      id: 'u1',
      name: 'Admin User',
      username: 'admin',
      passwordHash: '$2a$env-hash',
      role: 'admin',
      avatarInitials: 'AD',
    });
  });

  test('existing admin with default password gets the warning', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'u1', password_hash: '$2a$existing' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    bcryptCompareMock.mockResolvedValue(true);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).toHaveBeenCalledWith('password', '$2a$existing');
    expect(upsertAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('existing admin with changed password removes the warning', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'u1', password_hash: '$2a$changed' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    bcryptCompareMock.mockResolvedValue(false);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).toHaveBeenCalledWith('password', '$2a$changed');
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledTimes(1);
  });
});
