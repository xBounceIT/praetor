// Verifies the new transactional safety of `replaceItems` in each repo touched by Unit 5.
//
// Property under test: when `replaceItems(id, items)` is called without a caller-supplied
// `exec`, the DELETE+INSERT pair must run inside a single transaction so a failing INSERT
// rolls back the preceding DELETE.
//
// Strategy: mock `db/drizzle.ts` so the imported `db`, `withDbTransaction`, and
// `runAtomically` are fakes under our control. Repos call `runAtomically(exec, cb)`; our
// fake `runAtomically` mirrors the production logic (`exec === db ? wrap : passthrough`)
// against the fake `db`, exercising the same branch the production code would take.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';

type ItemRow = { id: string };
type TableKey =
  | 'customerOfferItems'
  | 'quoteItems'
  | 'saleItems'
  | 'invoiceItems'
  | 'supplierInvoiceItems'
  | 'supplierSaleItems'
  | 'supplierQuoteItems';
const TABLE_KEYS: readonly TableKey[] = [
  'customerOfferItems',
  'quoteItems',
  'saleItems',
  'invoiceItems',
  'supplierInvoiceItems',
  'supplierSaleItems',
  'supplierQuoteItems',
];

// In-memory tables — one per repo. We don't decode Drizzle filter expressions; tests
// instead seed/assert within a single parent-id and treat DELETE as "clear this table".
const tables: Record<TableKey, ItemRow[]> = {
  customerOfferItems: [],
  quoteItems: [],
  saleItems: [],
  invoiceItems: [],
  supplierInvoiceItems: [],
  supplierSaleItems: [],
  supplierQuoteItems: [],
};

let pending: Record<TableKey, ItemRow[]> | null = null;
let failNextInsert = false;
const tableToKey = new WeakMap<object, TableKey>();

const live = (): Record<TableKey, ItemRow[]> => pending ?? tables;

const cloneTables = (): Record<TableKey, ItemRow[]> => {
  const snap = {} as Record<TableKey, ItemRow[]>;
  for (const k of TABLE_KEYS) snap[k] = tables[k].slice();
  return snap;
};

const fakeDb = {
  delete(table: object) {
    return {
      where: async (_filter: unknown) => {
        const key = tableToKey.get(table);
        if (!key) throw new Error('replaceItems test: unknown delete target');
        live()[key].length = 0;
        return { rowCount: 0 };
      },
    };
  },
  insert(table: object) {
    return {
      values: (rows: Array<Record<string, unknown>>) => ({
        returning: async () => {
          const key = tableToKey.get(table);
          if (!key) throw new Error('replaceItems test: unknown insert target');
          if (failNextInsert) {
            failNextInsert = false;
            throw new Error('forced INSERT failure');
          }
          for (const row of rows) {
            live()[key].push({ id: String(row.id ?? '') });
          }
          return rows.map((row) => ({ ...row }));
        },
      }),
    };
  },
};

// Tx semantics: `pending` is the working snapshot. Successful callback => copy back to
// `tables` (commit). Thrown callback => the catch path is implicit: `pending = null` in
// `finally` runs without the commit copy, so `tables` keeps its pre-tx state. All
// post-test assertions read `tables` (never `live()`), which is why this works.
const fakeWithDbTransaction = async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
  if (pending) return cb(fakeDb);
  pending = cloneTables();
  try {
    const result = await cb(fakeDb);
    for (const k of TABLE_KEYS) tables[k] = pending[k];
    return result;
  } finally {
    pending = null;
  }
};

// Mirrors the production `runAtomically`: wrap in a tx when `exec` is the (fake) default
// `db`, otherwise just call the callback with the caller-supplied executor.
const fakeRunAtomically = <T>(exec: unknown, cb: (tx: unknown) => Promise<T>): Promise<T> =>
  exec === fakeDb ? fakeWithDbTransaction(cb) : cb(exec);

// Snapshot the real drizzle.ts exports BEFORE the mock kicks in so we can fully restore
// them in afterAll - otherwise the mock leaks into every other repo test in the same Bun
// process and breaks unrelated SQL assertions (executeRows path most visibly).
const drizzleSnap = { ...realDrizzle };

mock.module('../../db/drizzle.ts', () => ({
  ...drizzleSnap,
  db: fakeDb,
  withDbTransaction: fakeWithDbTransaction,
  runAtomically: fakeRunAtomically,
}));

let invoicesRepo: typeof import('../../repositories/invoicesRepo.ts');
let clientOffersRepo: typeof import('../../repositories/clientOffersRepo.ts');
let clientQuotesRepo: typeof import('../../repositories/clientQuotesRepo.ts');
let clientsOrdersRepo: typeof import('../../repositories/clientsOrdersRepo.ts');
let supplierInvoicesRepo: typeof import('../../repositories/supplierInvoicesRepo.ts');
let supplierOrdersRepo: typeof import('../../repositories/supplierOrdersRepo.ts');
let supplierQuotesRepo: typeof import('../../repositories/supplierQuotesRepo.ts');

beforeAll(async () => {
  const customerOfferItemsSchema = await import('../../db/schema/customerOfferItems.ts');
  const quotesSchema = await import('../../db/schema/quotes.ts');
  const salesSchema = await import('../../db/schema/sales.ts');
  const invoicesSchema = await import('../../db/schema/invoices.ts');
  const supplierInvoicesSchema = await import('../../db/schema/supplierInvoices.ts');
  const supplierSalesSchema = await import('../../db/schema/supplierSales.ts');
  const supplierQuotesSchema = await import('../../db/schema/supplierQuotes.ts');

  tableToKey.set(
    customerOfferItemsSchema.customerOfferItems as unknown as object,
    'customerOfferItems',
  );
  tableToKey.set(quotesSchema.quoteItems as unknown as object, 'quoteItems');
  tableToKey.set(salesSchema.saleItems as unknown as object, 'saleItems');
  tableToKey.set(invoicesSchema.invoiceItems as unknown as object, 'invoiceItems');
  tableToKey.set(
    supplierInvoicesSchema.supplierInvoiceItems as unknown as object,
    'supplierInvoiceItems',
  );
  tableToKey.set(supplierSalesSchema.supplierSaleItems as unknown as object, 'supplierSaleItems');
  tableToKey.set(
    supplierQuotesSchema.supplierQuoteItems as unknown as object,
    'supplierQuoteItems',
  );

  invoicesRepo = await import('../../repositories/invoicesRepo.ts');
  clientOffersRepo = await import('../../repositories/clientOffersRepo.ts');
  clientQuotesRepo = await import('../../repositories/clientQuotesRepo.ts');
  clientsOrdersRepo = await import('../../repositories/clientsOrdersRepo.ts');
  supplierInvoicesRepo = await import('../../repositories/supplierInvoicesRepo.ts');
  supplierOrdersRepo = await import('../../repositories/supplierOrdersRepo.ts');
  supplierQuotesRepo = await import('../../repositories/supplierQuotesRepo.ts');
});

afterAll(() => {
  // Restore the real drizzle exports so subsequent test files in the same Bun process
  // (e.g. other repo tests) get the real `db` / `withDbTransaction` / `executeRows`.
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

beforeEach(() => {
  for (const k of TABLE_KEYS) tables[k] = [];
  pending = null;
  failNextInsert = false;
});

describe('invoicesRepo.replaceItems', () => {
  // `unitOfMeasure` is the narrow union `"hours" | "unit"` on `NewInvoiceItem`; hoisting
  // out of the array literal would widen the literal to `string`, so pin it with `as const`.
  const newItem = {
    id: 'item-new',
    productId: null,
    description: 'New',
    unitOfMeasure: 'unit' as const,
    quantity: 1,
    unitPrice: 5,
    discount: 0,
    taxRate: 0,
    durationMonths: 1,
  };

  test('failed INSERT leaves prior items intact (DELETE rolled back)', async () => {
    tables.invoiceItems = [{ id: 'item-old-1' }, { id: 'item-old-2' }];
    failNextInsert = true;

    await expect(invoicesRepo.replaceItems('INV-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.invoiceItems.map((i) => i.id)).toEqual(['item-old-1', 'item-old-2']);
  });

  test('successful replace commits new items', async () => {
    tables.invoiceItems = [{ id: 'item-old' }];

    await invoicesRepo.replaceItems('INV-1', [newItem]);

    expect(tables.invoiceItems.map((i) => i.id)).toEqual(['item-new']);
  });
});

describe('clientOffersRepo.replaceItems', () => {
  const newItem = {
    id: 'offer-item-new',
    productId: null,
    productName: 'Product',
    quantity: 1,
    unitPrice: 5,
    productCost: 2,
    productMolPercentage: null,
    discount: 0,
    note: null,
    supplierQuoteId: null,
    supplierQuoteItemId: null,
    supplierQuoteSupplierName: null,
    supplierQuoteUnitPrice: null,
    unitType: 'unit' as const,
    durationMonths: 1,
  };

  test('failed INSERT leaves prior items intact', async () => {
    tables.customerOfferItems = [{ id: 'offer-item-old' }];
    failNextInsert = true;

    await expect(clientOffersRepo.replaceItems('COFFER-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.customerOfferItems.map((i) => i.id)).toEqual(['offer-item-old']);
  });

  test('successful replace commits new items', async () => {
    tables.customerOfferItems = [{ id: 'offer-item-old' }];

    await clientOffersRepo.replaceItems('COFFER-1', [newItem]);

    expect(tables.customerOfferItems.map((i) => i.id)).toEqual(['offer-item-new']);
  });
});

describe('clientQuotesRepo.replaceItems', () => {
  const newItem = {
    id: 'quote-item-new',
    productId: null,
    productName: 'Product',
    quantity: 1,
    unitPrice: 5,
    productCost: 2,
    productMolPercentage: null,
    discount: 0,
    note: null,
    supplierQuoteId: null,
    supplierQuoteItemId: null,
    supplierQuoteSupplierName: null,
    supplierQuoteUnitPrice: null,
    unitType: 'unit' as const,
    durationMonths: 1,
  };

  test('failed INSERT leaves prior items intact', async () => {
    tables.quoteItems = [{ id: 'quote-item-old' }];
    failNextInsert = true;

    await expect(clientQuotesRepo.replaceItems('CQUOTE-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.quoteItems.map((i) => i.id)).toEqual(['quote-item-old']);
  });

  test('successful replace commits new items', async () => {
    tables.quoteItems = [{ id: 'quote-item-old' }];

    await clientQuotesRepo.replaceItems('CQUOTE-1', [newItem]);

    expect(tables.quoteItems.map((i) => i.id)).toEqual(['quote-item-new']);
  });
});

describe('clientsOrdersRepo.replaceItems', () => {
  const newItem = {
    id: 'sale-new',
    productId: 'prod-1',
    productName: 'Product',
    quantity: 1,
    unitPrice: 5,
    productCost: 2,
    productMolPercentage: null,
    discount: 0,
    note: null,
    supplierQuoteId: null,
    supplierQuoteItemId: null,
    supplierQuoteSupplierName: null,
    supplierQuoteUnitPrice: null,
    supplierSaleId: null,
    supplierSaleItemId: null,
    supplierSaleSupplierName: null,
    unitType: 'unit' as const,
    durationMonths: 1,
  };

  test('failed INSERT leaves prior items intact', async () => {
    tables.saleItems = [{ id: 'sale-old' }];
    failNextInsert = true;

    await expect(clientsOrdersRepo.replaceItems('CO-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.saleItems.map((i) => i.id)).toEqual(['sale-old']);
  });

  test('successful replace commits new items', async () => {
    tables.saleItems = [{ id: 'sale-old' }];

    await clientsOrdersRepo.replaceItems('CO-1', [newItem]);

    expect(tables.saleItems.map((i) => i.id)).toEqual(['sale-new']);
  });
});

describe('supplierInvoicesRepo.replaceItems', () => {
  const newItem = {
    id: 'sinv-new',
    productId: null,
    description: 'New',
    quantity: 1,
    unitPrice: 5,
    discount: 0,
  };

  test('failed INSERT leaves prior items intact', async () => {
    tables.supplierInvoiceItems = [{ id: 'sinv-old' }];
    failNextInsert = true;

    await expect(supplierInvoicesRepo.replaceItems('SINV-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.supplierInvoiceItems.map((i) => i.id)).toEqual(['sinv-old']);
  });

  test('successful replace commits new items', async () => {
    tables.supplierInvoiceItems = [{ id: 'sinv-old' }];

    await supplierInvoicesRepo.replaceItems('SINV-1', [newItem]);

    expect(tables.supplierInvoiceItems.map((i) => i.id)).toEqual(['sinv-new']);
  });
});

describe('supplierOrdersRepo.replaceItems', () => {
  const newItem = {
    id: 'ssi-new',
    productId: null,
    productName: 'Product',
    quantity: 1,
    unitPrice: 5,
    discount: 0,
    note: null,
  };

  test('failed INSERT leaves prior items intact', async () => {
    tables.supplierSaleItems = [{ id: 'ssi-old' }];
    failNextInsert = true;

    await expect(supplierOrdersRepo.replaceItems('SO-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.supplierSaleItems.map((i) => i.id)).toEqual(['ssi-old']);
  });

  test('successful replace commits new items', async () => {
    tables.supplierSaleItems = [{ id: 'ssi-old' }];

    await supplierOrdersRepo.replaceItems('SO-1', [newItem]);

    expect(tables.supplierSaleItems.map((i) => i.id)).toEqual(['ssi-new']);
  });
});

describe('supplierQuotesRepo.replaceItems', () => {
  const newItem = {
    id: 'sqi-new',
    productId: null,
    productName: 'Product',
    quantity: 1,
    unitPrice: 5,
    note: null,
    unitType: 'unit',
  };

  test('failed INSERT leaves prior items intact', async () => {
    tables.supplierQuoteItems = [{ id: 'sqi-old' }];
    failNextInsert = true;

    await expect(supplierQuotesRepo.replaceItems('SQ-1', [newItem])).rejects.toThrow(
      'forced INSERT failure',
    );

    expect(tables.supplierQuoteItems.map((i) => i.id)).toEqual(['sqi-old']);
  });

  test('successful replace commits new items', async () => {
    tables.supplierQuoteItems = [{ id: 'sqi-old' }];

    await supplierQuotesRepo.replaceItems('SQ-1', [newItem]);

    expect(tables.supplierQuoteItems.map((i) => i.id)).toEqual(['sqi-new']);
  });
});
