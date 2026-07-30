import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { type AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DEMO_USERS } from '../../db/demoSeedManifest.ts';
import * as schema from '../../db/schema/index.ts';
import { computeInvoiceTotals } from '../../utils/invoice-math.ts';
import {
  type ParsedRow,
  parseInsertTargets,
  parseInsertValuesBlocks,
  parseSelectValuesBlocks,
} from './seedSqlParsing.ts';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf8');

const rowsById = (table: string) =>
  new Map(parseInsertValuesBlocks(SEED_SQL, table).map((row) => [row.id, row]));

const clients = rowsById('clients');
const suppliers = rowsById('suppliers');
const products = rowsById('products');
const quotes = rowsById('quotes');
const offers = rowsById('customer_offers');
const sales = rowsById('sales');
const supplierQuotes = rowsById('supplier_quotes');
const supplierSales = rowsById('supplier_sales');
const projects = rowsById('projects');
const tasks = rowsById('tasks');

const nullableId = (value: string | undefined) =>
  value === undefined || value.toUpperCase() === 'NULL' ? null : value;

const expectSameOwner = (
  child: ParsedRow,
  parent: ParsedRow | undefined,
  ownerColumn: 'client_id' | 'supplier_id',
) => {
  if (!parent) throw new Error(`${child.id} references a missing parent`);
  expect(child[ownerColumn], `${child.id} has a different ${ownerColumn}`).toBe(
    parent[ownerColumn],
  );
};

describe('seed.sql stays aligned with the complete Drizzle schema', () => {
  const tableColumns = new Map<string, Set<string>>();
  for (const value of Object.values(schema) as unknown[]) {
    if (!(value instanceof PgTable)) continue;
    tableColumns.set(
      getTableName(value),
      new Set(
        (Object.values(getTableColumns(value)) as AnyPgColumn[]).map((column) => column.name),
      ),
    );
  }

  const insertTargets = parseInsertTargets(SEED_SQL);

  test('discovers the full seed insert surface', () => {
    expect(new Set(insertTargets.map((target) => target.table)).size).toBeGreaterThanOrEqual(35);
  });

  test.each(insertTargets)('$table INSERT only names columns from the live table', ({
    table,
    columns,
  }) => {
    // demo_document_codes is a transaction-local temp table created inside seed.sql.
    if (table === 'demo_document_codes') return;
    const columnsForTable = tableColumns.get(table);
    expect(columnsForTable, `${table} is missing from db/schema/index.ts`).toBeDefined();
    expect(columns.filter((column) => !columnsForTable?.has(column))).toEqual([]);
  });
});

describe('seed.sql commercial document ownership is relationally coherent', () => {
  test('client documents keep the same client throughout each linked chain', () => {
    for (const offer of offers.values()) {
      const quoteId = nullableId(offer.linked_quote_id);
      if (quoteId) expectSameOwner(offer, quotes.get(quoteId), 'client_id');
    }

    for (const sale of sales.values()) {
      const quoteId = nullableId(sale.linked_quote_id);
      const offerId = nullableId(sale.linked_offer_id);
      if (quoteId) expectSameOwner(sale, quotes.get(quoteId), 'client_id');
      if (offerId) expectSameOwner(sale, offers.get(offerId), 'client_id');
    }

    for (const invoice of parseInsertValuesBlocks(SEED_SQL, 'invoices')) {
      const saleId = nullableId(invoice.linked_sale_id);
      if (saleId) expectSameOwner(invoice, sales.get(saleId), 'client_id');
    }

    for (const project of projects.values()) {
      const offerId = nullableId(project.offer_id);
      const saleId = nullableId(project.order_id);
      if (offerId) expectSameOwner(project, offers.get(offerId), 'client_id');
      if (saleId) expectSameOwner(project, sales.get(saleId), 'client_id');
    }
  });

  test('supplier documents keep the same supplier throughout each linked chain', () => {
    for (const sale of supplierSales.values()) {
      const quoteId = nullableId(sale.linked_quote_id);
      if (quoteId) expectSameOwner(sale, supplierQuotes.get(quoteId), 'supplier_id');
    }

    for (const invoice of parseInsertValuesBlocks(SEED_SQL, 'supplier_invoices')) {
      const saleId = nullableId(invoice.linked_sale_id);
      if (saleId) expectSameOwner(invoice, supplierSales.get(saleId), 'supplier_id');
    }
  });

  test('document snapshot names match their referenced master data', () => {
    for (const [table, ownerColumn, nameColumn, owners] of [
      ['quotes', 'client_id', 'client_name', clients],
      ['customer_offers', 'client_id', 'client_name', clients],
      ['sales', 'client_id', 'client_name', clients],
      ['invoices', 'client_id', 'client_name', clients],
      ['supplier_quotes', 'client_id', 'client_name', clients],
      ['supplier_quotes', 'supplier_id', 'supplier_name', suppliers],
      ['supplier_sales', 'supplier_id', 'supplier_name', suppliers],
      ['supplier_invoices', 'supplier_id', 'supplier_name', suppliers],
    ] as const) {
      for (const row of parseInsertValuesBlocks(SEED_SQL, table)) {
        const ownerId = nullableId(row[ownerColumn]);
        if (!ownerId) continue;
        const owner = owners.get(ownerId);
        if (!owner) throw new Error(`${table}.${row.id} references missing ${ownerId}`);
        expect(row[nameColumn], `${table}.${row.id} has a stale ${nameColumn}`).toBe(owner.name);
      }
    }
  });
});

describe('seed.sql invoice totals use the same pricing contract as the application', () => {
  const assertTotals = ({
    documentTable,
    itemTable,
    includeTax,
  }: {
    documentTable: 'invoices' | 'supplier_invoices';
    itemTable: 'invoice_items' | 'supplier_invoice_items';
    includeTax: boolean;
  }) => {
    const items = parseInsertValuesBlocks(SEED_SQL, itemTable);
    for (const document of parseInsertValuesBlocks(SEED_SQL, documentTable)) {
      const documentItems = items
        .filter((item) => item.invoice_id === document.id)
        .map((item) => ({
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          discount: Number(item.discount),
          legacyDiscountRounding: item.legacy_discount_rounding === 'TRUE',
          taxRate: includeTax ? Number(item.tax_rate ?? 0) : 0,
          durationMonths: Number(item.duration_months ?? 1),
          durationUnit: item.duration_unit ?? 'months',
          pricingSemanticsVersion: Number(item.pricing_semantics_version ?? 2) as 1 | 2,
        }));
      expect(documentItems.length, `${documentTable}.${document.id} has no items`).toBeGreaterThan(
        0,
      );

      const calculated = computeInvoiceTotals(documentItems);
      expect(Number(document.subtotal)).toBe(calculated.subtotal);
      expect(Number(document.tax_total ?? 0)).toBe(calculated.taxTotal);
      expect(Number(document.total)).toBe(calculated.total);
      expect(Number(document.amount_paid)).toBeGreaterThanOrEqual(0);
      expect(Number(document.amount_paid)).toBeLessThanOrEqual(calculated.total);
      if (document.status === 'paid') {
        expect(Number(document.amount_paid)).toBe(calculated.total);
      }
    }
  };

  test('client invoices reconcile header totals with their lines', () => {
    assertTotals({
      documentTable: 'invoices',
      itemTable: 'invoice_items',
      includeTax: true,
    });
  });

  test('supplier invoices reconcile header totals with their lines', () => {
    assertTotals({
      documentTable: 'supplier_invoices',
      itemTable: 'supplier_invoice_items',
      includeTax: false,
    });
  });
});

describe('seed.sql time entries derive denormalized identity from their foreign keys', () => {
  const timeEntryBlocks = parseSelectValuesBlocks(SEED_SQL, 'time_entries');
  const timeEntries = timeEntryBlocks.flatMap((block) => block.rows);
  const demoUserIds = new Set<string>(DEMO_USERS.map((user) => user.id));
  const userProjects = new Set(
    parseInsertValuesBlocks(SEED_SQL, 'user_projects').map(
      (row) => `${row.user_id}\0${row.project_id}`,
    ),
  );
  const userTasks = new Set(
    parseInsertValuesBlocks(SEED_SQL, 'user_tasks').map((row) => `${row.user_id}\0${row.task_id}`),
  );

  test('VALUES tuples contain entry facts only; identity and cost come from authoritative joins', () => {
    expect(timeEntryBlocks).toHaveLength(2);
    for (const block of timeEntryBlocks) {
      expect(block.aliasColumns).not.toContain('client_id');
      expect(block.aliasColumns).not.toContain('client_name');
      expect(block.aliasColumns).not.toContain('project_name');
      expect(block.aliasColumns).not.toContain('hourly_cost');
    }
    expect(SEED_SQL.match(/JOIN projects p ON p\.id = v\.project_id/g)).toHaveLength(2);
    expect(SEED_SQL.match(/JOIN clients c ON c\.id = p\.client_id/g)).toHaveLength(2);
    expect(SEED_SQL.match(/FROM user_hourly_cost_periods cost_period/g)).toHaveLength(2);
    expect(SEED_SQL.match(/cost_period\.effective_from DESC NULLS LAST/g)).toHaveLength(2);
    expect(SEED_SQL).not.toContain('UPDATE time_entries te');
  });

  test.each(
    timeEntries,
  )('$id references an assigned project/task and a known demo user', (entry) => {
    const project = projects.get(entry.project_id);
    const task = Array.from(tasks.values()).find(
      (candidate) => candidate.project_id === entry.project_id && candidate.name === entry.task,
    );
    expect(project, `${entry.id} references an unknown project`).toBeDefined();
    expect(task, `${entry.id} references an unknown task`).toBeDefined();
    expect(demoUserIds.has(entry.user_id), `${entry.id} references an unknown user`).toBe(true);
    expect(userProjects.has(`${entry.user_id}\0${entry.project_id}`)).toBe(true);
    expect(userTasks.has(`${entry.user_id}\0${task?.id}`)).toBe(true);
  });

  test('every referenced product and document parent exists', () => {
    for (const [table, parentColumn, parents] of [
      ['quote_items', 'quote_id', quotes],
      ['customer_offer_items', 'offer_id', offers],
      ['sale_items', 'sale_id', sales],
      ['supplier_quote_items', 'quote_id', supplierQuotes],
      ['supplier_sale_items', 'sale_id', supplierSales],
    ] as const) {
      for (const row of parseSelectValuesBlocks(SEED_SQL, table).flatMap((block) => block.rows)) {
        expect(parents.has(row[parentColumn]), `${table}.${row.id} has an unknown parent`).toBe(
          true,
        );
        expect(products.has(row.product_id), `${table}.${row.id} has an unknown product`).toBe(
          true,
        );
      }
    }
  });
});
