import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierQuoteAttachmentsRepo from '../../repositories/supplierQuoteAttachmentsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Column order matches db/schema/supplierQuoteAttachments.ts:
//   [id, quoteId, fileName, storedName, mimeType, fileSize, uploadedByUserId, createdAt]
const ATTACHMENT_BASE: readonly unknown[] = [
  'sqa-1',
  'q-1',
  'order.xlsx',
  'abc-123.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  2048,
  'u-1',
  new Date(1735689600000),
];

const attachmentRow = (overrides: Record<number, unknown> = {}) =>
  makeRow(ATTACHMENT_BASE, overrides);

describe('listForQuote', () => {
  test('orders by created_at DESC and filters by quoteId', async () => {
    exec.enqueue({ rows: [attachmentRow()] });
    const result = await supplierQuoteAttachmentsRepo.listForQuote('q-1', testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('from "supplier_quote_attachments"');
    expect(sql).toContain('"quote_id" = $1');
    expect(sql).toContain('order by "supplier_quote_attachments"."created_at" desc');
    expect(exec.calls[0].params).toEqual(['q-1']);
    expect(result[0].id).toBe('sqa-1');
    expect(result[0].fileName).toBe('order.xlsx');
    expect(result[0].fileSize).toBe(2048);
    expect(result[0].createdAt).toBe(1735689600000);
  });

  test('returns empty array when no rows', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuoteAttachmentsRepo.listForQuote('q-x', testDb)).toEqual([]);
  });
});

describe('findById', () => {
  test('binds id and limits to 1', async () => {
    exec.enqueue({ rows: [attachmentRow()] });
    const result = await supplierQuoteAttachmentsRepo.findById('sqa-1', testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('"id" = $1');
    expect(sql).toContain('limit $2');
    expect(exec.calls[0].params).toEqual(['sqa-1', 1]);
    expect(result?.storedName).toBe('abc-123.xlsx');
  });

  test('returns null when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuoteAttachmentsRepo.findById('missing', testDb)).toBeNull();
  });
});

describe('insert', () => {
  test('inserts the supplied values and returns mapped row', async () => {
    exec.enqueue({ rows: [attachmentRow()] });
    const result = await supplierQuoteAttachmentsRepo.insert(
      {
        id: 'sqa-1',
        quoteId: 'q-1',
        fileName: 'order.xlsx',
        storedName: 'abc-123.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 2048,
        uploadedByUserId: 'u-1',
      },
      testDb,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('insert into "supplier_quote_attachments"');
    expect(sql).toContain('returning');
    expect(exec.calls[0].params).toEqual([
      'sqa-1',
      'q-1',
      'order.xlsx',
      'abc-123.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      2048,
      'u-1',
    ]);
    expect(result.id).toBe('sqa-1');
  });
});

describe('deleteById', () => {
  test('scopes deletion by attachmentId AND quoteId so cross-quote ids 404 cleanly', async () => {
    exec.enqueue({ rows: [attachmentRow()] });
    const result = await supplierQuoteAttachmentsRepo.deleteById('sqa-1', 'q-1', testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('delete from "supplier_quote_attachments"');
    expect(sql).toContain('"id" = $1');
    expect(sql).toContain('"quote_id" = $2');
    expect(sql).toContain('returning');
    expect(exec.calls[0].params).toEqual(['sqa-1', 'q-1']);
    expect(result?.storedName).toBe('abc-123.xlsx');
  });

  test('returns null when no row deleted (id mismatch or wrong quote)', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuoteAttachmentsRepo.deleteById('missing', 'q-1', testDb)).toBeNull();
  });
});
