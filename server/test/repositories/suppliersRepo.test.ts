import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as suppliersRepo from '../../repositories/suppliersRepo.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the column-declaration order from db/schema/suppliers.ts.
//
// Order: id, name, is_disabled, supplier_code, contact_name, email, phone, contacts,
//        address, vat_number, tax_code, payment_terms, notes, created_at
const SUPPLIER_ROW: readonly unknown[] = [
  's-1',
  'Acme Co',
  false,
  'ACM',
  'Jane',
  'jane@acme.test',
  '555',
  [{ fullName: 'Jane', role: 'Buyer', email: 'jane@acme.test', phone: '555' }],
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
  contacts: [{ fullName: 'Jane', role: 'Buyer', email: 'jane@acme.test', phone: '555' }],
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
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW, { 13: null })] });
    const result = await suppliersRepo.listAll(testDb);
    expect(result[0].createdAt).toBeUndefined();
  });

  test('isDisabled coerces null to false', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW, { 2: null })] });
    const result = await suppliersRepo.listAll(testDb);
    expect(result[0].isDisabled).toBe(false);
  });
  test('sanitizes contacts and treats the primary contact as authoritative for legacy aliases', async () => {
    exec.enqueue({
      rows: [
        makeRow(SUPPLIER_ROW, {
          4: 'Stale legacy name',
          5: 'stale@example.test',
          6: '999',
          7: [
            { name: ' Alice ', role: ' Buyer ', email: ' alice@example.test ', phone: ' 123 ' },
            { fullName: '   ', email: 'ignored@example.test' },
            null,
          ],
        }),
      ],
    });

    const [result] = await suppliersRepo.listAll(testDb);
    expect(result.contacts).toEqual([
      {
        fullName: 'Alice',
        role: 'Buyer',
        email: 'alice@example.test',
        phone: '123',
      },
    ]);
    expect(result.contactName).toBe('Alice');
    expect(result.email).toBe('alice@example.test');
    expect(result.phone).toBe('123');
  });

  test('preserves unnamed legacy aliases when the contacts array is empty', async () => {
    exec.enqueue({
      rows: [makeRow(SUPPLIER_ROW, { 4: null, 5: 'legacy@example.test', 6: '555', 7: [] })],
    });

    const [result] = await suppliersRepo.listAll(testDb);
    expect(result.contacts).toEqual([]);
    expect(result.contactName).toBeNull();
    expect(result.email).toBe('legacy@example.test');
    expect(result.phone).toBe('555');
  });
});

describe('listOptions', () => {
  test('selects only selector fields ordered by name', async () => {
    exec.enqueue({ rows: [['s-1', 'Acme Co', false]] });

    expect(await suppliersRepo.listOptions(testDb)).toEqual([
      { id: 's-1', name: 'Acme Co', isDisabled: false },
    ]);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by');
    expect(exec.calls[0].sql).toContain('"id"');
    expect(exec.calls[0].sql).toContain('"name"');
    expect(exec.calls[0].sql).toContain('"is_disabled"');
    expect(exec.calls[0].sql).not.toContain('"vat_number"');
    expect(exec.calls[0].sql).not.toContain('"contacts"');
  });

  test('coerces a null disabled flag to false', async () => {
    exec.enqueue({ rows: [['s-1', 'Acme Co', null]] });

    expect(await suppliersRepo.listOptions(testDb)).toEqual([
      { id: 's-1', name: 'Acme Co', isDisabled: false },
    ]);
  });

  test('applies an optional query limit', async () => {
    exec.enqueue({ rows: [['s-1', 'Acme Co', false]] });

    await suppliersRepo.listOptions(testDb, 200);

    expect(exec.calls[0].sql.toLowerCase()).toContain('limit');
    expect(exec.calls[0].params).toContain(200);
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

describe('findExistingCodes', () => {
  test('normalizes requested and returned codes case-insensitively', async () => {
    exec.enqueue({ rows: [['SUP-ONE'], ['sup-two']] });

    expect(
      await suppliersRepo.findExistingCodes([' Sup-One ', 'SUP-TWO', 'sup-one'], testDb),
    ).toEqual(new Set(['sup-one', 'sup-two']));
    expect(exec.calls[0].sql.toLowerCase()).toContain('lower("suppliers"."supplier_code")');
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['sup-one', 'sup-two']));
  });

  test('does not query when no usable code is provided', async () => {
    expect(await suppliersRepo.findExistingCodes(['', '   '], testDb)).toEqual(new Set());
    expect(exec.calls).toHaveLength(0);
  });

  test('excludes the current supplier id when checking updates', async () => {
    exec.enqueue({ rows: [] });

    expect(await suppliersRepo.findExistingCodes(['ACM'], testDb, 's-1')).toEqual(new Set());
    expect(exec.calls[0].sql.toLowerCase()).toContain('"id"');
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['acm', 's-1']));
  });
});

describe('isSupplierCodeUniqueViolation', () => {
  test('recognizes the supplier-code unique index', () => {
    expect(
      suppliersRepo.isSupplierCodeUniqueViolation(
        makeDbError('23505', 'idx_suppliers_supplier_code_unique'),
      ),
    ).toBe(true);
  });

  test('returns false for unrelated unique violations', () => {
    expect(
      suppliersRepo.isSupplierCodeUniqueViolation(makeDbError('23505', 'suppliers_pkey')),
    ).toBe(false);
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
        contacts: [{ fullName: 'Jane' }],
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
        contacts: [],
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

describe('createIfCodeAvailable', () => {
  const input: suppliersRepo.NewSupplier = {
    id: 's-1',
    name: 'Acme Co',
    supplierCode: 'ACM',
    contactName: null,
    contacts: [],
    email: null,
    phone: null,
    address: null,
    vatNumber: 'IT123',
    taxCode: null,
    paymentTerms: null,
    notes: null,
    createdAt: Date.now(),
  };

  test('locks and rechecks a normalized code before inserting', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });

    expect(await suppliersRepo.createIfCodeAvailable(input, testDb)).toEqual(mappedRow);
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(exec.calls[0].params).toContain('acm');
    expect(exec.calls[1].sql.toLowerCase()).toContain('lower("suppliers"."supplier_code")');
    expect(exec.calls[2].sql.toLowerCase()).toContain('insert into "suppliers"');
  });

  test('returns null without inserting when the locked code already exists', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['ACM']] });

    expect(await suppliersRepo.createIfCodeAvailable(input, testDb)).toBeNull();
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls.some((call) => call.sql.toLowerCase().includes('insert into'))).toBe(false);
  });

  test('returns null when insert races into the unique index', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue(() => {
      throw makeDbError('23505', 'idx_suppliers_supplier_code_unique');
    });

    expect(await suppliersRepo.createIfCodeAvailable(input, testDb)).toBeNull();
    expect(exec.calls[2].sql.toLowerCase()).toContain('insert into "suppliers"');
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

describe('updateIfCodeAvailable', () => {
  test('delegates patches that do not change supplierCode', async () => {
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });

    expect(await suppliersRepo.updateIfCodeAvailable('s-1', { name: 'New Name' }, testDb)).toEqual({
      ok: true,
      supplier: mappedRow,
    });
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "suppliers"');
    expect(exec.calls[0].sql).not.toContain('pg_advisory_xact_lock');
  });

  test('locks and rechecks a normalized code before updating', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [makeRow(SUPPLIER_ROW)] });

    expect(
      await suppliersRepo.updateIfCodeAvailable('s-1', { supplierCode: 'Acm' }, testDb),
    ).toEqual({ ok: true, supplier: mappedRow });
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(exec.calls[0].params).toContain('acm');
    expect(exec.calls[1].sql.toLowerCase()).toContain('lower("suppliers"."supplier_code")');
    expect(exec.calls[1].params).toEqual(expect.arrayContaining(['acm', 's-1']));
    expect(exec.calls[2].sql.toLowerCase()).toContain('update "suppliers"');
  });

  test('returns duplicate_code without updating when another supplier owns the code', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['ACM']] });

    expect(
      await suppliersRepo.updateIfCodeAvailable('s-2', { supplierCode: 'acm' }, testDb),
    ).toEqual({ ok: false, reason: 'duplicate_code' });
    expect(exec.calls.some((call) => call.sql.toLowerCase().includes('update "suppliers"'))).toBe(
      false,
    );
  });

  test('returns duplicate_code when update races into the unique index', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue(() => {
      throw makeDbError('23505', 'idx_suppliers_supplier_code_unique');
    });

    expect(
      await suppliersRepo.updateIfCodeAvailable('s-1', { supplierCode: 'NEW' }, testDb),
    ).toEqual({ ok: false, reason: 'duplicate_code' });
  });

  test('returns not_found when the supplier row is missing', async () => {
    exec.enqueue({ rows: [] });

    expect(await suppliersRepo.updateIfCodeAvailable('s-x', { name: 'Gone' }, testDb)).toEqual({
      ok: false,
      reason: 'not_found',
    });
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
