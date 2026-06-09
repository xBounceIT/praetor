import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realOfferVersionsRepo from '../../repositories/offerVersionsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

// Issue #779 (extended to offers): focused coverage of the PUT expired rules — the derived
// `effectiveStatus`, expired content-read-only-except-date, the expired status freeze, and the
// expiration-date carve-out from the non-draft lock (terminal offers stay fully frozen).

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientsRepoSnap = { ...realClientsRepo };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const productsRepoSnap = { ...realProductsRepo };
const offerVersionsRepoSnap = { ...realOfferVersionsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const coFindExistingMock = mock();
const coFindFullForSnapshotMock = mock();
const coFindItemsForOfferMock = mock();
const coFindIdConflictMock = mock();
const coUpdateMock = mock();
const coRenameMock = mock();

const ovInsertMock = mock();
const ovBuildSnapshotMock = mock();

const logAuditMock = mock(async () => undefined);
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({ ...clientsRepoSnap }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    findExisting: coFindExistingMock,
    findFullForSnapshot: coFindFullForSnapshotMock,
    findItemsForOffer: coFindItemsForOfferMock,
    findIdConflict: coFindIdConflictMock,
    update: coUpdateMock,
    rename: coRenameMock,
  }));
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({ ...clientQuotesRepoSnap }));
  mock.module('../../repositories/productsRepo.ts', () => ({ ...productsRepoSnap }));
  mock.module('../../repositories/offerVersionsRepo.ts', () => ({
    ...offerVersionsRepoSnap,
    insert: ovInsertMock,
    buildSnapshot: ovBuildSnapshotMock,
  }));
  mock.module('../../utils/audit.ts', () => ({ ...auditSnap, logAudit: logAuditMock }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/client-offers.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../repositories/offerVersionsRepo.ts', () => offerVersionsRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const FULL_PERMS = ['sales.client_offers.update'];

// findExisting returns the ExistingOffer gate shape.
const gate = (over: Partial<ReturnType<typeof baseGate>> = {}) => ({ ...baseGate(), ...over });
const baseGate = () => ({
  id: 'off-1',
  linkedQuoteId: 'q-1',
  clientId: 'c1',
  clientName: 'Client',
  status: 'draft',
  deliveryDate: null as string | null,
  // Far future: the effective-status guards compare against the real clock, so a near date would
  // flip these fixtures to `expired` one day and break the suite.
  expirationDate: '2999-12-31',
});

// update() returns the full mapped ClientOffer row.
const updatedOffer = (over: Record<string, unknown> = {}) => ({
  id: 'off-1',
  linkedQuoteId: 'q-1',
  clientId: 'c1',
  clientName: 'Client',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft',
  deliveryDate: null,
  expirationDate: '2999-12-31',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  coFindExistingMock,
  coFindFullForSnapshotMock,
  coFindItemsForOfferMock,
  coFindIdConflictMock,
  coUpdateMock,
  coRenameMock,
  ovInsertMock,
  ovBuildSnapshotMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  ovBuildSnapshotMock.mockImplementation((offer, items) => ({ schemaVersion: 1, offer, items }));

  // Sensible defaults; individual tests override what they care about.
  coFindFullForSnapshotMock.mockResolvedValue({ offer: updatedOffer(), items: [] });
  coFindItemsForOfferMock.mockResolvedValue([]);
  coFindIdConflictMock.mockResolvedValue(false);
  ovInsertMock.mockResolvedValue(undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-offers');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const putOffer = (body: Record<string, unknown>) =>
  testApp.inject({
    method: 'PUT',
    url: '/api/sales/client-offers/off-1',
    headers: authHeader(),
    payload: body,
  });

describe('PUT /api/sales/client-offers/:id expired rules (issue #779)', () => {
  test('200 extends an expired sent offer via its expiration date and derives effectiveStatus', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2999-12-31' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.effectiveStatus).toBe('sent');
    expect(coUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('409 expired offer rejects content edits (only the expiration date is editable)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft', expirationDate: '2000-01-01' }));

    const res = await putOffer({ notes: 'edited while expired' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('409 expired offer rejects a status change (extend the date instead)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putOffer({ status: 'accepted' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('cannot change status');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('200 tolerates a no-op resend of the stored status on an expired offer', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putOffer({ status: 'sent' });
    expect(res.statusCode).toBe(200);
  });

  test('409 non-draft content edits stay blocked (pre-existing rule)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putOffer({ notes: 'edited while sent' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Non-draft');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('200 a valid sent offer can renew its expiration date (date carved out of the lock)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2999-12-31' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('409 terminal offers keep the expiration date locked (they never expire)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Non-draft');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('terminal accepted offers never report expired even with a past date', async () => {
    coFindExistingMock.mockResolvedValue(
      gate({ status: 'accepted', expirationDate: '2000-01-01' }),
    );
    coUpdateMock.mockResolvedValue(
      updatedOffer({ status: 'accepted', expirationDate: '2000-01-01' }),
    );

    const res = await putOffer({ status: 'accepted' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).effectiveStatus).toBe('accepted');
  });
});
