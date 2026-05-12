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

describe('ensureBootstrapAdmin', () => {
  test('creates a fresh admin with the literal default password', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    bcryptHashMock.mockResolvedValue('$2a$password-hash');
    bcryptCompareMock.mockResolvedValue(true);

    const adminId = await bootstrapAdmin.ensureBootstrapAdmin();

    expect(adminId).toBe('u1');
    expect(bcryptHashMock).toHaveBeenCalledWith('password', 12);
    expect(createUserMock).toHaveBeenCalledWith({
      id: 'u1',
      name: 'Admin User',
      username: 'admin',
      passwordHash: '$2a$password-hash',
      role: 'admin',
      avatarInitials: 'AD',
    });
    expect(upsertAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
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
