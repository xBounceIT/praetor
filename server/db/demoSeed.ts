import { readFileSync } from 'fs';
import type { PoolClient } from 'pg';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { ensureBootstrapAdmin } from './bootstrapAdmin.ts';
import {
  DEMO_CLIENTS,
  DEMO_CUSTOMER_OFFERS,
  DEMO_EXPECTED_COUNTS,
  DEMO_IDS,
  DEMO_INVOICES,
  DEMO_ITEM_IDS,
  DEMO_NOTIFICATIONS,
  DEMO_PASSWORD_HASH,
  DEMO_PRODUCTS,
  DEMO_PROJECTS,
  DEMO_SALES,
  DEMO_SUPPLIER_INVOICES,
  DEMO_SUPPLIER_SALES,
  DEMO_SUPPLIERS,
  DEMO_USER_IDS,
  DEMO_USERS,
  DEMO_WORK_UNITS,
} from './demoSeedManifest.ts';
import pool, { query } from './index.ts';

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
  expected: number;
};

const nonEmpty = <T>(values: readonly (T | null | undefined)[]) =>
  values.filter((value): value is T => value !== null && value !== undefined);

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

const pushLowerTextArrayPredicate = (
  builder: PredicateBuilder,
  column: string,
  values: readonly string[],
) => {
  const lowered = values.map((value) => value.toLowerCase());
  pushTextArrayPredicate(builder, `LOWER(${column})`, lowered);
};

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

const loadDemoStatements = () => {
  const seedSql = readFileSync(seedPath, 'utf8');
  const markerIndex = seedSql.indexOf(DEMO_SEED_MARKER);
  if (markerIndex === -1) {
    throw new Error(`Demo seed marker not found in ${seedPath.pathname}`);
  }
  return splitSqlStatements(seedSql.slice(markerIndex));
};

const insertCompatibilityDefaults = async (client: PoolClient, counts: Record<string, number>) => {
  const clientsResult = await executeStatement(
    client,
    `INSERT INTO clients (id, name, created_at) VALUES
        ('c1', 'Acme Corp', '2024-01-15 09:30:00'),
        ('c2', 'Global Tech', '2024-03-05 14:15:00')
     ON CONFLICT (id) DO NOTHING`,
  );
  incrementCount(counts, 'clients', clientsResult.rowCount ?? 0);

  const projectsResult = await executeStatement(
    client,
    `INSERT INTO projects (id, name, client_id, color, description) VALUES
        ('p1', 'Website Redesign', 'c1', '#3b82f6', 'Complete overhaul of the main marketing site.'),
        ('p2', 'Mobile App', 'c1', '#10b981', 'Native iOS and Android application development.'),
        ('p3', 'Internal Research', 'c2', '#8b5cf6', 'Ongoing research into new market trends.')
     ON CONFLICT (id) DO NOTHING`,
  );
  incrementCount(counts, 'projects', projectsResult.rowCount ?? 0);

  const tasksResult = await executeStatement(
    client,
    `INSERT INTO tasks (id, name, project_id, description) VALUES
        ('t1', 'Initial Design', 'p1', 'Lo-fi wireframes and moodboards.'),
        ('t2', 'Frontend Dev', 'p1', 'React component implementation.'),
        ('t3', 'API Integration', 'p2', 'Connecting the app to the backend services.'),
        ('t4', 'General Support', 'p3', 'Misc administrative tasks and support.')
     ON CONFLICT (id) DO NOTHING`,
  );
  incrementCount(counts, 'tasks', tasksResult.rowCount ?? 0);
};

const insertDemoUsersAndSettings = async (client: PoolClient, counts: Record<string, number>) => {
  const userValues: unknown[] = [];
  const userTuples = DEMO_USERS.map((user) => {
    userValues.push(
      user.id,
      user.name,
      user.username,
      DEMO_PASSWORD_HASH,
      user.role,
      user.avatarInitials,
      user.costPerHour,
      'app_user',
    );
    const index = userValues.length - 7;
    return `($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, $${index + 6}, $${index + 7})`;
  });
  const usersResult = await executeStatement(
    client,
    `INSERT INTO users (id, name, username, password_hash, role, avatar_initials, cost_per_hour, employee_type)
     VALUES ${userTuples.join(', ')}
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       avatar_initials = EXCLUDED.avatar_initials,
       cost_per_hour = EXCLUDED.cost_per_hour,
       employee_type = EXCLUDED.employee_type,
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

const cleanupDemoNamespace = async (client: PoolClient, demoUserIdsToDelete: string[]) => {
  const cleanupCountsByTable: Record<string, number> = {};

  incrementCount(
    cleanupCountsByTable,
    'time_entries',
    await executeDelete(client, 'time_entries', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.timeEntries);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_work_units',
    await executeDelete(client, 'user_work_units', (builder) => {
      pushTextArrayPredicate(builder, 'work_unit_id', DEMO_IDS.workUnits);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'work_unit_managers',
    await executeDelete(client, 'work_unit_managers', (builder) => {
      pushTextArrayPredicate(builder, 'work_unit_id', DEMO_IDS.workUnits);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'work_units',
    await executeDelete(client, 'work_units', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.workUnits);
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
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_invoice_items',
    await executeDelete(client, 'supplier_invoice_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.supplierInvoiceItems);
      pushTextArrayPredicate(builder, 'invoice_id', DEMO_IDS.supplierInvoices);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_invoices',
    await executeDelete(client, 'supplier_invoices', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.supplierInvoices);
      pushTextArrayPredicate(builder, 'supplier_id', DEMO_IDS.suppliers);
      pushTextArrayPredicate(
        builder,
        'linked_sale_id',
        nonEmpty(DEMO_SUPPLIER_INVOICES.map((invoice) => invoice.linkedSaleId)),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_sale_items',
    await executeDelete(client, 'supplier_sale_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.supplierSaleItems);
      pushTextArrayPredicate(builder, 'sale_id', DEMO_IDS.supplierSales);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_sales',
    await executeDelete(client, 'supplier_sales', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.supplierSales);
      pushTextArrayPredicate(builder, 'supplier_id', DEMO_IDS.suppliers);
      pushTextArrayPredicate(
        builder,
        'linked_quote_id',
        nonEmpty(DEMO_SUPPLIER_SALES.map((sale) => sale.linkedQuoteId)),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_quote_items',
    await executeDelete(client, 'supplier_quote_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.supplierQuoteItems);
      pushTextArrayPredicate(builder, 'quote_id', DEMO_IDS.supplierQuotes);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'supplier_quotes',
    await executeDelete(client, 'supplier_quotes', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.supplierQuotes);
      pushTextArrayPredicate(builder, 'supplier_id', DEMO_IDS.suppliers);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'invoice_items',
    await executeDelete(client, 'invoice_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.invoiceItems);
      pushTextArrayPredicate(builder, 'invoice_id', DEMO_IDS.invoices);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'invoices',
    await executeDelete(client, 'invoices', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.invoices);
      pushTextArrayPredicate(builder, 'client_id', DEMO_IDS.clients);
      pushTextArrayPredicate(
        builder,
        'linked_sale_id',
        nonEmpty(DEMO_INVOICES.map((invoice) => invoice.linkedSaleId)),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'sale_items',
    await executeDelete(client, 'sale_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.saleItems);
      pushTextArrayPredicate(builder, 'sale_id', DEMO_IDS.sales);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'sales',
    await executeDelete(client, 'sales', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.sales);
      pushTextArrayPredicate(builder, 'client_id', DEMO_IDS.clients);
      pushTextArrayPredicate(
        builder,
        'linked_offer_id',
        nonEmpty(DEMO_SALES.map((sale) => sale.linkedOfferId)),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'customer_offer_items',
    await executeDelete(client, 'customer_offer_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.customerOfferItems);
      pushTextArrayPredicate(builder, 'offer_id', DEMO_IDS.customerOffers);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'customer_offers',
    await executeDelete(client, 'customer_offers', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.customerOffers);
      pushTextArrayPredicate(builder, 'client_id', DEMO_IDS.clients);
      pushTextArrayPredicate(
        builder,
        'linked_quote_id',
        DEMO_CUSTOMER_OFFERS.map((offer) => offer.linkedQuoteId),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'quote_items',
    await executeDelete(client, 'quote_items', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_ITEM_IDS.quoteItems);
      pushTextArrayPredicate(builder, 'quote_id', DEMO_IDS.quotes);
      pushTextArrayPredicate(builder, 'product_id', DEMO_IDS.products);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'quotes',
    await executeDelete(client, 'quotes', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.quotes);
      pushTextArrayPredicate(builder, 'client_id', DEMO_IDS.clients);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'products',
    await executeDelete(client, 'products', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.products);
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
      pushTextArrayPredicate(builder, 'supplier_id', DEMO_IDS.suppliers);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'projects',
    await executeDelete(client, 'projects', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.projects);
      pushTextArrayPredicate(
        builder,
        'name',
        DEMO_PROJECTS.map((project) => project.name),
      );
      pushTextArrayPredicate(builder, 'client_id', DEMO_IDS.clients);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'tasks',
    await executeDelete(client, 'tasks', (builder) => {
      pushTextArrayPredicate(builder, 'project_id', DEMO_IDS.projects);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'suppliers',
    await executeDelete(client, 'suppliers', (builder) => {
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.suppliers);
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
      pushTextArrayPredicate(builder, 'id', DEMO_IDS.clients);
      pushTextArrayPredicate(
        builder,
        'client_code',
        DEMO_CLIENTS.map((clientItem) => clientItem.clientCode),
      );
      pushLowerTextArrayPredicate(
        builder,
        'fiscal_code',
        DEMO_CLIENTS.map((clientItem) => clientItem.fiscalCode),
      );
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'settings',
    await executeDelete(client, 'settings', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIdsToDelete);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'user_roles',
    await executeDelete(client, 'user_roles', (builder) => {
      pushTextArrayPredicate(builder, 'user_id', demoUserIdsToDelete);
    }),
  );

  incrementCount(
    cleanupCountsByTable,
    'users',
    await executeDelete(client, 'users', (builder) => {
      pushTextArrayPredicate(builder, 'id', demoUserIdsToDelete);
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

const verificationSteps: VerificationStep[] = [
  { table: 'users', countColumn: 'id', ids: DEMO_USER_IDS, expected: DEMO_EXPECTED_COUNTS.users },
  {
    table: 'settings',
    countColumn: 'user_id',
    ids: DEMO_IDS.settingsUserIds,
    expected: DEMO_EXPECTED_COUNTS.settings,
  },
  { table: 'clients', ids: DEMO_IDS.clients, expected: DEMO_EXPECTED_COUNTS.clients },
  { table: 'suppliers', ids: DEMO_IDS.suppliers, expected: DEMO_EXPECTED_COUNTS.suppliers },
  { table: 'products', ids: DEMO_IDS.products, expected: DEMO_EXPECTED_COUNTS.products },
  { table: 'quotes', ids: DEMO_IDS.quotes, expected: DEMO_EXPECTED_COUNTS.quotes },
  {
    table: 'quote_items',
    ids: DEMO_ITEM_IDS.quoteItems,
    expected: DEMO_EXPECTED_COUNTS.quote_items,
  },
  {
    table: 'customer_offers',
    ids: DEMO_IDS.customerOffers,
    expected: DEMO_EXPECTED_COUNTS.customer_offers,
  },
  {
    table: 'customer_offer_items',
    ids: DEMO_ITEM_IDS.customerOfferItems,
    expected: DEMO_EXPECTED_COUNTS.customer_offer_items,
  },
  { table: 'sales', ids: DEMO_IDS.sales, expected: DEMO_EXPECTED_COUNTS.sales },
  {
    table: 'sale_items',
    ids: DEMO_ITEM_IDS.saleItems,
    expected: DEMO_EXPECTED_COUNTS.sale_items,
  },
  { table: 'invoices', ids: DEMO_IDS.invoices, expected: DEMO_EXPECTED_COUNTS.invoices },
  {
    table: 'invoice_items',
    ids: DEMO_ITEM_IDS.invoiceItems,
    expected: DEMO_EXPECTED_COUNTS.invoice_items,
  },
  {
    table: 'supplier_quotes',
    ids: DEMO_IDS.supplierQuotes,
    expected: DEMO_EXPECTED_COUNTS.supplier_quotes,
  },
  {
    table: 'supplier_quote_items',
    ids: DEMO_ITEM_IDS.supplierQuoteItems,
    expected: DEMO_EXPECTED_COUNTS.supplier_quote_items,
  },
  {
    table: 'supplier_sales',
    ids: DEMO_IDS.supplierSales,
    expected: DEMO_EXPECTED_COUNTS.supplier_sales,
  },
  {
    table: 'supplier_sale_items',
    ids: DEMO_ITEM_IDS.supplierSaleItems,
    expected: DEMO_EXPECTED_COUNTS.supplier_sale_items,
  },
  {
    table: 'supplier_invoices',
    ids: DEMO_IDS.supplierInvoices,
    expected: DEMO_EXPECTED_COUNTS.supplier_invoices,
  },
  {
    table: 'supplier_invoice_items',
    ids: DEMO_ITEM_IDS.supplierInvoiceItems,
    expected: DEMO_EXPECTED_COUNTS.supplier_invoice_items,
  },
  { table: 'projects', ids: DEMO_IDS.projects, expected: DEMO_EXPECTED_COUNTS.projects },
  {
    table: 'notifications',
    ids: DEMO_IDS.notifications,
    expected: DEMO_EXPECTED_COUNTS.notifications,
  },
  { table: 'work_units', ids: DEMO_IDS.workUnits, expected: DEMO_EXPECTED_COUNTS.work_units },
  {
    table: 'work_unit_managers',
    countColumn: 'work_unit_id',
    ids: DEMO_IDS.workUnits,
    expected: DEMO_EXPECTED_COUNTS.work_unit_managers,
  },
  {
    table: 'user_work_units',
    countColumn: 'work_unit_id',
    ids: DEMO_IDS.workUnits,
    expected: DEMO_EXPECTED_COUNTS.user_work_units,
  },
  { table: 'time_entries', ids: DEMO_IDS.timeEntries, expected: DEMO_EXPECTED_COUNTS.time_entries },
];

const verifyDemoDataset = async () => {
  const verificationCountsByTable: Record<string, number> = {};
  const mismatches: Array<{ table: string; expected: number; actual: number }> = [];

  for (const step of verificationSteps) {
    const countColumn = step.countColumn ?? 'id';
    const result = await query(
      `SELECT COUNT(*)::int AS count FROM ${step.table} WHERE ${countColumn} = ANY($1::text[])`,
      [step.ids],
    );
    const actual = Number(result.rows[0]?.count ?? 0);
    verificationCountsByTable[step.table] = actual;
    if (actual !== step.expected) {
      mismatches.push({ table: step.table, expected: step.expected, actual });
    }
  }

  return { verificationCountsByTable, mismatches };
};

const collectDemoUserIdsToDelete = async (client: PoolClient) => {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE id = ANY($1::text[]) OR username = ANY($2::text[])
     ORDER BY id`,
    [DEMO_IDS.users, DEMO_USERS.map((user) => user.username)],
  );
  return result.rows.map((row) => row.id);
};

export const runDemoSeedRefresh = async ({
  source,
}: {
  source: DemoSeedSource;
}): Promise<DemoSeedResult> => {
  const insertCountsByTable: Record<string, number> = {};
  let cleanupCountsByTable: Record<string, number> = {};
  let verificationCountsByTable: Record<string, number> = {};
  let failedStatements: FailedStatement[] = [];

  await ensureBootstrapAdmin();

  const client = await pool.connect();
  let inTransaction = false;

  try {
    const demoUserIdsToDelete = await collectDemoUserIdsToDelete(client);

    await client.query('BEGIN');
    inTransaction = true;

    cleanupCountsByTable = await cleanupDemoNamespace(client, demoUserIdsToDelete);
    await insertCompatibilityDefaults(client, insertCountsByTable);
    await insertDemoUsersAndSettings(client, insertCountsByTable);

    failedStatements = await executeDemoStatements(client, insertCountsByTable);

    if (failedStatements.length > 0) {
      throw new Error('Demo seed insert phase failed');
    }

    await client.query('COMMIT');
    inTransaction = false;

    for (const user of DEMO_USERS) {
      if (user.role === 'top_manager') {
        await userAssignmentsRepo.syncTopManagerAssignmentsForUser(user.id);
      }
    }
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
        failedStatements,
        err: serializeError(err),
      },
      'Demo seed refresh failed during cleanup or insert phase',
    );
    throw err;
  } finally {
    client.release();
  }

  try {
    const verification = await verifyDemoDataset();
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

    const result: DemoSeedResult = {
      demoSeedingEnabled: true,
      source,
      cleanupCountsByTable,
      insertCountsByTable,
      verificationCountsByTable,
    };

    logger.info(result, 'Demo seed refresh completed');
    return result;
  } catch (err) {
    logger.error(
      {
        demoSeedingEnabled: true,
        source,
        cleanupCountsByTable,
        insertCountsByTable,
        verificationCountsByTable,
        err: serializeError(err),
      },
      'Demo seed refresh failed after insert phase',
    );
    throw err;
  }
};
