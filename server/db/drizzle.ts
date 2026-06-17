import type { ExtractTablesWithRelations, SQL } from 'drizzle-orm';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pool from './index.ts';
import * as auditLogsSchema from './schema/auditLogs.ts';
import * as clientProfileOptionsSchema from './schema/clientProfileOptions.ts';
import * as clientsSchema from './schema/clients.ts';
import * as customerOfferItemsSchema from './schema/customerOfferItems.ts';
import * as customerOffersSchema from './schema/customerOffers.ts';
import * as documentCodesSchema from './schema/documentCodes.ts';
import * as emailConfigSchema from './schema/emailConfig.ts';
import * as generalSettingsSchema from './schema/generalSettings.ts';
import * as invoicesSchema from './schema/invoices.ts';
import * as ldapConfigSchema from './schema/ldapConfig.ts';
import * as mcpTokensSchema from './schema/mcpTokens.ts';
import * as notificationsSchema from './schema/notifications.ts';
import * as offerVersionsSchema from './schema/offerVersions.ts';
import * as orderVersionsSchema from './schema/orderVersions.ts';
import * as overtimeNotificationEventsSchema from './schema/overtimeNotificationEvents.ts';
import * as personalAccessTokensSchema from './schema/personalAccessTokens.ts';
import * as productCategoriesSchema from './schema/productCategories.ts';
import * as productSubcategoriesSchema from './schema/productSubcategories.ts';
import * as productsSchema from './schema/products.ts';
import * as productTypesSchema from './schema/productTypes.ts';
import * as projectRulesSchema from './schema/projectRules.ts';
import * as projectsSchema from './schema/projects.ts';
import * as quoteCommunicationChannelsSchema from './schema/quoteCommunicationChannels.ts';
import * as quotesSchema from './schema/quotes.ts';
import * as quoteVersionsSchema from './schema/quoteVersions.ts';
import * as reportChatMessagesSchema from './schema/reportChatMessages.ts';
import * as reportChatSessionsSchema from './schema/reportChatSessions.ts';
import * as rolesSchema from './schema/roles.ts';
import * as salesSchema from './schema/sales.ts';
import * as savedViewsSchema from './schema/savedViews.ts';
import * as settingsSchema from './schema/settings.ts';
import * as ssoSchema from './schema/sso.ts';
import * as ssoProvidersSchema from './schema/ssoProviders.ts';
import * as supplierInvoicesSchema from './schema/supplierInvoices.ts';
import * as supplierOrderVersionsSchema from './schema/supplierOrderVersions.ts';
import * as supplierQuoteAttachmentsSchema from './schema/supplierQuoteAttachments.ts';
import * as supplierQuotesSchema from './schema/supplierQuotes.ts';
import * as supplierQuoteVersionsSchema from './schema/supplierQuoteVersions.ts';
import * as supplierSalesSchema from './schema/supplierSales.ts';
import * as suppliersSchema from './schema/suppliers.ts';
import * as tasksSchema from './schema/tasks.ts';
import * as timeEntriesSchema from './schema/timeEntries.ts';
import * as usersSchema from './schema/users.ts';
import * as userRolesSchema from './schema/userRoles.ts';
import * as userWorkUnitsSchema from './schema/userWorkUnits.ts';
import * as webhooksSchema from './schema/webhooks.ts';
import * as workUnitManagersSchema from './schema/workUnitManagers.ts';
import * as workUnitsSchema from './schema/workUnits.ts';

export const schema = {
  ...auditLogsSchema,
  ...clientProfileOptionsSchema,
  ...clientsSchema,
  ...customerOfferItemsSchema,
  ...customerOffersSchema,
  ...documentCodesSchema,
  ...emailConfigSchema,
  ...generalSettingsSchema,
  ...invoicesSchema,
  ...ldapConfigSchema,
  ...mcpTokensSchema,
  ...notificationsSchema,
  ...overtimeNotificationEventsSchema,
  ...offerVersionsSchema,
  ...orderVersionsSchema,
  ...personalAccessTokensSchema,
  ...productCategoriesSchema,
  ...productSubcategoriesSchema,
  ...productsSchema,
  ...productTypesSchema,
  ...quoteCommunicationChannelsSchema,
  ...projectRulesSchema,
  ...projectsSchema,
  ...quotesSchema,
  ...quoteVersionsSchema,
  ...reportChatMessagesSchema,
  ...reportChatSessionsSchema,
  ...rolesSchema,
  ...salesSchema,
  ...savedViewsSchema,
  ...settingsSchema,
  ...ssoSchema,
  ...ssoProvidersSchema,
  ...supplierInvoicesSchema,
  ...supplierOrderVersionsSchema,
  ...supplierQuoteAttachmentsSchema,
  ...supplierQuotesSchema,
  ...supplierQuoteVersionsSchema,
  ...supplierSalesSchema,
  ...suppliersSchema,
  ...tasksSchema,
  ...timeEntriesSchema,
  ...usersSchema,
  ...userRolesSchema,
  ...userWorkUnitsSchema,
  ...webhooksSchema,
  ...workUnitManagersSchema,
  ...workUnitsSchema,
} as const;

export const db = drizzle(pool, { schema });

export type DbExecutor = PgDatabase<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type DbTransactionConfig = {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
  accessMode?: 'read only' | 'read write';
  deferrable?: boolean;
};

// Wraps a Drizzle transaction so the callback receives a `tx` typed as `DbExecutor`. Routes
// call this when they need to compose multiple repo calls atomically:
//
//   await withDbTransaction(async (tx) => {
//     await fooRepo.create(input, tx);
//     await barRepo.update(input, tx);
//   });
//
// The `tx as unknown as DbExecutor` cast bridges Drizzle's `PgTransaction` and `PgDatabase`
// types - both implement the same query-builder surface (`select`, `insert`, `update`,
// `delete`, `execute`, `transaction` for nesting) that `DbExecutor` exposes, but the two
// classes don't share a nominal supertype that includes both, so TS rejects the direct cast.
// The `unknown` step is a structural-equivalence assertion, not a load-bearing contract.
export const withDbTransaction = <T>(
  callback: (tx: DbExecutor) => Promise<T>,
  config?: DbTransactionConfig,
): Promise<T> => db.transaction((tx) => callback(tx as unknown as DbExecutor), config);

// Run `cb` inside a transaction only when the caller has not already supplied one.
// Repos call this in DELETE-then-INSERT paths so a failing INSERT rolls back the prior
// DELETE on the default pool; when the caller passes their own `exec` (an open `tx` from
// `withDbTransaction`), the existing scope is reused and nesting is avoided.
export const runAtomically = <T>(
  exec: DbExecutor,
  cb: (tx: DbExecutor) => Promise<T>,
): Promise<T> => (exec === db ? withDbTransaction(cb) : cb(exec));

// `exec.execute(sql)` returns either `{ rows }` (real pg driver) or a bare array (some test
// adapters). Normalize so callers always get `T[]`. Throws on an unrecognized shape so a
// driver/adapter mismatch surfaces loudly instead of silently returning empty rows.
export const executeRows = async <T>(exec: DbExecutor, query: SQL): Promise<T[]> => {
  const result = await exec.execute(query);
  const rows = (result as { rows?: T[] }).rows;
  if (Array.isArray(rows)) return rows;
  if (Array.isArray(result)) return result as T[];
  // Include diagnostic context so a driver upgrade or test-fake misconfig is debuggable
  // from the stack trace alone.
  const resultType = result === null ? 'null' : typeof result;
  const hasRowsKey = result !== null && typeof result === 'object' && 'rows' in result;
  throw new Error(
    `executeRows: unexpected result shape from exec.execute (resultType=${resultType}, hasRowsKey=${hasRowsKey}, rowsType=${typeof rows})`,
  );
};
