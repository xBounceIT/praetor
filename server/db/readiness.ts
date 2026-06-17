import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { type DbExecutor, db, executeRows, schema } from './drizzle.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, 'migrations');

type MigrationCountRow = {
  appliedCount: string | number | bigint;
};

export type DbReadinessProbe = {
  name: string;
  run: (exec: DbExecutor) => Promise<unknown>;
};

export type DbReadinessResult = {
  appliedMigrations: number;
  expectedMigrations: number;
  probedTables: string[];
};

type VerifyDbReadinessOptions = {
  exec?: DbExecutor;
  migrationsDir?: string;
  probes?: readonly DbReadinessProbe[];
};

const schemaReadinessTables = [
  ['audit_logs', schema.auditLogs],
  ['client_profile_options', schema.clientProfileOptions],
  ['clients', schema.clients],
  ['customer_offer_items', schema.customerOfferItems],
  ['customer_offers', schema.customerOffers],
  ['email_config', schema.emailConfig],
  ['external_identities', schema.externalIdentities],
  ['general_settings', schema.generalSettings],
  ['invoice_items', schema.invoiceItems],
  ['invoices', schema.invoices],
  ['ldap_config', schema.ldapConfig],
  ['notifications', schema.notifications],
  ['offer_versions', schema.offerVersions],
  ['order_versions', schema.orderVersions],
  ['product_categories', schema.productCategories],
  ['product_subcategories', schema.productSubcategories],
  ['products', schema.products],
  ['product_types', schema.productTypes],
  ['project_rules', schema.projectRules],
  ['projects', schema.projects],
  ['quote_items', schema.quoteItems],
  ['quotes', schema.quotes],
  ['quote_versions', schema.quoteVersions],
  ['report_chat_messages', schema.reportChatMessages],
  ['report_chat_sessions', schema.reportChatSessions],
  ['role_permissions', schema.rolePermissions],
  ['roles', schema.roles],
  ['sale_items', schema.saleItems],
  ['sales', schema.sales],
  ['settings', schema.settings],
  ['sso_login_tickets', schema.ssoLoginTickets],
  ['sso_providers', schema.ssoProviders],
  ['sso_states', schema.ssoStates],
  ['supplier_invoice_items', schema.supplierInvoiceItems],
  ['supplier_invoices', schema.supplierInvoices],
  ['supplier_order_versions', schema.supplierOrderVersions],
  ['supplier_quote_attachments', schema.supplierQuoteAttachments],
  ['supplier_quote_items', schema.supplierQuoteItems],
  ['supplier_quotes', schema.supplierQuotes],
  ['supplier_quote_versions', schema.supplierQuoteVersions],
  ['supplier_sale_items', schema.supplierSaleItems],
  ['supplier_sales', schema.supplierSales],
  ['suppliers', schema.suppliers],
  ['tasks', schema.tasks],
  ['time_entries', schema.timeEntries],
  ['user_clients', schema.userClients],
  ['user_projects', schema.userProjects],
  ['user_roles', schema.userRoles],
  ['user_tasks', schema.userTasks],
  ['users', schema.users],
  ['user_work_units', schema.userWorkUnits],
  ['work_unit_managers', schema.workUnitManagers],
  ['work_units', schema.workUnits],
] satisfies readonly (readonly [string, PgTable])[];

export const schemaReadinessProbes = schemaReadinessTables.map(
  ([name, table]): DbReadinessProbe => ({
    name,
    run: (exec) => exec.select().from(table).limit(0),
  }),
);

const countMigrationFiles = (dir: string): number =>
  readdirSync(dir).filter((fileName) => /^\d+_.+\.sql$/.test(fileName)).length;

const parseMigrationCount = (value: string | number | bigint | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Unexpected Drizzle migration count value: ${String(value)}`);
};

export const verifyDbReadiness = async (
  options: VerifyDbReadinessOptions = {},
): Promise<DbReadinessResult> => {
  const exec = options.exec ?? db;
  const expectedMigrations = countMigrationFiles(options.migrationsDir ?? migrationsFolder);
  const probes = options.probes ?? schemaReadinessProbes;

  await executeRows(exec, sql`SELECT 1 AS ok`);

  const migrationRows = await executeRows<MigrationCountRow>(
    exec,
    sql`SELECT COUNT(*) AS "appliedCount" FROM drizzle.__drizzle_migrations`,
  );
  const appliedMigrations = parseMigrationCount(migrationRows[0]?.appliedCount);

  if (appliedMigrations < expectedMigrations) {
    throw new Error(
      `Database migrations incomplete. Applied ${appliedMigrations} of ${expectedMigrations} migration files.`,
    );
  }

  const probedTables = await Promise.all(
    probes.map(async (probe) => {
      try {
        await probe.run(exec);
        return probe.name;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Database schema probe failed for ${probe.name}: ${message}`, {
          cause: err,
        });
      }
    }),
  );

  return { appliedMigrations, expectedMigrations, probedTables };
};
