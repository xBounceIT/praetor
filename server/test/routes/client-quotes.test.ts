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
const cqFindStatusAndClientNameMock = mock();
const cqDeleteByIdMock = mock();

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
    findStatusAndClientName: cqFindStatusAndClientNameMock,
    deleteById: cqDeleteByIdMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
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

const FULL_PERMS = ['sales.client_quotes.update', 'sales.client_quotes.delete'];

// findCurrent returns the ClientQuoteGate shape.
const gate = (over: Partial<ReturnType<typeof baseGate>> = {}) => ({ ...baseGate(), ...over });
const baseGate = () => ({
  status: 'draft',
  discount: 0,
  discountType: 'percentage' as const,
  // Far future: the effective-status guards compare against the real clock, so a near date would
  // flip these fixtures to `expired` one day and break the suite (#779 second-pass review).
  expirationDate: '2999-12-31',
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
  expirationDate: '2999-12-31',
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
  cqFindStatusAndClientNameMock,
  cqDeleteByIdMock,
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
  // Existence and expiration come from ONE read post-#779 (expiration_date is NOT NULL): a null
  // expiration means "supplier quote missing", so the happy default is a real future date.
  sqFindExpirationByIdMock.mockResolvedValue('2999-12-31');

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

  test('409 expired quote rejects content edits (only the expiration date is editable)', async () => {
    // The expired-frozen rule must cover CONTENT, not just status: a PUT touching notes/items/etc.
    // (no status field) on an effectively-expired quote is rejected (issue #779).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ notes: 'edited while expired' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('409 blocks (re)linking an expired supplier quote onto an already-sent quote', async () => {
    // No status change — the supplier-expired guard must still fire when an expired supplier quote
    // is linked onto a quote that already sits in sent/offer/accepted (issue #779).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    sqFindExpirationByIdMock.mockResolvedValue('2000-01-01');

    const res = await putStatus({ linkedSupplierQuoteId: 'sq-9' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows linking an expired supplier quote to a draft quote (not progressing yet)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    sqFindExpirationByIdMock.mockResolvedValue('2000-01-01');
    cqUpdateMock.mockResolvedValue(
      updatedQuote({ status: 'draft', linkedSupplierQuoteId: 'sq-9' }),
    );

    const res = await putStatus({ linkedSupplierQuoteId: 'sq-9' });
    expect(res.statusCode).toBe(200);
  });

  test('200 tolerates a resend of the UNCHANGED expired link on a sent quote (no-op save)', async () => {
    // The edit form resends linkedSupplierQuoteId on every save; an unchanged link on an
    // already-sent quote must not trip the supplier-expired guard (only NEW links do).
    cqFindCurrentMock.mockResolvedValue(
      gate({
        status: 'sent',
        linkedSupplierQuoteId: 'sq-9',
        linkedSupplierQuoteExpiration: '2000-01-01',
      }),
    );
    sqFindExpirationByIdMock.mockResolvedValue('2000-01-01');
    cqUpdateMock.mockResolvedValue(
      updatedQuote({ status: 'sent', linkedSupplierQuoteId: 'sq-9', notes: 'edited' }),
    );

    const res = await putStatus({ status: 'sent', linkedSupplierQuoteId: 'sq-9', notes: 'edited' });
    expect(res.statusCode).toBe(200);
  });

  test('response does not flag linkedSupplierQuoteExpired on a terminal (accepted) quote', async () => {
    // Accepted/denied are frozen and can never progress, so the "extend before progressing"
    // indicator must not show even when the linked supplier quote is past its expiration (#779).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'accepted' }));
    cqUpdateMock.mockResolvedValue(
      updatedQuote({
        status: 'accepted',
        linkedSupplierQuoteId: 'sq-9',
        linkedSupplierQuoteExpiration: '2000-01-01',
      }),
    );

    const res = await putStatus({ status: 'accepted' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).linkedSupplierQuoteExpired).toBe(false);
  });

  test('normalizes a legacy status value on write so the tightened CHECK is never hit', async () => {
    // The request schema does not constrain status; a legacy 'quoted' must be folded to 'draft'
    // before the write (issue #779) rather than reaching the DB CHECK as-is.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'quoted' });
    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
    expect(cqUpdateMock.mock.calls[0][1].status).toBe('draft');
  });

  test('400 rejects an unknown status value instead of silently flooring it to draft', async () => {
    // The derived-only `expired` (or any typo) must never round-trip into a write: the old floor
    // would have demoted a sent quote to draft with a 200 (#779 second-pass review).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putStatus({ status: 'expired' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('status must be one of');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('400 when the linked supplier quote does not exist (null expiration = missing row)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    sqFindExpirationByIdMock.mockResolvedValue(null);

    const res = await putStatus({ linkedSupplierQuoteId: 'sq-missing' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('does not reference');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('a stale request-side isExpired field is ignored and the response value is computed', async () => {
    // The pre-#779 optimistic-restore override is gone: a body carrying only `isExpired` is a
    // no-op update (not a content edit) and the response reports the derived value.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ isExpired: false });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isExpired).toBe(true);
    expect(body.effectiveStatus).toBe('expired');
  });
});

describe('DELETE /api/sales/client-quotes/:id', () => {
  const deleteQuote = (id: string) =>
    testApp.inject({
      method: 'DELETE',
      url: `/api/sales/client-quotes/${id}`,
      headers: authHeader(),
    });

  test('204 deletes a deletable quote via the slash-form URL the frontend sends', async () => {
    // Also pins the route REGISTRATION: a ':id' path (missing leading slash) would concatenate
    // under the plugin prefix to /api/sales/client-quotes:id and 404 this exact request shape,
    // which is what services/api/clientQuotes.ts sends.
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'draft', clientName: 'Client' });
    cqDeleteByIdMock.mockResolvedValue(undefined);

    const res = await deleteQuote('q-1');
    expect(res.statusCode).toBe(204);
    expect(cqDeleteByIdMock).toHaveBeenCalledWith('q-1');
  });

  test('409 when an offer was created from the quote', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('of-1');

    const res = await deleteQuote('q-1');
    expect(res.statusCode).toBe(409);
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('409 when the quote is accepted', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });

    const res = await deleteQuote('q-1');
    expect(res.statusCode).toBe(409);
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('404 when the quote does not exist', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue(null);

    const res = await deleteQuote('missing');
    expect(res.statusCode).toBe(404);
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });
});
