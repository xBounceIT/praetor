import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression: B1. The clients/suppliers → financial-doc FKs must be ON DELETE RESTRICT, not
// CASCADE, so deleting a counterparty cannot silently destroy financial documents. We assert
// this at two levels:
//
//   1. The generated migration SQL (the migration is what the live DB actually runs).
//   2. The committed schema definition file (so a future schema edit reverting back to
//      `onDelete: 'cascade'` fails CI before it ever lands in a fresh migration).
//
// We deliberately read the migration text rather than connect to PG. The route-level tests
// (server/test/routes/clients.test.ts and suppliers.test.ts) cover the runtime 409 path with
// a faked 23503 from the FK.

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const MIGRATION = readFileSync(
  join(SERVER_ROOT, 'db', 'migrations', '0033_restrict_financial_doc_client_supplier_fks.sql'),
  'utf-8',
);

const readSchema = (name: string): string =>
  readFileSync(join(SERVER_ROOT, 'db', 'schema', name), 'utf-8');

const CLIENT_TABLES = [
  { schemaFile: 'invoices.ts', dbTable: 'invoices' },
  { schemaFile: 'customerOffers.ts', dbTable: 'customer_offers' },
  { schemaFile: 'quotes.ts', dbTable: 'quotes' },
  { schemaFile: 'sales.ts', dbTable: 'sales' },
];

const SUPPLIER_TABLES = [
  { schemaFile: 'supplierInvoices.ts', dbTable: 'supplier_invoices' },
  { schemaFile: 'supplierQuotes.ts', dbTable: 'supplier_quotes' },
  { schemaFile: 'supplierSales.ts', dbTable: 'supplier_sales' },
];

describe('migration 0033: financial-doc FKs use ON DELETE RESTRICT', () => {
  test.each(CLIENT_TABLES)('migration installs RESTRICT on $dbTable.client_id → clients(id)', ({
    dbTable,
  }) => {
    const constraint = `${dbTable}_client_id_clients_id_fk`;
    expect(MIGRATION).toContain(constraint);
    // Confirm the ADD CONSTRAINT clause for this FK is RESTRICT (not CASCADE / SET NULL).
    const addPattern = new RegExp(
      `ADD CONSTRAINT "${constraint}"[\\s\\S]*?FOREIGN KEY \\("client_id"\\)[\\s\\S]*?ON DELETE RESTRICT`,
      'i',
    );
    expect(MIGRATION).toMatch(addPattern);
    // And we drop the old (cascade) form before adding the new one.
    expect(MIGRATION).toContain(
      `ALTER TABLE "${dbTable}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
    );
  });

  test.each(
    SUPPLIER_TABLES,
  )('migration installs RESTRICT on $dbTable.supplier_id → suppliers(id)', ({ dbTable }) => {
    const constraint = `${dbTable}_supplier_id_suppliers_id_fk`;
    expect(MIGRATION).toContain(constraint);
    const addPattern = new RegExp(
      `ADD CONSTRAINT "${constraint}"[\\s\\S]*?FOREIGN KEY \\("supplier_id"\\)[\\s\\S]*?ON DELETE RESTRICT`,
      'i',
    );
    expect(MIGRATION).toMatch(addPattern);
  });
});

describe('schema definitions match the migration intent', () => {
  test.each(CLIENT_TABLES)("$schemaFile declares clientId FK with onDelete: 'restrict'", ({
    schemaFile,
  }) => {
    const content = readSchema(schemaFile);
    // Pin the clientId .references(...) options block to onDelete: 'restrict'.
    const referencesPattern =
      /clientId:[\s\S]*?\.references\(\(\) => clients\.id,\s*\{\s*onDelete:\s*'restrict'\s*\}\)/;
    expect(content).toMatch(referencesPattern);
    // Negative: no `onDelete: 'cascade'` survives on the clientId column.
    expect(content).not.toMatch(
      /clientId:[\s\S]*?\.references\(\(\) => clients\.id,\s*\{\s*onDelete:\s*'cascade'/,
    );
  });

  test.each(SUPPLIER_TABLES)("$schemaFile declares supplierId FK with onDelete: 'restrict'", ({
    schemaFile,
  }) => {
    const content = readSchema(schemaFile);
    const referencesPattern =
      /supplierId:[\s\S]*?\.references\(\(\) => suppliers\.id,\s*\{\s*onDelete:\s*'restrict'\s*\}\)/;
    expect(content).toMatch(referencesPattern);
    expect(content).not.toMatch(
      /supplierId:[\s\S]*?\.references\(\(\) => suppliers\.id,\s*\{\s*onDelete:\s*'cascade'/,
    );
  });
});
