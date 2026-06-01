import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { projects } from '../db/schema/projects.ts';
import {
  type BillingFrequency,
  type BillingType,
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  normalizeBillingFrequency,
  type StoredBillingType,
} from '../utils/billing.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { ForeignKeyError } from '../utils/http-errors.ts';
import { numericForDb, parseNullableDbNumber } from '../utils/parse.ts';
import {
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
} from './userAssignmentsRepo.ts';

export type Project = {
  id: string;
  name: string;
  clientId: string;
  description: string | null;
  isDisabled: boolean;
  createdAt: number;
  orderId: string | null;
  offerId: string | null;
  startDate: string | null;
  endDate: string | null;
  revenue: number | null;
  billingType: BillingType;
  billingFrequency: BillingFrequency;
};

const mapRow = (row: typeof projects.$inferSelect): Project => ({
  id: row.id,
  name: row.name,
  clientId: row.clientId,
  description: row.description,
  isDisabled: row.isDisabled ?? false,
  // `created_at` has DEFAULT CURRENT_TIMESTAMP but is technically nullable in the schema;
  // `?? 0` is a TS-strict appeasement for the unreachable branch.
  createdAt: row.createdAt?.getTime() ?? 0,
  orderId: row.orderId,
  offerId: row.offerId,
  startDate: row.startDate ?? null,
  endDate: row.endDate ?? null,
  revenue: parseNullableDbNumber(row.revenue),
  billingType: row.billingType ?? DEFAULT_BILLING_TYPE,
  billingFrequency: row.billingFrequency ?? DEFAULT_BILLING_FREQUENCY,
});

type ProjectRawRow = {
  id: string;
  name: string;
  client_id: string;
  description: string | null;
  is_disabled: boolean | null;
  created_at: string | Date | null;
  order_id: string | null;
  offer_id: string | null;
  start_date: string | null;
  end_date: string | null;
  revenue: string | number | null;
  billing_type: BillingType | null;
  billing_frequency: BillingFrequency | null;
};

const derivedBillingTypeSql = sql`CASE
  WHEN EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.project_id = p.id AND t.billing_type <> p.billing_type
  )
  OR (
    SELECT COUNT(DISTINCT t2.billing_type) FROM tasks t2 WHERE t2.project_id = p.id
  ) > 1
  THEN 'mixed'
  ELSE p.billing_type
END`;

const mapRawRow = (row: ProjectRawRow): Project => ({
  id: row.id,
  name: row.name,
  clientId: row.client_id,
  description: row.description,
  isDisabled: row.is_disabled ?? false,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
  orderId: row.order_id,
  offerId: row.offer_id,
  startDate: row.start_date,
  endDate: row.end_date,
  revenue: parseNullableDbNumber(row.revenue),
  billingType: row.billing_type ?? DEFAULT_BILLING_TYPE,
  billingFrequency: row.billing_frequency ?? DEFAULT_BILLING_FREQUENCY,
});

const projectSelectSql = sql`p.id, p.name, p.client_id, p.description, p.is_disabled, p.created_at, p.order_id,
       p.offer_id, p.start_date::text AS start_date, p.end_date::text AS end_date, p.revenue,
       ${derivedBillingTypeSql} AS billing_type, p.billing_frequency`;

export const listAll = async (exec: DbExecutor = db): Promise<Project[]> => {
  const rows = await executeRows<ProjectRawRow>(
    exec,
    sql`SELECT ${projectSelectSql}
          FROM projects p
         ORDER BY p.name`,
  );
  return rows.map(mapRawRow);
};

export const listForUser = async (userId: string, exec: DbExecutor = db): Promise<Project[]> => {
  const rows = await executeRows<ProjectRawRow>(
    exec,
    sql`SELECT ${projectSelectSql}
       FROM projects p
       INNER JOIN user_projects up ON p.id = up.project_id
      WHERE up.user_id = ${userId}
      ORDER BY p.name`,
  );
  return rows.map(mapRawRow);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<Project | null> => {
  const rows = await executeRows<ProjectRawRow>(
    exec,
    sql`SELECT ${projectSelectSql}
          FROM projects p
         WHERE p.id = ${id}
         LIMIT 1`,
  );
  return rows[0] ? mapRawRow(rows[0]) : null;
};

export const listByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<Map<string, Project>> => {
  if (ids.length === 0) return new Map();

  const rows = await executeRows<ProjectRawRow>(
    exec,
    sql`SELECT ${projectSelectSql}
          FROM projects p
         WHERE p.id = ANY(${sql.param(ids)}::text[])
         ORDER BY p.name`,
  );
  return new Map(rows.map((row) => [row.id, mapRawRow(row)]));
};

/**
 * Resolve project + client display tuples for a set of project ids in one query.
 * Used by the recurring time-entry generator to populate the denormalized `client_name`
 * / `project_name` columns on `time_entries` without N round-trips.
 */
export const listNamesByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<Map<string, { projectName: string; clientId: string; clientName: string }>> => {
  if (ids.length === 0) return new Map();
  const rows = await executeRows<{
    id: string;
    name: string;
    client_id: string;
    client_name: string;
  }>(
    exec,
    sql`SELECT p.id, p.name, p.client_id, c.name AS client_name
          FROM projects p
          INNER JOIN clients c ON c.id = p.client_id
         WHERE p.id = ANY(${sql.param(ids)}::text[])`,
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { projectName: row.name, clientId: row.client_id, clientName: row.client_name },
    ]),
  );
};

export const findClientId = async (id: string, exec: DbExecutor = db): Promise<string | null> => {
  const rows = await exec
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, id));
  return rows[0]?.clientId ?? null;
};

export const findClientIdAndName = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ clientId: string; name: string } | null> => {
  const rows = await exec
    .select({ clientId: projects.clientId, name: projects.name })
    .from(projects)
    .where(eq(projects.id, id));
  return rows[0] ?? null;
};

export const lockClientIdById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, id))
    .for('update');
  return rows[0]?.clientId ?? null;
};

export const lockNameAndClientById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ name: string; clientId: string } | null> => {
  const rows = await exec
    .select({ name: projects.name, clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, id))
    .for('update');
  return rows[0] ?? null;
};

export type NewProject = {
  id: string;
  name: string;
  clientId: string;
  description: string | null;
  isDisabled: boolean;
  orderId?: string | null;
  offerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  revenue?: number | null;
  billingType?: StoredBillingType;
  billingFrequency?: BillingFrequency;
};

// Legacy auto-generated name from schema.sql, plus the canonical Drizzle name produced by
// `.references(() => sales.id)`. The migration renames the constraint to the latter, but old
// DBs that haven't been migrated yet still surface the former at runtime.
const PROJECT_ORDER_FK_CONSTRAINTS = new Set<string | undefined>([
  'projects_order_id_fkey',
  'projects_order_id_sales_id_fk',
]);
const PROJECT_OFFER_FK_CONSTRAINT = 'projects_offer_id_customer_offers_id_fk';

export const create = async (project: NewProject, exec: DbExecutor = db): Promise<Project> => {
  try {
    const rows = await exec
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        clientId: project.clientId,
        description: project.description,
        isDisabled: project.isDisabled,
        orderId: project.orderId ?? null,
        offerId: project.offerId ?? null,
        startDate: project.startDate ?? null,
        endDate: project.endDate ?? null,
        revenue: numericForDb(project.revenue),
        billingType: project.billingType ?? DEFAULT_BILLING_TYPE,
        billingFrequency: normalizeBillingFrequency(
          project.billingType ?? DEFAULT_BILLING_TYPE,
          project.billingFrequency,
        ),
      })
      .returning();
    return (await findById(project.id, exec)) ?? mapRow(rows[0]);
  } catch (err) {
    const fk = getForeignKeyViolation(err);
    if (fk) {
      if (PROJECT_ORDER_FK_CONSTRAINTS.has(fk.constraint))
        throw new ForeignKeyError('Linked order');
      if (fk.constraint === PROJECT_OFFER_FK_CONSTRAINT) throw new ForeignKeyError('Linked offer');
      throw new ForeignKeyError('Client');
    }
    throw err;
  }
};

export type ProjectUpdate = {
  name?: string | null;
  clientId?: string | null;
  description?: string | null;
  isDisabled?: boolean;
  orderId?: string | null;
  offerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  revenue?: number | null;
  billingType?: StoredBillingType | null;
  billingFrequency?: BillingFrequency | null;
};

export const update = async (
  id: string,
  patch: ProjectUpdate,
  exec: DbExecutor = db,
): Promise<Project | null> => {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled;
  if (patch.orderId !== undefined) set.orderId = patch.orderId;
  if (patch.offerId !== undefined) set.offerId = patch.offerId;
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.endDate !== undefined) set.endDate = patch.endDate;
  if (patch.revenue !== undefined) {
    set.revenue = numericForDb(patch.revenue);
  }
  if (patch.billingType !== undefined) {
    const nextBillingType = patch.billingType ?? DEFAULT_BILLING_TYPE;
    set.billingType = nextBillingType;
    set.billingFrequency = normalizeBillingFrequency(nextBillingType, patch.billingFrequency);
  } else if (patch.billingFrequency !== undefined) {
    const currentRows = await exec
      .select({ billingType: projects.billingType })
      .from(projects)
      .where(eq(projects.id, id));
    set.billingFrequency = normalizeBillingFrequency(
      currentRows[0]?.billingType ?? DEFAULT_BILLING_TYPE,
      patch.billingFrequency,
    );
  }

  if (Object.keys(set).length === 0) {
    return findById(id, exec);
  }

  try {
    const rows = await exec.update(projects).set(set).where(eq(projects.id, id)).returning();
    return rows[0] ? ((await findById(id, exec)) ?? mapRow(rows[0])) : null;
  } catch (err) {
    const fk = getForeignKeyViolation(err);
    if (fk) {
      if (PROJECT_ORDER_FK_CONSTRAINTS.has(fk.constraint))
        throw new ForeignKeyError('Linked order');
      if (fk.constraint === PROJECT_OFFER_FK_CONSTRAINT) throw new ForeignKeyError('Linked offer');
      throw new ForeignKeyError('Client');
    }
    throw err;
  }
};

export const findDateRangeById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ startDate: string | null; endDate: string | null } | null> => {
  const rows = await exec
    .select({ startDate: projects.startDate, endDate: projects.endDate })
    .from(projects)
    .where(eq(projects.id, id));
  return rows[0] ?? null;
};

export const findClientLinksById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ orderId: string | null; offerId: string | null } | null> => {
  const rows = await exec
    .select({ orderId: projects.orderId, offerId: projects.offerId })
    .from(projects)
    .where(eq(projects.id, id));
  return rows[0] ?? null;
};

export const findBillingById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ billingType: StoredBillingType; billingFrequency: BillingFrequency } | null> => {
  const rows = await exec
    .select({
      billingType: projects.billingType,
      billingFrequency: projects.billingFrequency,
    })
    .from(projects)
    .where(eq(projects.id, id));
  return rows[0] ?? null;
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(projects).where(eq(projects.id, id));
};

export const findAssignedUserIds = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await executeRows<{ user_id: string }>(
    exec,
    sql`SELECT user_id FROM user_projects WHERE project_id = ${projectId}`,
  );
  return rows.map((r) => r.user_id);
};

export const findNonTopManagerUserIds = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await executeRows<{ user_id: string }>(
    exec,
    sql`SELECT user_id FROM user_projects
        WHERE project_id = ${projectId} AND assignment_source != ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}`,
  );
  return rows.map((r) => r.user_id);
};

export const clearNonTopManagerAssignments = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await executeRows(
    exec,
    sql`DELETE FROM user_projects
        WHERE project_id = ${projectId} AND assignment_source != ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}`,
  );
};

export const addManualAssignments = async (
  projectId: string,
  userIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await executeRows(
    exec,
    sql`INSERT INTO user_projects (user_id, project_id, assignment_source)
        SELECT unnest(${sql.param(userIds)}::text[]), ${projectId}, ${MANUAL_ASSIGNMENT_SOURCE}
        ON CONFLICT DO NOTHING`,
  );
};

export const ensureClientCascadeAssignments = async (
  userIds: string[],
  clientId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await executeRows(
    exec,
    sql`INSERT INTO user_clients (user_id, client_id, assignment_source)
        SELECT unnest(${sql.param(userIds)}::text[]), ${clientId}, ${PROJECT_CASCADE_ASSIGNMENT_SOURCE}
        ON CONFLICT DO NOTHING`,
  );
};

export const removeClientCascadeForUsersIfUnused = async (
  userIds: string[],
  clientId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await executeRows(
    exec,
    sql`DELETE FROM user_clients uc
        WHERE uc.user_id = ANY(${sql.param(userIds)}::text[])
          AND uc.client_id = ${clientId}
          AND uc.assignment_source = ${PROJECT_CASCADE_ASSIGNMENT_SOURCE}
          AND NOT EXISTS (
            SELECT 1 FROM user_projects up
            INNER JOIN projects p ON up.project_id = p.id
            WHERE up.user_id = uc.user_id AND p.client_id = ${clientId}
          )`,
  );
};
