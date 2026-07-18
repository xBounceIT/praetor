import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'fs';
import type { PoolClient } from 'pg';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { ensureBootstrapAdmin } from './bootstrapAdmin.ts';
import {
  buildDemoAssignmentTargetIds,
  buildDemoIds,
  COMPATIBILITY_DEFAULT_CLIENTS,
  COMPATIBILITY_DEFAULTS,
  DEMO_CLIENTS,
  DEMO_EXPECTED_COUNTS,
  DEMO_FIRST_LOGIN_AT,
  DEMO_ITEM_IDS,
  DEMO_NOTIFICATIONS,
  DEMO_PASSWORD_HASH,
  DEMO_PRODUCTS,
  DEMO_PROJECTS,
  DEMO_SUPPLIERS,
  DEMO_TOP_MANAGER_USER_IDS,
  DEMO_USER_IDS,
  DEMO_USERS,
  DEMO_WORK_UNITS,
  getDemoSeedYear,
  LEGACY_DEMO_INVOICE_IDS,
  LEGACY_DEMO_SUPPLIER_INVOICE_IDS,
} from './demoSeedManifest.ts';
import { type DbExecutor, schema } from './drizzle.ts';
import pool from './index.ts';

const logger = createChildLogger({ module: 'db:demo-seed' });

const DEMO_SEED_MARKER = '-- Refreshable demo dataset.';
const seedPath = new URL('./seed.sql', import.meta.url);

type DemoSeedSource = 'startup' | 'manual';

type FailedStatement = {
  table: string;
  keys: string[];
  statementIndex: number;
  error: Record<string, unknown>;
};

export type DemoSeedResult = {
  demoSeedingEnabled: true;
  source: DemoSeedSource;
  cleanupCountsByTable: Record<string, number>;
  insertCountsByTable: Record<string, number>;
  verificationCountsByTable: Record<string, number>;
};

type PredicateValues = Array<string | null>;

type PredicateBuilder = {
  params: PredicateValues[];
  parts: string[];
};

type VerificationStep = {
  table: string;
  countColumn?: string;
  ids: readonly string[];
  userIds?: readonly string[];
  expected: number;
};

type DemoUserCleanupIds = {
  dependentUserIds: string[];
  userIdsToDelete: string[];
};

type RuntimeDemoIds = ReturnType<typeof buildDemoIds>;
type RuntimeDemoAssignmentTargetIds = ReturnType<typeof buildDemoAssignmentTargetIds>;

const incrementCount = (counts: Record<string, number>, table: string, delta: number) => {
  if (delta <= 0) return;
  counts[table] = (counts[table] ?? 0) + delta;
};

const splitSqlStatements = (sql: string) =>
  sql
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && /\S/m.test(statement.replace(/--.*$/gm, '')));

const extractInsertTable = (statement: string) => {
  const match = statement.match(/INSERT\s+INTO\s+([a-z_]+)/i);
  return match ? match[1] : 'unknown';
};

const extractStatementKeys = (statement: string) =>
  Array.from(statement.matchAll(/'(dm_[^']+|DM-[A-Z0-9-]+|OBS-RENEW-2026)'/g))
    .map((match) => match[1])
    .slice(0, 6);

const buildDeleteQuery = (table: string, build: (builder: PredicateBuilder) => void) => {
  const builder: PredicateBuilder = { params: [], parts: [] };
  build(builder);
  if (builder.parts.length === 0) return null;

  return {
    sql: `DELETE FROM ${table} WHERE ${builder.parts.join(' OR ')}`,
    params: builder.params,
  };
};

const pushTextArrayPredicate = (
  builder: PredicateBuilder,
  expression: string,
  values: readonly string[],
) => {
  if (values.length === 0) return;
  builder.params.push([...values]);
  builder.parts.push(`${expression} = ANY($${builder.params.length}::text[])`);
};

const pushTextArrayPredicateExcludingIds = (
  builder: PredicateBuilder,
  expression: string,
  values: readonly string[],
  excludedIds: readonly string[],
) => {
  if (values.length === 0) return;
  if (excludedIds.length === 0) {
    pushTextArrayPredicate(builder, expression, values);
    return;
  }
  builder.params.push([...values]);
  const valuesParam = builder.params.length;
  builder.params.push([...excludedIds]);
  const excludedIdsParam = builder.params.length;
  builder.parts.push(
    `(${expression} = ANY($${valuesParam}::text[]) AND id <> ALL($${excludedIdsParam}::text[]))`,
  );
};

const pushLowerTextArrayPredicateExcludingIds = (
  builder: PredicateBuilder,
  column: string,
  values: readonly string[],
  excludedIds: readonly string[],
) => {
  pushTextArrayPredicateExcludingIds(
    builder,
    `LOWER(${column})`,
    values.map((value) => value.toLowerCase()),
    excludedIds,
  );
};

const pushTextArraySqlPredicate = (
  builder: PredicateBuilder,
  values: readonly string[],
  renderPredicate: (valuesParam: string) => string,
) => {
  if (values.length === 0) return;
  builder.params.push([...values]);
  builder.parts.push(renderPredicate(`$${builder.params.length}::text[]`));
};

const demoProductIdsQuery = (
  productIdsParam: string,
  productCodesParam: string,
  productNamesParam: string,
  supplierIdsParam: string,
) => `SELECT id FROM products
      WHERE id = ANY(${productIdsParam})
         OR product_code = ANY(${productCodesParam})
         OR name = ANY(${productNamesParam})
         OR supplier_id = ANY(${supplierIdsParam})`;

const pushDemoProductSqlPredicate = (
  builder: PredicateBuilder,
  demoIds: RuntimeDemoIds,
  renderPredicate: (demoProductIds: string) => string,
) => {
  builder.params.push([...demoIds.products]);
  const productIdsParam = `$${builder.params.length}::text[]`;
  builder.params.push(DEMO_PRODUCTS.map((product) => product.productCode));
  const productCodesParam = `$${builder.params.length}::text[]`;
  builder.params.push(DEMO_PRODUCTS.map((product) => product.name));
  const productNamesParam = `$${builder.params.length}::text[]`;
  builder.params.push([...demoIds.suppliers]);
  const supplierIdsParam = `$${builder.params.length}::text[]`;
  builder.parts.push(
    renderPredicate(
      demoProductIdsQuery(productIdsParam, productCodesParam, productNamesParam, supplierIdsParam),
    ),
  );
};

const parentIdsWithDemoProductLines = (
  itemTable: string,
  parentIdColumn: string,
  demoProductIds: string,
) => `SELECT ${parentIdColumn} FROM ${itemTable} WHERE product_id IN (${demoProductIds})`;

const quoteIdsWithDemoProductLines = (demoProductIds: string) =>
  parentIdsWithDemoProductLines('quote_items', 'quote_id', demoProductIds);

const customerOfferIdsWithDemoProductLines = (demoProductIds: string) =>
  `SELECT id FROM customer_offers
   WHERE id IN (${parentIdsWithDemoProductLines(
     'customer_offer_items',
     'offer_id',
     demoProductIds,
   )})
      OR linked_quote_id IN (${quoteIdsWithDemoProductLines(demoProductIds)})`;

const clientSaleIdsWithDemoProductLines = (demoProductIds: string) =>
  `SELECT id FROM sales
   WHERE id IN (${parentIdsWithDemoProductLines('sale_items', 'sale_id', demoProductIds)})
      OR linked_offer_id IN (${customerOfferIdsWithDemoProductLines(demoProductIds)})
      OR linked_quote_id IN (${quoteIdsWithDemoProductLines(demoProductIds)})`;

const supplierQuoteIdsWithDemoProductLines = (demoProductIds: string) =>
  parentIdsWithDemoProductLines('supplier_quote_items', 'quote_id', demoProductIds);

const supplierSaleIdsWithDemoProductLines = (demoProductIds: string) =>
  `SELECT id FROM supplier_sales
   WHERE id IN (${parentIdsWithDemoProductLines('supplier_sale_items', 'sale_id', demoProductIds)})
      OR linked_quote_id IN (${supplierQuoteIdsWithDemoProductLines(demoProductIds)})`;

const clientSaleIdsForOwner = (ownerIdsParam: string) =>
  `SELECT id FROM sales WHERE client_id = ANY(${ownerIdsParam})`;

const supplierSaleIdsForOwner = (ownerIdsParam: string) =>
  `SELECT id FROM supplier_sales WHERE supplier_id = ANY(${ownerIdsParam})`;

const executeDelete = async (
  client: PoolClient,
  table: string,
  build: (builder: PredicateBuilder) => void,
) => {
  const deleteQuery = buildDeleteQuery(table, build);
  if (!deleteQuery) return 0;
  const result = await client.query(deleteQuery.sql, deleteQuery.params);
  return result.rowCount ?? 0;
};

const executeStatement = async (client: PoolClient, sql: string, params?: unknown[]) =>
  client.query(sql, params);

const setDemoSeedYear = async (client: PoolClient, seedYear: number) => {
  await executeStatement(client, "SELECT set_config('praetor.demo_seed_year', $1, true)", [
    String(seedYear),
  ]);
};

const loadDemoStatements = () => {
  const seedSql = readFileSync(seedPath, 'utf8');
  const markerIndex = seedSql.indexOf(DEMO_SEED_MARKER);
  if (markerIndex === -1) {
    throw new Error(`Demo seed marker not found in ${seedPath.pathname}`);
  }
  return splitSqlStatements(seedSql.slice(markerIndex));
};

export const insertCompatibilityDefaults = async (
  client: PoolClient,
  counts: Record<string, number>,
) => {
  await executeStatement(
    client,
    `UPDATE clients
     SET
       client_code = NULL,
       fiscal_code = NULL,
       vat_number = NULL,
       tax_code = NULL
     WHERE id = ANY($1::text[])`,
    [[...COMPATIBILITY_DEFAULTS.clients]],
  );

  const clientsResult = await executeStatement(
    client,
    `INSERT INTO clients (
       id,
       name,
       is_disabled,
       created_at,
       type,
       contact_name,
       client_code,
       email,
       phone,
       address,
       description,
       ateco_code,
       website,
       sector,
       number_of_employees,
       revenue,
       fiscal_code,
       vat_number,
       tax_code,
       office_count_range,
       contacts,
       address_country,
       address_state,
       address_cap,
       address_province,
       address_civic_number,
       address_line
     ) VALUES
        (
          'c1',
          'Acme Corp',
          FALSE,
          '2024-01-15 09:30:00',
          'company',
          'Marta Colombo',
          'ACME-001',
          'operations@acme-corp.demo',
          '+39 02 5550 6101',
          'Via Dante 7, 20121 Milano (MI), Italia',
          'Compatibility client used by the legacy Website Redesign and Mobile App demo projects.',
          '62.01.00',
          'https://acme-corp.demo',
          'SERVICES',
          '50..250',
          '11..50',
          'IT20000000001',
          'IT20000000001',
          NULL,
          '2...5',
          '[{"fullName":"Marta Colombo","role":"Operations Manager","email":"operations@acme-corp.demo","phone":"+39 02 5550 6101"}]'::jsonb,
          'Italia',
          'Milano',
          '20121',
          'MI',
          '7',
          'Via Dante'
        ),
        (
          'c2',
          'Global Tech',
          FALSE,
          '2024-03-05 14:15:00',
          'company',
          'Andrea Bassi',
          'GTECH-001',
          'research@global-tech.demo',
          '+39 011 5550 6202',
          'Corso Vittorio Emanuele II 74, 10121 Torino (TO), Italia',
          'Demo customer for commercial projects and CRM workflows.',
          '72.19.09',
          'https://global-tech.demo',
          'SERVICES',
          '< 50',
          '< 10',
          'IT20000000002',
          'IT20000000002',
          NULL,
          '1',
          '[{"fullName":"Andrea Bassi","role":"Innovation Lead","email":"research@global-tech.demo","phone":"+39 011 5550 6202"}]'::jsonb,
          'Italia',
          'Torino',
          '10121',
          'TO',
          '74',
          'Corso Vittorio Emanuele II'
        )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       created_at = EXCLUDED.created_at,
       is_disabled = FALSE,
       type = EXCLUDED.type,
       contact_name = EXCLUDED.contact_name,
       client_code = EXCLUDED.client_code,
       email = EXCLUDED.email,
       phone = EXCLUDED.phone,
       address = EXCLUDED.address,
       description = EXCLUDED.description,
       ateco_code = EXCLUDED.ateco_code,
       website = EXCLUDED.website,
       sector = EXCLUDED.sector,
       number_of_employees = EXCLUDED.number_of_employees,
       revenue = EXCLUDED.revenue,
       fiscal_code = EXCLUDED.fiscal_code,
       vat_number = EXCLUDED.vat_number,
       tax_code = NULL,
       office_count_range = EXCLUDED.office_count_range,
       contacts = EXCLUDED.contacts,
       address_country = EXCLUDED.address_country,
       address_state = EXCLUDED.address_state,
       address_cap = EXCLUDED.address_cap,
       address_province = EXCLUDED.address_province,
       address_civic_number = EXCLUDED.address_civic_number,
       address_line = EXCLUDED.address_line`,
  );
  incrementCount(counts, 'clients', clientsResult.rowCount ?? 0);

  const projectsResult = await executeStatement(
    client,
    // Commercial dates bracket their demo entries; Internal Research is deliberately open-ended.
    `INSERT INTO projects (id, name, client_id, description, start_date, end_date, tipo, tipo_confirmed) VALUES
        ('p1', 'Website Redesign', 'c1', 'Complete overhaul of the main marketing site.', (CURRENT_DATE - INTERVAL '30 days')::date, (CURRENT_DATE + INTERVAL '30 days')::date, 'attivo', TRUE),
        ('p2', 'Mobile App', 'c1', 'Native iOS and Android application development.', (CURRENT_DATE - INTERVAL '28 days')::date, (CURRENT_DATE + INTERVAL '28 days')::date, 'attivo', TRUE),
        ('p3', 'Internal Research', 'praetor-own-company', 'Ongoing research into new market trends.', NULL, NULL, 'interno', TRUE)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       client_id = EXCLUDED.client_id,
       description = EXCLUDED.description,
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       tipo = EXCLUDED.tipo,
       tipo_confirmed = EXCLUDED.tipo_confirmed,
       is_disabled = FALSE,
       order_id = NULL,
       offer_id = NULL,
       revenue = NULL,
       billing_type = DEFAULT,
       billing_frequency = DEFAULT`,
  );
  incrementCount(counts, 'projects', projectsResult.rowCount ?? 0);

  const tasksResult = await executeStatement(
    client,
    `INSERT INTO tasks (id, name, project_id, description) VALUES
        ('t1', 'Initial Design', 'p1', 'Lo-fi wireframes and moodboards.'),
        ('t2', 'Frontend Dev', 'p1', 'React component implementation.'),
        ('t3', 'API Integration', 'p2', 'Connecting the app to the backend services.'),
        ('t4', 'General Support', 'p3', 'Misc administrative tasks and support.'),
        ('t5', 'Market Analysis', 'p3', 'Competitive landscape and pricing research.')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       project_id = EXCLUDED.project_id,
       description = EXCLUDED.description,
       is_recurring = DEFAULT,
       recurrence_pattern = NULL,
       recurrence_start = NULL,
       recurrence_end = NULL,
       recurrence_duration = DEFAULT,
       expected_effort = DEFAULT,
       revenue = DEFAULT,
       duration = DEFAULT,
       notes = NULL,
       is_disabled = FALSE,
       billing_type = DEFAULT,
       billing_frequency = DEFAULT,
       monthly_effort = DEFAULT`,
  );
  incrementCount(counts, 'tasks', tasksResult.rowCount ?? 0);
};

const insertDemoUsersAndSettings = async (client: PoolClient, counts: Record<string, number>) => {
  const userValues: unknown[] = [];
  const userTuples = DEMO_USERS.map((user) => {
    const index = userValues.length + 1;
    userValues.push(
      user.id,
      user.name,
      user.username,
      DEMO_PASSWORD_HASH,
      user.role,
      user.avatarInitials,
      user.costPerHour,
      user.employeeType,
      DEMO_FIRST_LOGIN_AT,
      user.phone,
      user.jobTitle,
      user.department,
      user.employeeCode,
      user.hireDate,
      user.terminationDate,
      user.contractType,
      user.employmentStatus,
      user.workLocation,
      user.emergencyContactName,
      user.emergencyContactPhone,
      user.notes,
    );
    return `(${Array.from({ length: 21 }, (_, offset) => `$${index + offset}`).join(', ')})`;
  });
  const usersResult = await executeStatement(
    client,
    `INSERT INTO users (
       id,
       name,
       username,
       password_hash,
       role,
       avatar_initials,
       cost_per_hour,
       employee_type,
       first_login_at,
       phone,
       job_title,
       department,
       employee_code,
       hire_date,
       termination_date,
       contract_type,
       employment_status,
       work_location,
       emergency_contact_name,
       emergency_contact_phone,
       notes
     )
     VALUES ${userTuples.join(', ')}
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       avatar_initials = EXCLUDED.avatar_initials,
       cost_per_hour = EXCLUDED.cost_per_hour,
       employee_type = EXCLUDED.employee_type,
       phone = EXCLUDED.phone,
       job_title = EXCLUDED.job_title,
       department = EXCLUDED.department,
       employee_code = EXCLUDED.employee_code,
       hire_date = EXCLUDED.hire_date,
       termination_date = EXCLUDED.termination_date,
       contract_type = EXCLUDED.contract_type,
       employment_status = EXCLUDED.employment_status,
       work_location = EXCLUDED.work_location,
       emergency_contact_name = EXCLUDED.emergency_contact_name,
       emergency_contact_phone = EXCLUDED.emergency_contact_phone,
       notes = EXCLUDED.notes,
       is_disabled = FALSE`,
    userValues,
  );
  incrementCount(counts, 'users', usersResult.rowCount ?? 0);

  const userRolesValues: unknown[] = [];
  const userRolesTuples = DEMO_USERS.map((user) => {
    userRolesValues.push(user.id, user.role);
    const idx = userRolesValues.length - 1;
    return `($${idx}, $${idx + 1})`;
  });
  const userRolesResult = await executeStatement(
    client,
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ${userRolesTuples.join(', ')}
     ON CONFLICT DO NOTHING`,
    userRolesValues,
  );
  incrementCount(counts, 'user_roles', userRolesResult.rowCount ?? 0);

  const settingsValues: unknown[] = [];
  const settingsTuples = DEMO_USERS.map((user) => {
    settingsValues.push(user.id, user.fullName, user.email);
    const index = settingsValues.length - 2;
    return `($${index}, $${index + 1}, $${index + 2})`;
  });
  const settingsResult = await executeStatement(
    client,
    `INSERT INTO settings (user_id, full_name, email)
     VALUES ${settingsTuples.join(', ')}
     ON CONFLICT (user_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       updated_at = CURRENT_TIMESTAMP`,
    settingsValues,
  );
  incrementCount(counts, 'settings', settingsResult.rowCount ?? 0);
};

export const assertNoDemoDocumentIdConflicts = async (client: PoolClient, seedYear: number) => {
  const demoIds = buildDemoIds(seedYear);
  const demoClientOwnerIds = [...COMPATIBILITY_DEFAULTS.clients, ...demoIds.clients];
  const invoiceClientOwnerIds = demoIds.clients;
  const result = await client.query<{ table_name: string; id: string }>(
    `WITH demo_inputs AS (
       SELECT
         $1::text[] AS quote_ids,
         $2::text[] AS customer_offer_ids,
         $3::text[] AS sale_ids,
         $4::text[] AS invoice_ids,
         $5::text[] AS supplier_quote_ids,
         $6::text[] AS supplier_sale_ids,
         $7::text[] AS supplier_invoice_ids,
         $8::text[] AS client_owner_ids,
         $9::text[] AS invoice_client_owner_ids,
         $10::text[] AS supplier_owner_ids
     ),
     conflicts AS (
       SELECT 'quotes' AS table_name, quotes.id
       FROM quotes
       CROSS JOIN demo_inputs
       WHERE quotes.id = ANY(demo_inputs.quote_ids)
         AND COALESCE(quotes.client_id, '') <> ALL(demo_inputs.client_owner_ids)
       UNION ALL
       SELECT 'customer_offers' AS table_name, customer_offers.id
       FROM customer_offers
       CROSS JOIN demo_inputs
       WHERE customer_offers.id = ANY(demo_inputs.customer_offer_ids)
         AND COALESCE(customer_offers.client_id, '') <> ALL(demo_inputs.client_owner_ids)
       UNION ALL
       SELECT 'sales' AS table_name, sales.id
       FROM sales
       CROSS JOIN demo_inputs
       WHERE sales.id = ANY(demo_inputs.sale_ids)
         AND COALESCE(sales.client_id, '') <> ALL(demo_inputs.client_owner_ids)
       UNION ALL
       SELECT 'invoices' AS table_name, invoices.id
       FROM invoices
       CROSS JOIN demo_inputs
       WHERE invoices.id = ANY(demo_inputs.invoice_ids)
         AND COALESCE(invoices.client_id, '') <> ALL(demo_inputs.invoice_client_owner_ids)
       UNION ALL
       SELECT 'supplier_quotes' AS table_name, supplier_quotes.id
       FROM supplier_quotes
       CROSS JOIN demo_inputs
       WHERE supplier_quotes.id = ANY(demo_inputs.supplier_quote_ids)
         AND COALESCE(supplier_quotes.supplier_id, '') <> ALL(demo_inputs.supplier_owner_ids)
       UNION ALL
       SELECT 'supplier_sales' AS table_name, supplier_sales.id
       FROM supplier_sales
       CROSS JOIN demo_inputs
       WHERE supplier_sales.id = ANY(demo_inputs.supplier_sale_ids)
         AND COALESCE(supplier_sales.supplier_id, '') <> ALL(demo_inputs.supplier_owner_ids)
       UNION ALL
       SELECT 'supplier_invoices' AS table_name, supplier_invoices.id
       FROM supplier_invoices
       CROSS JOIN demo_inputs
       WHERE supplier_invoices.id = ANY(demo_inputs.supplier_invoice_ids)
         AND COALESCE(supplier_invoices.supplier_id, '') <> ALL(demo_inputs.supplier_owner_ids)
     )
     SELECT table_name, id FROM conflicts ORDER BY table_name, id LIMIT 10`,
    [
      demoIds.quotes,
      demoIds.customerOffers,
      demoIds.sales,
      demoIds.invoices,
      demoIds.supplierQuotes,
      demoIds.supplierSales,
      demoIds.supplierInvoices,
      demoClientOwnerIds,
      invoiceClientOwnerIds,
      demoIds.suppliers,
    ],
  );

  if (result.rows.length > 0) {
    const examples = result.rows.map((row) => `${row.table_name}:${row.id}`).join(', ');
    throw new Error(`Demo seed document ID collision with non-demo records: ${examples}`);
  }
};

export const cleanupDemoNamespace = async (
  client: PoolClient,
  demoUserIds: DemoUserCleanupIds,
  seedYear = getDemoSeedYear(),
) => {
  const demoIds = buildDemoIds(seedYear);
  const cleanupInvoiceIds = [...demoIds.invoices, ...LEGACY_DEMO_INVOICE_IDS];
  const cleanupSupplierInvoiceIds = [
    ...demoIds.supplierInvoices,
    ...LEGACY_DEMO_SUPPLIER_INVOICE_IDS,
  ];
  const cleanupCountsByTable: Record<string, number> = {};

  incrementCount(
    cleanupCountsByTable,
    'time_entries',
    await executeDelete(client, 'time_entries', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.timeEntries);
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_tasks',
    await executeDelete(client, 'user_tasks', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_projects',
    await executeDelete(client, 'user_projects', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_clients',
    await executeDelete(client, 'user_clients', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_work_units',
    await executeDelete(client, 'user_work_units', (builder) => {
      pushTextArrayPredicate(builder, 'work_unit_id', demoIds.workUnits);
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'work_unit_managers',
    await executeDelete(client, 'work_unit_managers', (builder) => {
      pushTextArrayPredicate(builder, 'work_unit_id', demoIds.workUnits);
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'work_units',
    await executeDelete(client, 'work_units', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.workUnits);
      pushTextArrayPredicate(
        builder,
        'name',
        DEMO_WORK_UNITS.map((wu) => wu.name),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'notifications',
    await executeDelete(client, 'notifications', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_NOTIFICATIONS);
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_invoice_items',
    await executeDelete(client, 'supplier_invoice_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.supplierInvoiceItems);
      pushTextArrayPredicate(builder, 'invoice_id', cleanupSupplierInvoiceIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_invoices',
    await executeDelete(client, 'supplier_invoices', (builder) => {
      pushTextArrayPredicate(builder, 'id', cleanupSupplierInvoiceIds);
      pushTextArrayPredicate(builder, 'supplier_id', demoIds.suppliers);
      pushTextArrayPredicate(builder, 'linked_sale_id', demoIds.supplierSales);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) =>
          `id IN (${parentIdsWithDemoProductLines(
            'supplier_invoice_items',
            'invoice_id',
            productIds,
          )})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `linked_sale_id IN (${supplierSaleIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'resales',
    await executeDelete(client, 'resales', (builder) => {
      pushTextArrayPredicate(builder, 'client_order_id', demoIds.sales);
      pushTextArrayPredicate(builder, 'supplier_order_id', demoIds.supplierSales);
      pushTextArraySqlPredicate(
        builder,
        demoIds.clients,
        (clientIds) => `client_order_id IN (${clientSaleIdsForOwner(clientIds)})`,
      );
      pushTextArraySqlPredicate(
        builder,
        demoIds.customerOffers,
        (offerIds) =>
          `client_order_id IN (SELECT id FROM sales WHERE linked_offer_id = ANY(${offerIds}))`,
      );
      pushTextArraySqlPredicate(
        builder,
        demoIds.quotes,
        (quoteIds) =>
          `client_order_id IN (SELECT id FROM sales WHERE linked_quote_id = ANY(${quoteIds}))`,
      );
      pushTextArraySqlPredicate(
        builder,
        demoIds.suppliers,
        (supplierIds) => `supplier_order_id IN (${supplierSaleIdsForOwner(supplierIds)})`,
      );
      pushTextArraySqlPredicate(
        builder,
        demoIds.supplierQuotes,
        (quoteIds) =>
          `supplier_order_id IN (SELECT id FROM supplier_sales WHERE linked_quote_id = ANY(${quoteIds}))`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `client_order_id IN (${clientSaleIdsWithDemoProductLines(productIds)})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `supplier_order_id IN (${supplierSaleIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_sale_items',
    await executeDelete(client, 'supplier_sale_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.supplierSaleItems);
      pushTextArrayPredicate(builder, 'sale_id', demoIds.supplierSales);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_sales',
    await executeDelete(client, 'supplier_sales', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.supplierSales);
      pushTextArrayPredicate(builder, 'supplier_id', demoIds.suppliers);
      pushTextArrayPredicate(builder, 'linked_quote_id', demoIds.supplierQuotes);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) =>
          `id IN (${parentIdsWithDemoProductLines('supplier_sale_items', 'sale_id', productIds)})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `linked_quote_id IN (${supplierQuoteIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_quote_items',
    await executeDelete(client, 'supplier_quote_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.supplierQuoteItems);
      pushTextArrayPredicate(builder, 'quote_id', demoIds.supplierQuotes);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_quotes',
    await executeDelete(client, 'supplier_quotes', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.supplierQuotes);
      pushTextArrayPredicate(builder, 'supplier_id', demoIds.suppliers);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `id IN (${supplierQuoteIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'invoice_items',
    await executeDelete(client, 'invoice_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.invoiceItems);
      pushTextArrayPredicate(builder, 'invoice_id', cleanupInvoiceIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'invoices',
    await executeDelete(client, 'invoices', (builder) => {
      pushTextArrayPredicate(builder, 'id', cleanupInvoiceIds);
      pushTextArrayPredicate(builder, 'client_id', demoIds.clients);
      pushTextArrayPredicate(builder, 'linked_sale_id', demoIds.sales);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) =>
          `id IN (${parentIdsWithDemoProductLines('invoice_items', 'invoice_id', productIds)})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `linked_sale_id IN (${clientSaleIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'sale_items',
    await executeDelete(client, 'sale_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.saleItems);
      pushTextArrayPredicate(builder, 'sale_id', demoIds.sales);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'sales',
    await executeDelete(client, 'sales', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.sales);
      pushTextArrayPredicate(builder, 'client_id', demoIds.clients);
      pushTextArrayPredicate(builder, 'linked_offer_id', demoIds.customerOffers);
      pushTextArrayPredicate(builder, 'linked_quote_id', demoIds.quotes);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) =>
          `id IN (${parentIdsWithDemoProductLines('sale_items', 'sale_id', productIds)})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `linked_offer_id IN (${customerOfferIdsWithDemoProductLines(productIds)})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `linked_quote_id IN (${quoteIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'customer_offer_items',
    await executeDelete(client, 'customer_offer_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.customerOfferItems);
      pushTextArrayPredicate(builder, 'offer_id', demoIds.customerOffers);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'customer_offers',
    await executeDelete(client, 'customer_offers', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.customerOffers);
      pushTextArrayPredicate(builder, 'client_id', demoIds.clients);
      pushTextArrayPredicate(builder, 'linked_quote_id', demoIds.quotes);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) =>
          `id IN (${parentIdsWithDemoProductLines(
            'customer_offer_items',
            'offer_id',
            productIds,
          )})`,
      );
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `linked_quote_id IN (${quoteIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'quote_items',
    await executeDelete(client, 'quote_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.quoteItems);
      pushTextArrayPredicate(builder, 'quote_id', demoIds.quotes);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'quotes',
    await executeDelete(client, 'quotes', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.quotes);
      pushTextArrayPredicate(builder, 'client_id', demoIds.clients);
      pushDemoProductSqlPredicate(
        builder,
        demoIds,
        (productIds) => `id IN (${quoteIdsWithDemoProductLines(productIds)})`,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'products',
    await executeDelete(client, 'products', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.products);
      pushTextArrayPredicate(
        builder,
        'product_code',
        DEMO_PRODUCTS.map((product) => product.productCode),
      );
      pushTextArrayPredicate(
        builder,
        'name',
        DEMO_PRODUCTS.map((product) => product.name),
      );
      pushTextArrayPredicate(builder, 'supplier_id', demoIds.suppliers);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'projects',
    await executeDelete(client, 'projects', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.projects);
      pushTextArrayPredicate(
        builder,
        'name',
        DEMO_PROJECTS.map((project) => project.name),
      );
      pushTextArrayPredicate(builder, 'client_id', demoIds.clients);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'tasks',
    await executeDelete(client, 'tasks', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.tasks);
      pushTextArrayPredicate(builder, 'project_id', demoIds.projects);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'suppliers',
    await executeDelete(client, 'suppliers', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoIds.suppliers);
      pushTextArrayPredicate(
        builder,
        'supplier_code',
        DEMO_SUPPLIERS.map((supplier) => supplier.supplierCode),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'clients',
    await executeDelete(client, 'clients', (builder) => {
      const compatibilityClientCodes = COMPATIBILITY_DEFAULT_CLIENTS.map(
        (clientItem) => clientItem.clientCode,
      );
      const compatibilityFiscalCodes = COMPATIBILITY_DEFAULT_CLIENTS.map(
        (clientItem) => clientItem.fiscalCode,
      );
      const demoClientCodes = DEMO_CLIENTS.map((clientItem) => clientItem.clientCode);
      const demoFiscalCodes = DEMO_CLIENTS.map((clientItem) => clientItem.fiscalCode);

      pushTextArrayPredicate(builder, 'id', demoIds.clients);
      pushTextArrayPredicateExcludingIds(
        builder,
        'client_code',
        demoClientCodes,
        COMPATIBILITY_DEFAULTS.clients,
      );
      pushLowerTextArrayPredicateExcludingIds(
        builder,
        'fiscal_code',
        demoFiscalCodes,
        COMPATIBILITY_DEFAULTS.clients,
      );
      pushTextArrayPredicateExcludingIds(
        builder,
        'client_code',
        compatibilityClientCodes,
        COMPATIBILITY_DEFAULTS.clients,
      );
      pushLowerTextArrayPredicateExcludingIds(
        builder,
        'fiscal_code',
        compatibilityFiscalCodes,
        COMPATIBILITY_DEFAULTS.clients,
      );
      pushLowerTextArrayPredicateExcludingIds(
        builder,
        'vat_number',
        compatibilityFiscalCodes,
        COMPATIBILITY_DEFAULTS.clients,
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'settings',
    await executeDelete(client, 'settings', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_roles',
    await executeDelete(client, 'user_roles', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIds.dependentUserIds);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'users',
    await executeDelete(client, 'users', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoUserIds.userIdsToDelete);
    }),
  );

  return cleanupCountsByTable;
};

const executeDemoStatements = async (client: PoolClient, counts: Record<string, number>) => {
  const statements = loadDemoStatements();
  const failedStatements: FailedStatement[] = [];

  for (const [index, statement] of statements.entries()) {
    const savepoint = `demo_seed_stmt_${index + 1}`;
    await client.query(`SAVEPOINT ${savepoint}`);

    try {
      const result = await client.query(statement);
      incrementCount(counts, extractInsertTable(statement), result.rowCount ?? 0);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);

      failedStatements.push({
        table: extractInsertTable(statement),
        keys: extractStatementKeys(statement),
        statementIndex: index + 1,
        error: serializeError(err),
      });
    }
  }

  return failedStatements;
};

const buildVerificationSteps = (
  demoIds: RuntimeDemoIds,
  assignmentTargetIds: RuntimeDemoAssignmentTargetIds,
): VerificationStep[] => [
  { table: 'users', countColumn: 'id', ids: DEMO_USER_IDS, expected: DEMO_EXPECTED_COUNTS.users },
  {
    table: 'settings',
    countColumn: 'user_id',
    ids: demoIds.settingsUserIds,
    expected: DEMO_EXPECTED_COUNTS.settings,
  },
  {
    table: 'clients',
    ids: [...COMPATIBILITY_DEFAULTS.clients, ...demoIds.clients],
    expected: DEMO_EXPECTED_COUNTS.clients,
  },
  { table: 'suppliers', ids: demoIds.suppliers, expected: DEMO_EXPECTED_COUNTS.suppliers },
  { table: 'products', ids: demoIds.products, expected: DEMO_EXPECTED_COUNTS.products },
  { table: 'quotes', ids: demoIds.quotes, expected: DEMO_EXPECTED_COUNTS.quotes },
  {
    table: 'quote_candidates',
    ids: demoIds.quotes,
    expected: DEMO_EXPECTED_COUNTS.quote_candidates,
  },
  {
    table: 'quote_items',
    ids: DEMO_ITEM_IDS.quoteItems,
    expected: DEMO_EXPECTED_COUNTS.quote_items,
  },
  {
    table: 'customer_offers',
    ids: demoIds.customerOffers,
    expected: DEMO_EXPECTED_COUNTS.customer_offers,
  },
  {
    table: 'customer_offer_items',
    ids: DEMO_ITEM_IDS.customerOfferItems,
    expected: DEMO_EXPECTED_COUNTS.customer_offer_items,
  },
  { table: 'sales', ids: demoIds.sales, expected: DEMO_EXPECTED_COUNTS.sales },
  {
    table: 'sale_items',
    ids: DEMO_ITEM_IDS.saleItems,
    expected: DEMO_EXPECTED_COUNTS.sale_items,
  },
  { table: 'invoices', ids: demoIds.invoices, expected: DEMO_EXPECTED_COUNTS.invoices },
  {
    table: 'invoice_items',
    ids: DEMO_ITEM_IDS.invoiceItems,
    expected: DEMO_EXPECTED_COUNTS.invoice_items,
  },
  {
    table: 'supplier_quotes',
    ids: demoIds.supplierQuotes,
    expected: DEMO_EXPECTED_COUNTS.supplier_quotes,
  },
  {
    table: 'supplier_quote_items',
    ids: DEMO_ITEM_IDS.supplierQuoteItems,
    expected: DEMO_EXPECTED_COUNTS.supplier_quote_items,
  },
  {
    table: 'supplier_sales',
    ids: demoIds.supplierSales,
    expected: DEMO_EXPECTED_COUNTS.supplier_sales,
  },
  {
    table: 'supplier_sale_items',
    ids: DEMO_ITEM_IDS.supplierSaleItems,
    expected: DEMO_EXPECTED_COUNTS.supplier_sale_items,
  },
  {
    table: 'supplier_invoices',
    ids: demoIds.supplierInvoices,
    expected: DEMO_EXPECTED_COUNTS.supplier_invoices,
  },
  {
    table: 'supplier_invoice_items',
    ids: DEMO_ITEM_IDS.supplierInvoiceItems,
    expected: DEMO_EXPECTED_COUNTS.supplier_invoice_items,
  },
  {
    table: 'projects',
    ids: [...COMPATIBILITY_DEFAULTS.projects, ...demoIds.projects],
    expected: DEMO_EXPECTED_COUNTS.projects,
  },
  {
    table: 'tasks',
    ids: [...COMPATIBILITY_DEFAULTS.tasks, ...demoIds.tasks],
    expected: DEMO_EXPECTED_COUNTS.tasks,
  },
  {
    table: 'notifications',
    ids: demoIds.notifications,
    expected: DEMO_EXPECTED_COUNTS.notifications,
  },
  { table: 'work_units', ids: demoIds.workUnits, expected: DEMO_EXPECTED_COUNTS.work_units },
  {
    table: 'work_unit_managers',
    countColumn: 'work_unit_id',
    ids: demoIds.workUnits,
    expected: DEMO_EXPECTED_COUNTS.work_unit_managers,
  },
  {
    table: 'user_work_units',
    countColumn: 'work_unit_id',
    ids: demoIds.workUnits,
    expected: DEMO_EXPECTED_COUNTS.user_work_units,
  },
  {
    table: 'user_clients',
    countColumn: 'client_id',
    ids: assignmentTargetIds.clients,
    userIds: DEMO_USER_IDS,
    expected: DEMO_EXPECTED_COUNTS.user_clients,
  },
  {
    table: 'user_projects',
    countColumn: 'project_id',
    ids: assignmentTargetIds.projects,
    userIds: DEMO_USER_IDS,
    expected: DEMO_EXPECTED_COUNTS.user_projects,
  },
  {
    table: 'user_tasks',
    countColumn: 'task_id',
    ids: assignmentTargetIds.tasks,
    userIds: DEMO_USER_IDS,
    expected: DEMO_EXPECTED_COUNTS.user_tasks,
  },
  { table: 'time_entries', ids: demoIds.timeEntries, expected: DEMO_EXPECTED_COUNTS.time_entries },
];

const verifyDemoDataset = async (client: PoolClient, seedYear: number) => {
  const demoIds = buildDemoIds(seedYear);
  const assignmentTargetIds = buildDemoAssignmentTargetIds(demoIds);
  const verificationSteps = buildVerificationSteps(demoIds, assignmentTargetIds);
  const verificationCountsByTable: Record<string, number> = {};
  const mismatches: Array<{ table: string; expected: number; actual: number }> = [];

  for (const step of verificationSteps) {
    const countColumn = step.countColumn ?? 'id';
    const userFilter = step.userIds ? ' AND user_id = ANY($2::text[])' : '';
    const params = step.userIds ? [step.ids, step.userIds] : [step.ids];
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${step.table} WHERE ${countColumn} = ANY($1::text[])${userFilter}`,
      params,
    );
    const actual = Number(result.rows[0]?.count ?? 0);
    verificationCountsByTable[step.table] = actual;
    if (actual !== step.expected) {
      mismatches.push({ table: step.table, expected: step.expected, actual });
    }
  }

  return { verificationCountsByTable, mismatches };
};

export const selectDemoUserCleanupIds = (rows: Array<{ id: string }>): DemoUserCleanupIds => {
  const demoUserIdSet = new Set<string>(DEMO_USER_IDS);
  const dependentUserIds = rows.map((row) => row.id);
  return {
    dependentUserIds,
    userIdsToDelete: dependentUserIds.filter((id) => !demoUserIdSet.has(id)),
  };
};

const collectDemoUserCleanupIds = async (client: PoolClient) => {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE id = ANY($1::text[]) OR username = ANY($2::text[])
     ORDER BY id`,
    [DEMO_USER_IDS, DEMO_USERS.map((user) => user.username)],
  );
  return selectDemoUserCleanupIds(result.rows);
};

export const runDemoSeedRefresh = async ({
  source,
}: {
  source: DemoSeedSource;
}): Promise<DemoSeedResult> => {
  const seedYear = getDemoSeedYear();
  const insertCountsByTable: Record<string, number> = {};
  let cleanupCountsByTable: Record<string, number> = {};
  let verificationCountsByTable: Record<string, number> = {};
  let failedStatements: FailedStatement[] = [];

  await ensureBootstrapAdmin();

  const client = await pool.connect();
  let inTransaction = false;

  try {
    const demoUserIds = await collectDemoUserCleanupIds(client);
    const transactionDb: DbExecutor = drizzle(client, { schema });

    await client.query('BEGIN');
    inTransaction = true;

    await setDemoSeedYear(client, seedYear);
    await assertNoDemoDocumentIdConflicts(client, seedYear);

    cleanupCountsByTable = await cleanupDemoNamespace(client, demoUserIds, seedYear);
    await insertCompatibilityDefaults(client, insertCountsByTable);
    await insertDemoUsersAndSettings(client, insertCountsByTable);

    failedStatements = await executeDemoStatements(client, insertCountsByTable);

    if (failedStatements.length > 0) {
      throw new Error('Demo seed insert phase failed');
    }

    // Reuse this client's open transaction so assignment writes and seed rows commit or roll back
    // together. Passing an existing executor also prevents the repository from opening a nested
    // transaction on the shared pool.
    for (const userId of DEMO_TOP_MANAGER_USER_IDS) {
      await userAssignmentsRepo.syncTopManagerAssignmentsForUser(userId, transactionDb);
    }

    const verification = await verifyDemoDataset(client, seedYear);
    verificationCountsByTable = verification.verificationCountsByTable;

    if (verification.mismatches.length > 0) {
      logger.error(
        {
          demoSeedingEnabled: true,
          source,
          cleanupCountsByTable,
          insertCountsByTable,
          verificationCountsByTable,
          verificationMismatches: verification.mismatches,
        },
        'Demo seed verification failed',
      );
      throw new Error(
        `Demo seed verification failed for ${verification.mismatches
          .map((item) => `${item.table} expected ${item.expected} got ${item.actual}`)
          .join(', ')}`,
      );
    }

    await client.query('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }

    logger.error(
      {
        demoSeedingEnabled: true,
        source,
        cleanupCountsByTable,
        insertCountsByTable,
        verificationCountsByTable,
        failedStatements,
        err: serializeError(err),
      },
      'Demo seed refresh transaction failed',
    );
    throw err;
  } finally {
    client.release();
  }

  const result: DemoSeedResult = {
    demoSeedingEnabled: true,
    source,
    cleanupCountsByTable,
    insertCountsByTable,
    verificationCountsByTable,
  };

  logger.info(result, 'Demo seed refresh completed');
  return result;
};
