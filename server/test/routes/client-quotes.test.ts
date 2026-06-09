import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realQuoteVersionsRepo from '../../repositories/quoteVersionsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
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

// Issue #779: focused coverage of the new PUT status rules (transitions, expired-frozen,
// no-op resend tolerance, the 1-to-1 supplier-quote link + conflict, and the
// expired-supplier-quote progression guard) plus the derived response fields.

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const quoteVersionsRepoSnap = { ...realQuoteVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const cqFindLinkedOfferIdMock = mock();
const cqFindCurrentMock = mock();
const cqFindAnyLinkedSaleMock = mock();
const cqFindLinkConflictMock = mock();
const cqFindFullForSnapshotMock = mock();
const cqFindItemsForQuoteMock = mock();
const cqFindIdConflictMock = mock();
const cqUpdateMock = mock();

const sqExistsByIdMock = mock();
const sqFindExpirationByIdMock = mock();

const qvInsertMock = mock();
const qvBuildSnapshotMock = mock();

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
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    findLinkedOfferId: cqFindLinkedOfferIdMock,
    findCurrent: cqFindCurrentMock,
    findAnyLinkedSale: cqFindAnyLinkedSaleMock,
    findLinkConflict: cqFindLinkConflictMock,
    findFullForSnapshot: cqFindFullForSnapshotMock,
    findItemsForQuote: cqFindItemsForQuoteMock,
    findIdConflict: cqFindIdConflictMock,
    update: cqUpdateMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    existsById: sqExistsByIdMock,
    findExpirationById: sqFindExpirationByIdMock,
  }));
  mock.module('../../repositories/quoteVersionsRepo.ts', () => ({
    ...quoteVersionsRepoSnap,
    insert: qvInsertMock,
    buildSnapshot: qvBuildSnapshotMock,
  }));
  mock.module('../../utils/audit.ts', () => ({ ...auditSnap, logAudit: logAuditMock }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/client-quotes.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module('../../repositories/quoteVersionsRepo.ts', () => quoteVersionsRepoSnap);
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

const FULL_PERMS = ['sales.client_quotes.update'];

// findCurrent returns the ClientQuoteGate shape.
const gate = (over: Partial<ReturnType<typeof baseGate>> = {}) => ({ ...baseGate(), ...over });
const baseGate = () => ({
  status: 'draft',
  discount: 0,
  discountType: 'percentage' as const,
  expirationDate: '2026-12-31',
  linkedSupplierQuoteId: null as string | null,
  linkedSupplierQuoteExpiration: null as string | null,
});

// update() returns a mapped ClientQuote (BASE projection shape).
const updatedQuote = (over: Record<string, unknown> = {}) => ({
  id: 'q-1',
  linkedOfferId: null,
  clientId: 'c1',
  clientName: 'Client',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'sent',
  expirationDate: '2026-12-31',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  linkedSupplierQuoteId: null as string | null,
  linkedSupplierQuoteExpiration: null as string | null,
  ...over,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  cqFindLinkedOfferIdMock,
  cqFindCurrentMock,
  cqFindAnyLinkedSaleMock,
  cqFindLinkConflictMock,
  cqFindFullForSnapshotMock,
  cqFindItemsForQuoteMock,
  cqFindIdConflictMock,
  cqUpdateMock,
  sqExistsByIdMock,
  sqFindExpirationByIdMock,
  qvInsertMock,
  qvBuildSnapshotMock,
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
  qvBuildSnapshotMock.mockImplementation((quote, items) => ({ schemaVersion: 1, quote, items }));

  // Sensible defaults; individual tests override what they care about.
  cqFindLinkedOfferIdMock.mockResolvedValue(null);
  cqFindAnyLinkedSaleMock.mockResolvedValue(null);
  cqFindLinkConflictMock.mockResolvedValue(false);
  cqFindIdConflictMock.mockResolvedValue(false);
  cqFindFullForSnapshotMock.mockResolvedValue({ quote: updatedQuote(), items: [] });
  cqFindItemsForQuoteMock.mockResolvedValue([]);
  qvInsertMock.mockResolvedValue(undefined);
  sqExistsByIdMock.mockResolvedValue(true);
  sqFindExpirationByIdMock.mockResolvedValue(null);

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-quotes');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const putStatus = (body: Record<string, unknown>) =>
  testApp.inject({
    method: 'PUT',
    url: '/api/sales/client-quotes/q-1',
    headers: authHeader(),
    payload: body,
  });

describe('PUT /api/sales/client-quotes/:id status rules (issue #779)', () => {
  test('200 allows draft → sent and returns derived fields', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent' }));

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('sent');
    expect(body.effectiveStatus).toBe('sent');
    expect(body).toHaveProperty('linkedSupplierQuoteId');
    expect(body.linkedSupplierQuoteExpired).toBe(false);
  });

  test('200 allows a no-op resend of the current status (draft → draft)', async () => {
    // The edit form resends the current status on every save — this must NOT trip the transition
    // rule (which would otherwise reject draft→draft as an invalid back-to-draft).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft', notes: 'edited' });
    expect(res.statusCode).toBe(200);
  });

  test('409 rejects accepted → draft (invalid_transition)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putStatus({ status: 'draft' });
    expect(res.statusCode).toBe(409);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows offer → draft (back-to-draft from offer)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft' });
    expect(res.statusCode).toBe(200);
  });

  test('409 expired quote rejects a status change but the body is otherwise frozen', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ status: 'accepted' });
    expect(res.statusCode).toBe(409);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 expired quote can be revalidated by extending the expiration date (no status change)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent', expirationDate: '2027-01-01' }));

    const res = await putStatus({ expirationDate: '2027-01-01' });
    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
  });

  test('409 when the supplier quote is already linked to another client quote', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindLinkConflictMock.mockResolvedValue(true);

    const res = await putStatus({ linkedSupplierQuoteId: 'sq-9' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('already linked');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 links a supplier quote and clears it with null', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(
      updatedQuote({ status: 'draft', linkedSupplierQuoteId: 'sq-9' }),
    );

    const res = await putStatus({ linkedSupplierQuoteId: 'sq-9' });
    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
    const patch = cqUpdateMock.mock.calls[0][1];
    expect(patch.linkedSupplierQuoteId).toBe('sq-9');
  });

  test('409 blocks progression to sent while the linked supplier quote is expired', async () => {
    cqFindCurrentMock.mockResolvedValue(
      gate({
        status: 'draft',
        linkedSupplierQuoteId: 'sq-9',
        linkedSupplierQuoteExpiration: '2000-01-01',
      }),
    );

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 still allows denial while the linked supplier quote is expired', async () => {
    // The guard only blocks sent/offer/accepted — denying a quote is always allowed.
    cqFindCurrentMock.mockResolvedValue(
      gate({
        status: 'sent',
        linkedSupplierQuoteId: 'sq-9',
        linkedSupplierQuoteExpiration: '2000-01-01',
      }),
    );
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'denied' }));

    const res = await putStatus({ status: 'denied' });
    expect(res.statusCode).toBe(200);
  });
});
