import { beforeEach, describe, expect, test } from 'bun:test';
import * as supplierOrdersRepo from '../../repositories/supplierOrdersRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawOrderRow = {
  id: 'so-1',
  linkedQuoteId: 'q-1',
  supplierId: 's-1',
  supplierName: 'Acme',
  paymentTerms: 'net30',
  discount: '5',
  discountType: 'percentage',
  status: 'draft',
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const rawItemRow = {
  id: 'ssi-1',
  orderId: 'so-1',
  productId: null,
  productName: 'Widget',
  quantity: '1',
  unitPrice: '10',
  discount: '0',
  note: null,
};

describe('listAll', () => {
  test('orders by created_at DESC and maps numeric fields', async () => {
    exec.enqueue({ rows: [rawOrderRow] });
    const result = await supplierOrdersRepo.listAll(exec);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
    expect(result[0].discount).toBe(5);
    expect(result[0].discountType).toBe('percentage');
  });

  test('coerces unrecognized discountType to "percentage"', async () => {
    exec.enqueue({ rows: [{ ...rawOrderRow, discountType: 'weird' }] });
    const result = await supplierOrdersRepo.listAll(exec);
    expect(result[0].discountType).toBe('percentage');
  });
});

describe('findById', () => {
  test('returns mapped row', async () => {
    exec.enqueue({ rows: [rawOrderRow] });
    const result = await supplierOrdersRepo.findById('so-1', exec);
    expect(result?.id).toBe('so-1');
    expect(result?.discount).toBe(5);
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findById('so-x', exec)).toBeNull();
  });
});

describe('findExistingForUpdate', () => {
  test('returns mapped object with linkedQuoteId', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'so-1',
          linkedQuoteId: 'q-1',
          supplierId: 's-1',
          supplierName: 'Acme',
          status: 'draft',
        },
      ],
    });
    expect(await supplierOrdersRepo.findExistingForUpdate('so-1', exec)).toEqual({
      id: 'so-1',
      linkedQuoteId: 'q-1',
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findExistingForUpdate('so-x', exec)).toBeNull();
  });
});

describe('findLinkedInvoiceId', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [{ id: 'inv-1' }] });
    expect(await supplierOrdersRepo.findLinkedInvoiceId('so-1', exec)).toBe('inv-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findLinkedInvoiceId('so-x', exec)).toBeNull();
  });
});

describe('findStatusAndSupplierName', () => {
  test('uses SQL alias to return supplierName directly', async () => {
    exec.enqueue({ rows: [{ status: 'draft', supplierName: 'Acme' }] });
    expect(await supplierOrdersRepo.findStatusAndSupplierName('so-1', exec)).toEqual({
      status: 'draft',
      supplierName: 'Acme',
    });
    expect(exec.calls[0].sql).toContain('supplier_name as "supplierName"');
  });
});

describe('findIdConflict', () => {
  test('excludes self', async () => {
    exec.enqueue({ rows: [] });
    await supplierOrdersRepo.findIdConflict('new', 'cur', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['new', 'cur']);
  });
});

describe('update', () => {
  test('falls back to SELECT on empty patch', async () => {
    exec.enqueue({ rows: [rawOrderRow] });
    await supplierOrdersRepo.update('so-1', {}, exec);
    expect(exec.calls[0].sql.startsWith('SELECT')).toBe(true);
  });

  test('builds dynamic SET and bumps updated_at', async () => {
    exec.enqueue({ rows: [rawOrderRow] });
    await supplierOrdersRepo.update('so-1', { status: 'sent', discount: 10 }, exec);
    expect(exec.calls[0].sql).toContain('discount = $1');
    expect(exec.calls[0].sql).toContain('status = $2');
    expect(exec.calls[0].sql).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toEqual([10, 'sent', 'so-1']);
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [{ ...rawItemRow, id: 'ssi-a' }] });
    const result = await supplierOrdersRepo.replaceItems(
      'so-1',
      [
        {
          id: 'ssi-a',
          productId: null,
          productName: 'A',
          quantity: 1,
          unitPrice: 5,
          discount: 0,
          note: null,
        },
      ],
      exec,
    );
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM supplier_sale_items');
    expect(exec.calls[1].sql).toContain('INSERT INTO supplier_sale_items');
    expect(exec.calls[1].sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8)');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ssi-a');
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierOrdersRepo.replaceItems('so-1', [], exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await supplierOrdersRepo.deleteById('so-1', exec)).toBe(true);
  });

  test('returns false when no row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await supplierOrdersRepo.deleteById('so-x', exec)).toBe(false);
  });
});
