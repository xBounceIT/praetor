import { beforeEach, describe, expect, test } from 'bun:test';
import * as suppliersRepo from '../../repositories/suppliersRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawRow = {
  id: 's-1',
  name: 'Acme Co',
  is_disabled: false,
  supplier_code: 'ACM',
  contact_name: 'Jane',
  email: 'jane@acme.test',
  phone: '555',
  address: '1 Main',
  vat_number: 'IT123',
  tax_code: 'TC1',
  payment_terms: 'net30',
  notes: 'preferred',
  created_at: new Date('2026-04-30T12:00:00Z'),
};

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
    exec.enqueue({ rows: [rawRow] });
    expect(await suppliersRepo.listAll(exec)).toEqual([mappedRow]);
    expect(exec.calls[0].sql).toContain('ORDER BY name');
  });

  test('createdAt is undefined when DB has null timestamp', async () => {
    exec.enqueue({ rows: [{ ...rawRow, created_at: null }] });
    const result = await suppliersRepo.listAll(exec);
    expect(result[0].createdAt).toBeUndefined();
  });
});

describe('findById', () => {
  test('returns mapped row when found', async () => {
    exec.enqueue({ rows: [rawRow] });
    expect(await suppliersRepo.findById('s-1', exec)).toEqual(mappedRow);
    expect(exec.calls[0].params).toEqual(['s-1']);
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await suppliersRepo.findById('s-x', exec)).toBeNull();
  });
});

describe('create', () => {
  test('passes createdAt through to_timestamp scaling and forces is_disabled false', async () => {
    exec.enqueue({ rows: [rawRow] });
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('to_timestamp($13 / 1000.0)');
    expect(exec.calls[0].params[2]).toBe(false);
    expect(exec.calls[0].params[12]).toBe(now);
  });

  test('returns mapped row from RETURNING', async () => {
    exec.enqueue({ rows: [rawRow] });
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
      exec,
    );
    expect(result).toEqual(mappedRow);
  });
});

describe('update', () => {
  test('omits unchanged fields and emits dynamic SET', async () => {
    exec.enqueue({ rows: [rawRow] });
    await suppliersRepo.update('s-1', { name: 'New Name', isDisabled: true }, exec);
    expect(exec.calls[0].sql).toContain('UPDATE suppliers SET name = $1, is_disabled = $2');
    expect(exec.calls[0].sql).not.toContain('email = $');
    expect(exec.calls[0].params).toEqual(['New Name', true, 's-1']);
  });

  test('falls back to SELECT when patch is empty', async () => {
    exec.enqueue({ rows: [rawRow] });
    await suppliersRepo.update('s-1', {}, exec);
    expect(exec.calls[0].sql).toContain('SELECT');
    expect(exec.calls[0].sql).not.toContain('UPDATE');
    expect(exec.calls[0].params).toEqual(['s-1']);
  });

  test('returns null when no row matches', async () => {
    exec.enqueue({ rows: [] });
    const result = await suppliersRepo.update('s-x', { name: 'Z' }, exec);
    expect(result).toBeNull();
  });

  test('writes null when patch field is explicitly null', async () => {
    exec.enqueue({ rows: [rawRow] });
    await suppliersRepo.update('s-1', { paymentTerms: null }, exec);
    expect(exec.calls[0].sql).toContain('payment_terms = $1');
    expect(exec.calls[0].params).toEqual([null, 's-1']);
  });
});

describe('deleteById', () => {
  test('returns name and supplierCode when row is deleted', async () => {
    exec.enqueue({ rows: [{ name: 'Acme Co', supplier_code: 'ACM' }] });
    expect(await suppliersRepo.deleteById('s-1', exec)).toEqual({
      name: 'Acme Co',
      supplierCode: 'ACM',
    });
    expect(exec.calls[0].sql).toContain('DELETE FROM suppliers');
    expect(exec.calls[0].sql).toContain('RETURNING name, supplier_code');
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await suppliersRepo.deleteById('s-x', exec)).toBeNull();
  });
});
