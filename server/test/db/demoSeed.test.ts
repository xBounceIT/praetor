import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import {
  assertNoDemoDocumentIdConflicts,
  cleanupDemoNamespace,
  insertCompatibilityDefaults,
  selectDemoUserCleanupIds,
} from '../../db/demoSeed.ts';
import {
  buildDemoIds,
  COMPATIBILITY_DEFAULT_CLIENTS,
  COMPATIBILITY_DEFAULTS,
  DEMO_ASSIGNMENT_TARGET_IDS,
  DEMO_CLIENTS,
  DEMO_CUSTOMER_OFFERS,
  DEMO_EXPECTED_COUNTS,
  DEMO_IDS,
  DEMO_INVOICES,
  DEMO_PRODUCTS,
  DEMO_QUOTES,
  DEMO_SALES,
  DEMO_SUPPLIER_INVOICES,
  DEMO_SUPPLIER_QUOTES,
  DEMO_SUPPLIER_SALES,
  DEMO_TOP_MANAGER_USER_IDS,
  DEMO_USER_CLIENT_ASSIGNMENTS,
  DEMO_USER_PROJECT_ASSIGNMENTS,
  DEMO_USER_TASK_ASSIGNMENTS,
  DEMO_USERS,
  LEGACY_DEMO_INVOICE_IDS,
  LEGACY_DEMO_SUPPLIER_INVOICE_IDS,
} from '../../db/demoSeedManifest.ts';
import {
  DOCUMENT_CODE_MODULES,
  type DocumentCodeModuleId,
  renderDocumentCode,
} from '../../utils/document-codes.ts';
import { parseInsertValuesBlocks } from './seedSqlParsing.ts';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const CONTRACT_TYPES = new Set([
  'permanent',
  'fixed_term',
  'contractor',
  'internship',
  'consultant',
  'other',
]);
const EMPLOYMENT_STATUSES = new Set(['active', 'onboarding', 'on_leave', 'terminated']);
const WORK_LOCATIONS = new Set(['office', 'remote', 'hybrid', 'customer_site', 'other']);

const documentCodesFor = (
  moduleId: DocumentCodeModuleId,
  count: number,
  year = new Date().getFullYear(),
) =>
  Array.from({ length: count }, (_, index) =>
    renderDocumentCode(DOCUMENT_CODE_MODULES[moduleId], {
      year,
      sequence: index + 1,
    }),
  );

type QueryCall = { sql: string; params: unknown[] | undefined };

const buildQueryRecorder = (rowCount = 1, rows: unknown[] = []) => {
  const calls: QueryCall[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rowCount, rows };
    },
  } as unknown as PoolClient;

  return { calls, client };
};

const findDelete = (calls: QueryCall[], table: string) =>
  calls.find((call) => call.sql.startsWith(`DELETE FROM ${table} `));

const findDeleteIndex = (calls: QueryCall[], table: string) =>
  calls.findIndex((call) => call.sql.startsWith(`DELETE FROM ${table} `));

const paramsContainAny = (call: QueryCall | undefined, values: readonly string[]) =>
  call?.params?.some(
    (param) => Array.isArray(param) && values.some((value) => param.includes(value)),
  ) ?? false;

type DemoAssignment = { userId: string; targetId: string };

const sortAssignments = (assignments: readonly DemoAssignment[]) =>
  assignments
    .map((assignment) => `${assignment.userId}:${assignment.targetId}`)
    .sort((a, b) => a.localeCompare(b));

const parsedAssignments = (table: string, targetColumn: string) =>
  sortAssignments(
    parseInsertValuesBlocks(SEED_SQL, table).map((row) => ({
      userId: row.user_id,
      targetId: row[targetColumn] ?? '',
    })),
  );

const insertStatement = (table: string) => {
  const start = SEED_SQL.indexOf(`INSERT INTO ${table} (`);
  if (start === -1) throw new Error(`Missing ${table} insert in seed.sql`);
  const end = SEED_SQL.indexOf(';', start);
  if (end === -1) throw new Error(`Unterminated ${table} insert in seed.sql`);
  return SEED_SQL.slice(start, end + 1);
};

describe('selectDemoUserCleanupIds', () => {
  test('preserves canonical demo users so cascading user data survives demo reseed', () => {
    expect(
      selectDemoUserCleanupIds([{ id: 'u2' }, { id: 'u3' }, { id: 'legacy-manager' }]),
    ).toEqual({
      dependentUserIds: ['u2', 'u3', 'legacy-manager'],
      userIdsToDelete: ['legacy-manager'],
    });
  });
});

describe('insertCompatibilityDefaults', () => {
  test('refreshes existing compatibility rows instead of leaving stale conflicts untouched', async () => {
    const { calls, client } = buildQueryRecorder();

    await insertCompatibilityDefaults(client, {});

    expect(calls).toHaveLength(4);
    expect(calls[0]?.sql).toContain('UPDATE clients');
    expect(calls[0]?.sql).toContain('client_code = NULL');
    expect(calls[0]?.sql).toContain('fiscal_code = NULL');
    expect(calls[0]?.sql).toContain('vat_number = NULL');
    expect(calls[0]?.params).toEqual([[...COMPATIBILITY_DEFAULTS.clients]]);
    expect(calls[1]?.sql).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(calls[1]?.sql).toContain('name = EXCLUDED.name');
    expect(calls[1]?.sql).toContain('is_disabled = FALSE');
    expect(calls[1]?.sql).toContain('ACME-001');
    expect(calls[1]?.sql).toContain('GTECH-001');
    expect(calls[1]?.sql).toContain('contacts = EXCLUDED.contacts');
    expect(calls[1]?.sql).toContain('client_code = EXCLUDED.client_code');
    expect(calls[1]?.sql).toContain('fiscal_code = EXCLUDED.fiscal_code');
    expect(calls[1]?.sql).toContain('address_line = EXCLUDED.address_line');
    expect(calls[2]?.sql).toContain('description = EXCLUDED.description');
    expect(calls[2]?.sql).toContain('tipo_confirmed = EXCLUDED.tipo_confirmed');
    expect(calls[2]?.sql).toMatch(
      /\('p3', 'Internal Research', 'praetor-own-company', [^,]+, NULL, NULL, 'interno', TRUE\)/,
    );
    expect(calls[2]?.sql).toContain('order_id = NULL');
    expect(calls[2]?.sql).toContain('offer_id = NULL');
    expect(calls[2]?.sql).toContain('billing_type = DEFAULT');
    expect(calls[3]?.sql).toContain('project_id = EXCLUDED.project_id');
    expect(calls[3]?.sql).toContain('is_recurring = DEFAULT');
    expect(calls[3]?.sql).toContain('monthly_effort = DEFAULT');
  });
});

describe('cleanupDemoNamespace', () => {
  test('clears preserved demo users from assignment tables before reseeding', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(client, {
      dependentUserIds: ['u2', 'u3', 'legacy-manager'],
      userIdsToDelete: ['legacy-manager'],
    });

    for (const table of ['user_clients', 'user_projects', 'user_tasks']) {
      const call = findDelete(calls, table);
      expect(call?.sql).toContain('user_id = ANY($1::text[])');
      expect(call?.params).toEqual([['u2', 'u3', 'legacy-manager']]);
    }
  });

  test('clears demo-user activity that would survive because canonical users are preserved', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(client, {
      dependentUserIds: ['u2', 'u3'],
      userIdsToDelete: [],
    });

    expect(findDelete(calls, 'time_entries')?.sql).toContain('user_id = ANY($2::text[])');
    expect(findDelete(calls, 'notifications')?.sql).toContain('user_id = ANY($2::text[])');
    expect(findDelete(calls, 'user_work_units')?.sql).toContain('user_id = ANY($2::text[])');
    expect(findDelete(calls, 'work_unit_managers')?.sql).toContain('user_id = ANY($2::text[])');
  });

  test('uses the provided seed year when cleaning default-code documents', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(
      client,
      {
        dependentUserIds: ['u2', 'u3'],
        userIdsToDelete: [],
      },
      2027,
    );

    expect(findDelete(calls, 'quotes')?.params?.[0]).toEqual(
      documentCodesFor('client_quote', 14, 2027),
    );
    expect(findDelete(calls, 'sales')?.params?.[0]).toEqual(
      documentCodesFor('client_order', 5, 2027),
    );
    const cleanupInvoiceIds = [
      ...documentCodesFor('client_invoice', 5, 2027),
      ...LEGACY_DEMO_INVOICE_IDS,
    ];
    const cleanupSupplierInvoiceIds = [
      ...documentCodesFor('supplier_invoice', 5, 2027),
      ...LEGACY_DEMO_SUPPLIER_INVOICE_IDS,
    ];

    expect(findDelete(calls, 'invoice_items')?.params?.[1]).toEqual(cleanupInvoiceIds);
    expect(findDelete(calls, 'invoices')?.params?.[0]).toEqual(cleanupInvoiceIds);
    expect(findDelete(calls, 'supplier_invoice_items')?.params?.[1]).toEqual(
      cleanupSupplierInvoiceIds,
    );
    expect(findDelete(calls, 'supplier_invoices')?.params?.[0]).toEqual(cleanupSupplierInvoiceIds);
  });

  test('cleans compatibility client business-key collisions without deleting their ids', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(
      client,
      {
        dependentUserIds: ['u2', 'u3'],
        userIdsToDelete: [],
      },
      2027,
    );

    const clientDelete = findDelete(calls, 'clients');
    const compatibilityFiscalCodes = COMPATIBILITY_DEFAULT_CLIENTS.map((client) =>
      client.fiscalCode.toLowerCase(),
    );
    const compatibilityClientIds = [...COMPATIBILITY_DEFAULTS.clients];
    const demoFiscalCodes = DEMO_CLIENTS.map((client) => client.fiscalCode.toLowerCase());

    expect(clientDelete?.sql).toContain('id <> ALL');
    expect(clientDelete?.sql).toContain('LOWER(vat_number)');
    expect(clientDelete?.params).toEqual([
      buildDemoIds(2027).clients,
      DEMO_CLIENTS.map((client) => client.clientCode),
      compatibilityClientIds,
      demoFiscalCodes,
      compatibilityClientIds,
      COMPATIBILITY_DEFAULT_CLIENTS.map((client) => client.clientCode),
      compatibilityClientIds,
      compatibilityFiscalCodes,
      compatibilityClientIds,
      compatibilityFiscalCodes,
      compatibilityClientIds,
    ]);
  });

  test('deletes demo-product financial documents at parent level', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(
      client,
      {
        dependentUserIds: ['u2', 'u3'],
        userIdsToDelete: [],
      },
      2027,
    );

    for (const table of [
      'quote_items',
      'customer_offer_items',
      'sale_items',
      'invoice_items',
      'supplier_quote_items',
      'supplier_sale_items',
      'supplier_invoice_items',
    ]) {
      expect(findDelete(calls, table)?.sql).not.toContain('product_id');
    }

    expect(findDelete(calls, 'quotes')?.sql).toContain(
      'id IN (SELECT quote_id FROM quote_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'customer_offers')?.sql).toContain(
      'customer_offer_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'customer_offers')?.sql).toContain(
      'linked_quote_id IN (SELECT quote_id FROM quote_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'sales')?.sql).toContain(
      'sale_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'sales')?.sql).toContain(
      'linked_offer_id IN (SELECT id FROM customer_offers',
    );
    expect(findDelete(calls, 'sales')?.sql).toContain(
      'linked_quote_id IN (SELECT quote_id FROM quote_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'invoices')?.sql).toContain(
      'invoice_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'invoices')?.sql).toContain('linked_sale_id IN (SELECT id FROM sales');

    const resaleDelete = findDelete(calls, 'resales');
    expect(resaleDelete?.sql).toContain('client_order_id = ANY');
    expect(resaleDelete?.sql).toContain('supplier_order_id = ANY');
    expect(resaleDelete?.sql).toContain(
      'client_order_id IN (SELECT id FROM sales WHERE client_id = ANY',
    );
    expect(resaleDelete?.sql).toContain(
      'client_order_id IN (SELECT id FROM sales WHERE linked_offer_id = ANY',
    );
    expect(resaleDelete?.sql).toContain(
      'client_order_id IN (SELECT id FROM sales WHERE linked_quote_id = ANY',
    );
    expect(resaleDelete?.sql).toContain(
      'supplier_order_id IN (SELECT id FROM supplier_sales WHERE supplier_id = ANY',
    );
    expect(resaleDelete?.sql).toContain(
      'supplier_order_id IN (SELECT id FROM supplier_sales WHERE linked_quote_id = ANY',
    );
    expect(resaleDelete?.sql).toContain('client_order_id IN (SELECT id FROM sales');
    expect(resaleDelete?.sql).toContain('sale_items WHERE product_id IN (SELECT id FROM products');
    expect(resaleDelete?.sql).toContain('supplier_order_id IN (SELECT id FROM supplier_sales');
    expect(resaleDelete?.sql).toContain(
      'supplier_sale_items WHERE product_id IN (SELECT id FROM products',
    );
    const resaleDeleteIndex = findDeleteIndex(calls, 'resales');
    expect(resaleDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(resaleDeleteIndex).toBeLessThan(findDeleteIndex(calls, 'sales'));
    expect(resaleDeleteIndex).toBeLessThan(findDeleteIndex(calls, 'supplier_sales'));

    expect(findDelete(calls, 'supplier_quotes')?.sql).toContain(
      'supplier_quote_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'supplier_sales')?.sql).toContain(
      'supplier_sale_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'supplier_sales')?.sql).toContain(
      'linked_quote_id IN (SELECT quote_id FROM supplier_quote_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'supplier_invoices')?.sql).toContain(
      'supplier_invoice_items WHERE product_id IN (SELECT id FROM products',
    );
    expect(findDelete(calls, 'supplier_invoices')?.sql).toContain(
      'linked_sale_id IN (SELECT id FROM supplier_sales',
    );

    const quoteDelete = findDelete(calls, 'quotes');
    expect(paramsContainAny(quoteDelete, buildDemoIds(2027).products)).toBe(true);
    expect(
      paramsContainAny(
        quoteDelete,
        DEMO_PRODUCTS.map((product) => product.productCode),
      ),
    ).toBe(true);
    expect(
      paramsContainAny(
        quoteDelete,
        DEMO_PRODUCTS.map((product) => product.name),
      ),
    ).toBe(true);
    expect(paramsContainAny(quoteDelete, buildDemoIds(2027).suppliers)).toBe(true);
    expect(paramsContainAny(resaleDelete, buildDemoIds(2027).products)).toBe(true);
    expect(
      paramsContainAny(
        resaleDelete,
        DEMO_PRODUCTS.map((product) => product.productCode),
      ),
    ).toBe(true);
    expect(
      paramsContainAny(
        resaleDelete,
        DEMO_PRODUCTS.map((product) => product.name),
      ),
    ).toBe(true);
    expect(paramsContainAny(resaleDelete, buildDemoIds(2027).suppliers)).toBe(true);
  });

  test('does not treat compatibility clients as blanket financial document owners', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(
      client,
      {
        dependentUserIds: ['u2', 'u3'],
        userIdsToDelete: [],
      },
      2027,
    );

    for (const table of ['quotes', 'customer_offers', 'sales', 'invoices', 'resales']) {
      expect(paramsContainAny(findDelete(calls, table), COMPATIBILITY_DEFAULTS.clients)).toBe(
        false,
      );
    }
  });
});

describe('assertNoDemoDocumentIdConflicts', () => {
  test('fails before cleanup can overwrite real documents using default demo codes', async () => {
    const conflictingId = documentCodesFor('client_quote', 1, 2027)[0];
    const { client } = buildQueryRecorder(1, [{ table_name: 'quotes', id: conflictingId }]);

    await expect(assertNoDemoDocumentIdConflicts(client, 2027)).rejects.toThrow(
      `Demo seed document ID collision with non-demo records: quotes:${conflictingId}`,
    );
  });

  test('guards client and supplier invoices that now use default document codes', async () => {
    const { calls, client } = buildQueryRecorder(0);

    await assertNoDemoDocumentIdConflicts(client, 2027);

    expect(calls[0]?.sql).toContain("SELECT 'invoices' AS table_name");
    expect(calls[0]?.sql).toContain("SELECT 'supplier_invoices' AS table_name");
    expect(calls[0]?.sql).toContain('$8::text[] AS client_owner_ids');
    expect(calls[0]?.sql).toContain('$9::text[] AS invoice_client_owner_ids');
    expect(calls[0]?.sql).toContain('$10::text[] AS supplier_owner_ids');
    expect(calls[0]?.sql).toContain('ALL(demo_inputs.client_owner_ids)');
    expect(calls[0]?.sql).toContain('ALL(demo_inputs.invoice_client_owner_ids)');
    expect(calls[0]?.sql).toContain('ALL(demo_inputs.supplier_owner_ids)');
    expect(calls[0]?.params?.[3]).toEqual(documentCodesFor('client_invoice', 5, 2027));
    expect(calls[0]?.params?.[6]).toEqual(documentCodesFor('supplier_invoice', 5, 2027));
    expect(calls[0]?.params?.[8]).toEqual(buildDemoIds(2027).clients);
    expect(calls[0]?.params?.[8]).not.toContain('c1');
    expect(calls[0]?.params?.[8]).not.toContain('c2');
  });

  test('passes when the runtime demo codes are unused by non-demo rows', async () => {
    const { calls, client } = buildQueryRecorder(0);

    await expect(assertNoDemoDocumentIdConflicts(client, 2027)).resolves.toBeUndefined();
    expect(calls[0]?.params?.[0]).toEqual(buildDemoIds(2027).quotes);
  });

  test('allows compatibility demo clients to be cleaned before reseeding', async () => {
    const { calls, client } = buildQueryRecorder(0);

    await assertNoDemoDocumentIdConflicts(client, 2027);

    expect(calls[0]?.params?.[7]).toEqual([
      ...COMPATIBILITY_DEFAULTS.clients,
      ...buildDemoIds(2027).clients,
    ]);
  });
});

describe('demo quote candidates stay in sync with the normalized quote schema', () => {
  test('creates one default candidate per demo quote before inserting quote items', () => {
    const candidateInsert = insertStatement('quote_candidates');

    expect(SEED_SQL.indexOf('INSERT INTO quote_candidates (')).toBeLessThan(
      SEED_SQL.indexOf('INSERT INTO quote_items ('),
    );
    expect(candidateInsert).toContain("'Variante A'");
    expect(candidateInsert).toContain('generate_series(1, 14)');
    expect(candidateInsert).toContain("THEN 'selected'");
    expect(DEMO_EXPECTED_COUNTS.quote_candidates).toBe(DEMO_QUOTES.length);
  });

  test('assigns every demo quote item to its parent default candidate', () => {
    const quoteItemsInsert = insertStatement('quote_items');

    expect(quoteItemsInsert).toMatch(/id,\s+quote_id,\s+candidate_id,/);
    expect(quoteItemsInsert).toMatch(/SELECT\s+v\.id,\s+v\.quote_id,\s+v\.quote_id,/);
    expect(quoteItemsInsert).toContain('candidate_id = EXCLUDED.candidate_id');
  });

  test('links seeded offers to the selected candidate of their quote family', () => {
    const offers = parseInsertValuesBlocks(SEED_SQL, 'customer_offers');

    expect(offers).toHaveLength(DEMO_CUSTOMER_OFFERS.length);
    for (const offer of offers) {
      expect(offer.linked_quote_candidate_id).toBe(offer.linked_quote_id);
    }
  });
});

describe('demoSeedManifest assignment coverage', () => {
  test('seed.sql delegates document collision checks to the app-layer guard', () => {
    expect(SEED_SQL).toContain(
      'Document-code collision protection is handled by server/db/demoSeed.ts before cleanup.',
    );
    expect(SEED_SQL).not.toContain('demo_document_code_conflicts');
    expect(SEED_SQL).not.toContain(
      'Demo seed document code collision with existing non-demo document rows',
    );
    expect(SEED_SQL).not.toMatch(/'Demo seed document code collision[^']*'::integer/);
  });

  test('manifest document IDs use the admin default document code templates', () => {
    expect(DEMO_QUOTES.map((row) => row.id)).toEqual(documentCodesFor('client_quote', 14));
    expect(DEMO_CUSTOMER_OFFERS.map((row) => row.id)).toEqual(documentCodesFor('client_offer', 5));
    expect(DEMO_SUPPLIER_QUOTES.map((row) => row.id)).toEqual(
      documentCodesFor('supplier_quote', 14),
    );
    expect(DEMO_SALES.map((row) => row.id)).toEqual(documentCodesFor('client_order', 5));
    expect(DEMO_SUPPLIER_SALES.map((row) => row.id)).toEqual(documentCodesFor('supplier_order', 5));
    expect(DEMO_INVOICES.map((row) => row.id)).toEqual(documentCodesFor('client_invoice', 5));
    expect(DEMO_SUPPLIER_INVOICES.map((row) => row.id)).toEqual(
      documentCodesFor('supplier_invoice', 5),
    );
  });

  test('seed.sql document rows and counters match the default-code manifest', () => {
    expect(parseInsertValuesBlocks(SEED_SQL, 'quotes').map((row) => row.id)).toEqual(
      DEMO_QUOTES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'customer_offers').map((row) => row.id)).toEqual(
      DEMO_CUSTOMER_OFFERS.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'supplier_quotes').map((row) => row.id)).toEqual(
      DEMO_SUPPLIER_QUOTES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'sales').map((row) => row.id)).toEqual(
      DEMO_SALES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'supplier_sales').map((row) => row.id)).toEqual(
      DEMO_SUPPLIER_SALES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'invoices').map((row) => row.id)).toEqual(
      DEMO_INVOICES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'invoice_items').map((row) => row.invoice_id)).toEqual(
      [
        DEMO_INVOICES[0]?.id,
        DEMO_INVOICES[1]?.id,
        DEMO_INVOICES[2]?.id,
        DEMO_INVOICES[2]?.id,
        DEMO_INVOICES[3]?.id,
        DEMO_INVOICES[4]?.id,
      ],
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'supplier_invoices').map((row) => row.id)).toEqual(
      DEMO_SUPPLIER_INVOICES.map((row) => row.id),
    );
    expect(
      parseInsertValuesBlocks(SEED_SQL, 'supplier_invoice_items').map((row) => row.invoice_id),
    ).toEqual([
      DEMO_SUPPLIER_INVOICES[0]?.id,
      DEMO_SUPPLIER_INVOICES[1]?.id,
      DEMO_SUPPLIER_INVOICES[2]?.id,
      DEMO_SUPPLIER_INVOICES[2]?.id,
      DEMO_SUPPLIER_INVOICES[3]?.id,
      DEMO_SUPPLIER_INVOICES[4]?.id,
    ]);

    const counters = Object.fromEntries(
      parseInsertValuesBlocks(SEED_SQL, 'document_code_counters').map((row) => [
        row.module_id,
        Number(row.next_sequence),
      ]),
    );
    expect(counters).toEqual({
      client_quote: 15,
      client_offer: 6,
      supplier_quote: 15,
      client_order: 6,
      supplier_order: 6,
      client_invoice: 6,
      supplier_invoice: 6,
    });
  });

  test('client commercial documents seed non-empty descriptions from the manifest', () => {
    for (const [table, manifest] of [
      ['quotes', DEMO_QUOTES],
      ['customer_offers', DEMO_CUSTOMER_OFFERS],
      ['sales', DEMO_SALES],
    ] as const) {
      const rows = parseInsertValuesBlocks(SEED_SQL, table);
      expect(rows.map((row) => row.description)).toEqual(
        manifest.map((document) => document.description),
      );
      expect(rows.every((row) => Boolean(row.description?.trim()))).toBe(true);
    }
  });

  test('seed.sql task ids match the compatibility and demo task manifests', () => {
    expect(
      parseInsertValuesBlocks(SEED_SQL, 'tasks')
        .map((row) => row.id)
        .sort(),
    ).toEqual([...COMPATIBILITY_DEFAULTS.tasks, ...DEMO_IDS.tasks].sort());
  });

  test('seed.sql compatibility clients include complete CRM details', () => {
    const compatibilityClientIds = new Set<string>(COMPATIBILITY_DEFAULTS.clients);
    const compatibilityClients = parseInsertValuesBlocks(SEED_SQL, 'clients').filter((row) =>
      compatibilityClientIds.has(row.id),
    );

    expect(compatibilityClients).toHaveLength(COMPATIBILITY_DEFAULTS.clients.length);
    const compatibilityClientKeys = new Map<string, (typeof COMPATIBILITY_DEFAULT_CLIENTS)[number]>(
      COMPATIBILITY_DEFAULT_CLIENTS.map((client) => [client.id, client]),
    );
    for (const client of compatibilityClients) {
      const expected = compatibilityClientKeys.get(client.id);

      if (!expected) throw new Error(`Missing compatibility client manifest row for ${client.id}`);
      expect(client.type).toBe('company');
      expect(client.is_disabled).toBe('FALSE');
      expect(client.contact_name).not.toBe('NULL');
      expect(client.client_code).toBe(expected.clientCode);
      expect(client.email).toMatch(/@.+\.demo$/);
      expect(client.phone).toMatch(/^\+39 /);
      expect(client.address).not.toBe('NULL');
      expect(client.description).not.toBe('NULL');
      expect(client.ateco_code).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
      expect(client.website).toMatch(/^https:\/\//);
      expect(client.sector).not.toBe('NULL');
      expect(client.number_of_employees).not.toBe('NULL');
      expect(client.revenue).not.toBe('NULL');
      expect(client.fiscal_code).toBe(expected.fiscalCode);
      expect(client.vat_number).toBe(expected.fiscalCode);
      expect(client.office_count_range).not.toBe('NULL');
      expect(client.contacts).toContain('fullName');
      expect(client.address_country).not.toBe('NULL');
      expect(client.address_state).not.toBe('NULL');
      expect(client.address_cap).toMatch(/^\d{5}$/);
      expect(client.address_province).toMatch(/^[A-Z]{2}$/);
      expect(client.address_civic_number).not.toBe('NULL');
      expect(client.address_line).not.toBe('NULL');
    }
  });

  test('seed.sql user assignment rows match the demo manifest', () => {
    expect(parsedAssignments('user_clients', 'client_id')).toEqual(
      sortAssignments(DEMO_USER_CLIENT_ASSIGNMENTS),
    );
    expect(parsedAssignments('user_projects', 'project_id')).toEqual(
      sortAssignments(DEMO_USER_PROJECT_ASSIGNMENTS),
    );
    expect(parsedAssignments('user_tasks', 'task_id')).toEqual(
      sortAssignments(DEMO_USER_TASK_ASSIGNMENTS),
    );
  });

  test('assignment verification counts include top-manager refresh rows', () => {
    expect(DEMO_TOP_MANAGER_USER_IDS).toEqual(['u9']);
    expect(DEMO_EXPECTED_COUNTS.user_clients).toBe(
      DEMO_USER_CLIENT_ASSIGNMENTS.length +
        DEMO_TOP_MANAGER_USER_IDS.length * DEMO_ASSIGNMENT_TARGET_IDS.clients.length,
    );
    expect(DEMO_EXPECTED_COUNTS.user_projects).toBe(
      DEMO_USER_PROJECT_ASSIGNMENTS.length +
        DEMO_TOP_MANAGER_USER_IDS.length * DEMO_ASSIGNMENT_TARGET_IDS.projects.length,
    );
    expect(DEMO_EXPECTED_COUNTS.user_tasks).toBe(
      DEMO_USER_TASK_ASSIGNMENTS.length +
        DEMO_TOP_MANAGER_USER_IDS.length * DEMO_ASSIGNMENT_TARGET_IDS.tasks.length,
    );
  });

  test('assignment verification targets include every explicit seed assignment', () => {
    expect(
      DEMO_USER_CLIENT_ASSIGNMENTS.every((assignment) =>
        DEMO_ASSIGNMENT_TARGET_IDS.clients.includes(assignment.targetId),
      ),
    ).toBe(true);
    expect(
      DEMO_USER_PROJECT_ASSIGNMENTS.every((assignment) =>
        DEMO_ASSIGNMENT_TARGET_IDS.projects.includes(assignment.targetId),
      ),
    ).toBe(true);
    expect(
      DEMO_USER_TASK_ASSIGNMENTS.every((assignment) =>
        DEMO_ASSIGNMENT_TARGET_IDS.tasks.includes(assignment.targetId),
      ),
    ).toBe(true);
  });
});

describe('DEMO_USERS HR profiles', () => {
  test('seeded users cover HR screens with complete operational profile data', () => {
    const employeeTypes = new Set(DEMO_USERS.map((user) => user.employeeType));
    expect(employeeTypes).toEqual(new Set(['app_user', 'internal', 'external']));

    const employeeCodes = DEMO_USERS.map((user) => user.employeeCode);
    expect(new Set(employeeCodes).size).toBe(employeeCodes.length);

    for (const user of DEMO_USERS) {
      expect(user.phone).toMatch(/^\+39 /);
      expect(user.jobTitle.trim()).not.toBe('');
      expect(user.department.trim()).not.toBe('');
      expect(user.employeeCode).toMatch(/^(EMP|EXT)-\d{3}$/);
      expect(user.hireDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(CONTRACT_TYPES.has(user.contractType)).toBe(true);
      expect(EMPLOYMENT_STATUSES.has(user.employmentStatus)).toBe(true);
      expect(WORK_LOCATIONS.has(user.workLocation)).toBe(true);
      expect(user.emergencyContactName.trim()).not.toBe('');
      expect(user.emergencyContactPhone).toMatch(/^\+39 /);
      expect(user.notes.trim()).not.toBe('');
      if (user.terminationDate !== null) {
        expect(user.terminationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(user.hireDate <= user.terminationDate).toBe(true);
      }
    }
  });
});
