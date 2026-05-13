import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuoteAttachmentsRepo from '../../repositories/supplierQuoteAttachmentsRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSupplierQuoteVersionsRepo from '../../repositories/supplierQuoteVersionsRepo.ts';
import * as realSuppliersRepo from '../../repositories/suppliersRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realFileStorage from '../../utils/fileStorage.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { signToken } from '../helpers/jwt.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const suppliersRepoSnap = { ...realSuppliersRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const supplierQuoteAttachmentsRepoSnap = { ...realSupplierQuoteAttachmentsRepo };
const productsRepoSnap = { ...realProductsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };
const fileStorageSnap = { ...realFileStorage };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const sqFindByIdMock = mock();
const sqExistsByIdMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqDeleteByIdMock = mock();

const sqaListForQuoteMock = mock();
const sqaFindByIdMock = mock();
const sqaInsertMock = mock();
const sqaDeleteByIdMock = mock();

const saveAttachmentMock = mock();
const openAttachmentMock = mock();
const deleteAttachmentMock = mock();

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
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    findById: sqFindByIdMock,
    existsById: sqExistsByIdMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    deleteById: sqDeleteByIdMock,
  }));
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module('../../repositories/supplierQuoteAttachmentsRepo.ts', () => ({
    ...supplierQuoteAttachmentsRepoSnap,
    listForQuote: sqaListForQuoteMock,
    findById: sqaFindByIdMock,
    insert: sqaInsertMock,
    deleteById: sqaDeleteByIdMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../utils/fileStorage.ts', () => ({
    ...fileStorageSnap,
    saveSupplierQuoteAttachment: saveAttachmentMock,
    openSupplierQuoteAttachment: openAttachmentMock,
    deleteSupplierQuoteAttachment: deleteAttachmentMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/supplier-quotes.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module(
    '../../repositories/supplierQuoteAttachmentsRepo.ts',
    () => supplierQuoteAttachmentsRepoSnap,
  );
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../utils/fileStorage.ts', () => fileStorageSnap);
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

const FULL_PERMS = [
  'sales.supplier_quotes.view',
  'sales.supplier_quotes.update',
  'sales.supplier_quotes.delete',
];

const DRAFT_QUOTE = {
  id: 'sq-1',
  supplierId: 's1',
  supplierName: 'Acme',
  paymentTerms: 'immediate',
  status: 'draft',
  expirationDate: '2026-12-31',
  linkedOrderId: null,
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ATTACHMENT = {
  id: 'sqa-1',
  quoteId: 'sq-1',
  fileName: 'order.xlsx',
  storedName: 'abc-123.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  fileSize: 1024,
  uploadedByUserId: 'u1',
  createdAt: 1_700_000_000_000,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  sqFindByIdMock,
  sqExistsByIdMock,
  sqFindLinkedOrderIdMock,
  sqDeleteByIdMock,
  sqaListForQuoteMock,
  sqaFindByIdMock,
  sqaInsertMock,
  sqaDeleteByIdMock,
  saveAttachmentMock,
  openAttachmentMock,
  deleteAttachmentMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

// Custom builder so the multipart plugin is actually registered for the upload tests.
// `buildRouteTestApp` skips it because most route tests don't need multipart.
const buildAttachmentsTestApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  app.decorate('rateLimit', () => async () => {});
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 0,
    },
  });
  await app.register(routePlugin, { prefix: '/api/sales/supplier-quotes' });
  await app.ready();
  return app;
};

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  // Defaults to a resolved promise so the route's `.catch(...)` chain has something callable
  // when individual tests don't override the mock.
  deleteAttachmentMock.mockResolvedValue(undefined);

  testApp = await buildAttachmentsTestApp();
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const buildMultipartBody = (
  fileName: string,
  contentType: string,
  body: Buffer,
): { payload: Buffer; contentType: string } => {
  const boundary = '----TestBoundary123';
  const parts = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: parts, contentType: `multipart/form-data; boundary=${boundary}` };
};

describe('GET /api/sales/supplier-quotes/:id/attachments', () => {
  test('200 returns attachments without exposing storedName', async () => {
    sqExistsByIdMock.mockResolvedValue(true);
    sqaListForQuoteMock.mockResolvedValue([SAMPLE_ATTACHMENT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('sqa-1');
    expect(body[0].fileName).toBe('order.xlsx');
    expect(body[0].storedName).toBeUndefined();
    expect(sqaListForQuoteMock).toHaveBeenCalledWith('sq-1');
  });

  test('404 when quote does not exist', async () => {
    sqExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/missing/attachments',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/sales/supplier-quotes/:id/attachments', () => {
  test('201 happy path saves file, inserts row, audits', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    saveAttachmentMock.mockResolvedValue({ storedName: 'abc-123.xlsx', size: 11 });
    sqaInsertMock.mockResolvedValue(SAMPLE_ATTACHMENT);

    const { payload, contentType } = buildMultipartBody(
      'order.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('hello world'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('sqa-1');
    expect(body.fileName).toBe('order.xlsx');
    expect(saveAttachmentMock).toHaveBeenCalledTimes(1);
    expect(sqaInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: 'sq-1',
        fileName: 'order.xlsx',
        storedName: 'abc-123.xlsx',
        uploadedByUserId: 'u1',
      }),
    );
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier_quote_attachment.uploaded',
        entityType: 'supplier_quote',
        entityId: 'sq-1',
      }),
    );
  });

  test('404 when quote does not exist', async () => {
    sqFindByIdMock.mockResolvedValue(null);

    const { payload, contentType } = buildMultipartBody(
      'order.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('hi'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/missing/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(404);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
  });

  test('409 when quote status is not draft', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'sent' });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const { payload, contentType } = buildMultipartBody(
      'order.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('hi'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(409);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
  });

  test('409 when quote is linked to an order', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue('sord-1');

    const { payload, contentType } = buildMultipartBody(
      'order.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('hi'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(409);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
  });

  test('415 when file type is not in allowlist', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const { payload, contentType } = buildMultipartBody(
      'malware.exe',
      'application/octet-stream',
      Buffer.from('binary'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(415);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
  });

  test('415 when extension is disallowed even if MIME claims an allowed type', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    // Attacker uploads payload.exe but lies that it's a PDF - extension allowlist must
    // gate this regardless of the client-supplied MIME type.
    const { payload, contentType } = buildMultipartBody(
      'payload.exe',
      'application/pdf',
      Buffer.from('MZ\x90\x00binary'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(415);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
  });

  test('415 rejects active Office and CSV attachment formats', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    for (const [fileName, mimeType] of [
      ['formula.csv', 'text/csv'],
      ['legacy.xls', 'application/vnd.ms-excel'],
      ['macro.doc', 'application/msword'],
    ] as const) {
      const { payload, contentType } = buildMultipartBody(fileName, mimeType, Buffer.from('x'));

      const res = await testApp.inject({
        method: 'POST',
        url: '/api/sales/supplier-quotes/sq-1/attachments',
        headers: { ...authHeader(), 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(415);
    }

    expect(saveAttachmentMock).not.toHaveBeenCalled();
  });

  test('accepts xlsx with browser-fallback application/octet-stream MIME', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    saveAttachmentMock.mockResolvedValue({ storedName: 'abc-123.xlsx', size: 11 });
    sqaInsertMock.mockResolvedValue(SAMPLE_ATTACHMENT);

    const { payload, contentType } = buildMultipartBody(
      'order.xlsx',
      'application/octet-stream',
      Buffer.from('xlsx-bytes-'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(201);
    expect(saveAttachmentMock).toHaveBeenCalledTimes(1);
  });

  test('cleans up file when DB insert fails', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    saveAttachmentMock.mockResolvedValue({ storedName: 'abc-123.xlsx', size: 11 });
    sqaInsertMock.mockRejectedValue(new Error('DB exploded'));

    const { payload, contentType } = buildMultipartBody(
      'order.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('hello world'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(500);
    expect(deleteAttachmentMock).toHaveBeenCalledWith('abc-123.xlsx');
  });

  test('400 on non-multipart body', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/attachments',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/sales/supplier-quotes/:id/attachments/:attachmentId/download', () => {
  test('200 streams file with RFC 6266 Content-Disposition (ASCII + UTF-8)', async () => {
    sqaFindByIdMock.mockResolvedValue(SAMPLE_ATTACHMENT);
    const { Readable } = await import('node:stream');
    openAttachmentMock.mockResolvedValue({
      stream: Readable.from(Buffer.from('hello world')),
      size: 11,
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1/download',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="order.xlsx"; filename*=UTF-8''order.xlsx`,
    );
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.body).toBe('hello world');
  });

  test('strips CR/LF/quote from Content-Disposition filename to prevent header injection', async () => {
    sqaFindByIdMock.mockResolvedValue({
      ...SAMPLE_ATTACHMENT,
      fileName: 'evil"\r\nSet-Cookie: pwn=1.xlsx',
    });
    const { Readable } = await import('node:stream');
    openAttachmentMock.mockResolvedValue({
      stream: Readable.from(Buffer.from('x')),
      size: 1,
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1/download',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    // Quote stripped from the legacy `filename=` parameter; filename* preserves the original
    // (URL-encoded) so non-ASCII filenames still round-trip on RFC-5987-aware clients.
    expect(disposition).toMatch(
      /^attachment; filename="evilSet-Cookie: pwn=1\.xlsx"; filename\*=UTF-8''/,
    );
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('404 when attachment id belongs to a different quote', async () => {
    sqaFindByIdMock.mockResolvedValue({ ...SAMPLE_ATTACHMENT, quoteId: 'sq-other' });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1/download',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(openAttachmentMock).not.toHaveBeenCalled();
  });

  test('404 when stored file is missing', async () => {
    sqaFindByIdMock.mockResolvedValue(SAMPLE_ATTACHMENT);
    openAttachmentMock.mockRejectedValue(new Error('ENOENT'));

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1/download',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/sales/supplier-quotes/:id/attachments/:attachmentId', () => {
  test('204 removes row, file, and audits', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqaDeleteByIdMock.mockResolvedValue(SAMPLE_ATTACHMENT);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(sqaDeleteByIdMock).toHaveBeenCalledWith('sqa-1', 'sq-1');
    expect(deleteAttachmentMock).toHaveBeenCalledWith('abc-123.xlsx');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier_quote_attachment.deleted' }),
    );
  });

  test('409 when quote is not draft', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'sent' });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(sqaDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('404 when attachment belongs to another quote', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    // deleteById is scoped on (id, quoteId) so a mismatched quoteId yields no row.
    sqaDeleteByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/supplier-quotes/sq-1/attachments/sqa-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/sales/supplier-quotes/:id cleans up attachment files', () => {
  test('removes files for each attachment after the quote is deleted', async () => {
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqaListForQuoteMock.mockResolvedValue([
      SAMPLE_ATTACHMENT,
      { ...SAMPLE_ATTACHMENT, id: 'sqa-2', storedName: 'def-456.pdf' },
    ]);
    sqDeleteByIdMock.mockResolvedValue({ supplierName: 'Acme' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteAttachmentMock).toHaveBeenCalledTimes(2);
    expect(deleteAttachmentMock).toHaveBeenCalledWith('abc-123.xlsx');
    expect(deleteAttachmentMock).toHaveBeenCalledWith('def-456.pdf');
  });
});
