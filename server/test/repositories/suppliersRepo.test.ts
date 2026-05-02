import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as suppliersRepo from '../../repositories/suppliersRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the column-declaration order from db/schema/suppliers.ts.
//
// Order: id, name, is_disabled, supplier_code, contact_name, email, phone, address,
//        vat_number, tax_code, payment_terms, notes, created_at
const SUPPLIER_ROW: readonly unknown[] = [
  's-1',
  'Acme Co',
  false,
  'ACM',
  'Jane',
  'jane@acme.test',
  '555',
  '1 Main',
  'IT123',
  'TC1',
  'net30',
  'preferred',
  new Date('2026-04-30T12:00:00Z'),
];

const mappedRow = {
  id: 's-1',
  name: 'Acme Co',
  isDisabled: false,
  supplierCode: 'ACM',
  contactName: 'Jane',
  email: 'jane@acme.test',
  phone: '555',
  address: '1 Main',
  vatNumber: 'IT123',
  taxCode: 'TC1',
  paymentTerms: 'net30',
  notes: 'preferred',
  createdAt: new Date('2026-04-30T12:00:00Z').getTime(),
};

describe('listAll', () => {
  test('returns mapped rows ordered by name', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    expect(await suppliersRepo.listAll(testDb)).toEqual([mappedRow]);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by');
    expect(exec.calls[0].sql).toContain('"name"');
  });

  test('createdAt is undefined when DB has null timestamp', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW, { 12: null })] });
    const result = await suppliersRepo.listAll(testDb);
    expect(result[0].createdAt).toBeUndefined();
  });

  test('isDisabled coerces null to false', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW, { 2: null })] });
    const result = await suppliersRepo.listAll(testDb);
    expect(result[0].isDisabled).toBe(false);
  });
});

describe('findById', () => {
  test('returns mapped row when found', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    expect(await suppliersRepo.findById('s-1', testDb)).toEqual(mappedRow);
    expect(exec.calls[0].params).toContain('s-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await suppliersRepo.findById('s-x', testDb)).toBeNull();
  });
});

describe('findNameById', () => {
  test('returns the name when row exists', async () => {
    exec.enqueue({ rows: [['Acme Co']] });
    expect(await suppliersRepo.findNameById('s-1', testDb)).toBe('Acme Co');
    expect(exec.calls[0].params).toContain('s-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await suppliersRepo.findNameById('s-x', testDb)).toBeNull();
  });
});

describe('create', () => {
  test('forces is_disabled false and converts createdAt millis to a Date', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    const now = 1735689600000;
    await suppliersRepo.create(
      {
        id: 's-1',
        name: 'Acme Co',
        supplierCode: 'ACM',
        contactName: 'Jane',
        email: 'jane@acme.test',
        phone: '555',
        address: '1 Main',
        vatNumber: 'IT123',
        taxCode: 'TC1',
        paymentTerms: 'net30',
        notes: 'preferred',
        createdAt: now,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "suppliers"');
    expect(exec.calls[0].params).toContain(false);
    // Drizzle serializes timestamp Date values to ISO strings before passing to the pg driver.
    expect(exec.calls[0].params).toContain(new Date(now).toISOString());
  });

  test('returns mapped row from RETURNING', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    const result = await suppliersRepo.create(
      {
        id: 's-1',
        name: 'Acme Co',
        supplierCode: null,
        contactName: null,
        email: null,
        phone: null,
        address: null,
        vatNumber: null,
        taxCode: null,
        paymentTerms: null,
        notes: null,
        createdAt: Date.now(),
      },
      testDb,
    );
    expect(result).toEqual(mappedRow);
  });
});

describe('update', () => {
  test('omits unchanged fields and emits dynamic SET', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    await suppliersRepo.update('s-1', { name: 'New Name', isDisabled: true }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "suppliers"');
    // Match `"col" = $N` to scope the assertion to the SET clause; RETURNING also lists
    // every column by name and would false-positive a bare-name check.
    expect(sql).toContain('"name" = $1');
    expect(sql).toContain('"is_disabled" = $2');
    expect(sql).not.toMatch(/"email"\s*=\s*\$/);
    expect(exec.calls[0].params).toContain('New Name');
    expect(exec.calls[0].params).toContain(true);
    expect(exec.calls[0].params).toContain('s-1');
  });

  test('falls back to SELECT when patch is empty', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    await suppliersRepo.update('s-1', {}, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('select');
    expect(sql).not.toContain('update');
    expect(exec.calls[0].params).toContain('s-1');
  });

  test('returns null when no row matches', async () => {
    exec.enqueue({ rows: [] });
    const result = await suppliersRepo.update('s-x', { name: 'Z' }, testDb);
    expect(result).toBeNull();
  });

  test('writes null when patch field is explicitly null', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });
    await suppliersRepo.update('s-1', { paymentTerms: null }, testDb);
    expect(exec.calls[0].sql).toContain('"payment_terms"');
    expect(exec.calls[0].params).toContain(null);
    expect(exec.calls[0].params).toContain('s-1');
  });
});

describe('deleteById', () => {
  test('returns name and supplierCode when row is deleted', async () => {
    exec.enqueue({ rows: [['Acme Co', 'ACM']] });
    expect(await suppliersRepo.deleteById('s-1', testDb)).toEqual({
      name: 'Acme Co',
      supplierCode: 'ACM',
    });
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('delete from "suppliers"');
    expect(sql).toContain('returning');
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await suppliersRepo.deleteById('s-x', testDb)).toBeNull();
  });
});
