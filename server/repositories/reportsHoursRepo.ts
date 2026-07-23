import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { roundCurrency } from '../utils/invoice-math.ts';
import { parseDbNumber, toDbText } from '../utils/parse.ts';
import { derivedBillingTypeSql } from './projectsRepo.ts';
import { tasksT, timeEntriesTasksJoin } from './tasksRepo.ts';

const parseCost = (value: string | number | null | undefined): number =>
  roundCurrency(parseDbNumber(value, 0));

// Raw SQL via `executeRows` bypasses Drizzle's typed null-handling - `toDbText` (trim + ''
// fallback) is applied manually so stray whitespace doesn't render awkward cells in the UI.

type ProjectRow = {
  id: string;
  name: string | null;
  client_id: string | null;
  client_name: string | null;
  description: string | null;
  order_id?: string | null;
  offer_id?: string | null;
  start_date: string | null;
  end_date: string | null;
  revenue?: string | number | null;
  billing_type: string | null;
  billing_frequency: string | null;
  status: string | null;
  tipo: string | null;
  is_disabled: boolean | null;
};

type TaskRow = {
  id: string;
  name: string | null;
  project_id: string | null;
  project_name: string | null;
  is_disabled: boolean | null;
  is_recurring: boolean | null;
  recurrence_pattern: string | null;
  description: string | null;
  recurrence_start: string | null;
  recurrence_end: string | null;
  recurrence_duration: string | number | null;
  revenue: string | number | null;
  duration: string | number | null;
  billing_type: string | null;
  billing_frequency: string | null;
  monthly_effort: string | number | null;
};

export type TimesheetsSectionOptions = {
  fromDate: string;
  toDate: string;
  allowedTimesheetUserIds: string[] | null;
  topLimit: number;
};

export type TimesheetsSection = {
  totals: { hours: number; entryCount: number; cost: number; avgEntryHours: number };
  byMonth: Array<{ label: string; hours: number; entryCount: number; cost: number }>;
  byLocation: Array<{ location: string; hours: number; entryCount: number }>;
  topHoursByUser: Array<{ label: string; value: number; entryCount: number }>;
  topHoursByClient: Array<{ label: string; value: number; entryCount: number }>;
  topHoursByProject: Array<{ label: string; value: number; entryCount: number }>;
  topHoursByTask: Array<{ label: string; value: number; entryCount: number }>;
};

export const getTimesheetsSection = async (
  opts: TimesheetsSectionOptions,
  exec: DbExecutor = db,
): Promise<TimesheetsSection> => {
  const { fromDate, toDate, allowedTimesheetUserIds, topLimit } = opts;
  // Date-range filter shared by every query; binds 2 or 3 positional params depending on whether
  // user-scoping is active. Top-N queries append a LIMIT param after this clause's params.
  // `sql.param()` forces the array to bind as a single Postgres parameter - without it, a JS
  // array embedded directly in a `sql` template would be expanded into `(item1, item2, ...)`,
  // which doesn't match the `ANY($N)` shape we want.
  const baseWhere = allowedTimesheetUserIds
    ? sql`WHERE te.date >= ${fromDate} AND te.date <= ${toDate} AND te.user_id = ANY(${sql.param(allowedTimesheetUserIds)})`
    : sql`WHERE te.date >= ${fromDate} AND te.date <= ${toDate}`;

  const [totals, topUsers, topClients, topProjects, topTasks, byMonth, byLocation] =
    await Promise.all([
      executeRows<{ hours: string; entry_count: string; total_cost: string }>(
        exec,
        sql`SELECT
          COALESCE(SUM(te.duration), 0) as hours,
          COUNT(*) as entry_count,
          COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as total_cost
         FROM time_entries te
         ${baseWhere}`,
      ),
      executeRows<{ label: string; value: string; entry_count: string }>(
        exec,
        sql`SELECT
          u.name as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         JOIN users u ON u.id = te.user_id
         ${baseWhere}
        GROUP BY u.name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
      ),
      executeRows<{ label: string; value: string; entry_count: string }>(
        exec,
        sql`SELECT
          te.client_name as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere}
        GROUP BY te.client_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
      ),
      executeRows<{ label: string; value: string; entry_count: string }>(
        exec,
        sql`SELECT
          te.project_name as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere}
        GROUP BY te.project_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
      ),
      executeRows<{ label: string; value: string; entry_count: string }>(
        exec,
        sql`SELECT
          te.task as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere}
        GROUP BY te.task
        ORDER BY value DESC
        LIMIT ${topLimit}`,
      ),
      executeRows<{
        label: string;
        hours: string;
        entry_count: string;
        total_cost: string;
      }>(
        exec,
        sql`SELECT
          TO_CHAR(DATE_TRUNC('month', te.date), 'YYYY-MM') as label,
          COALESCE(SUM(te.duration), 0) as hours,
          COUNT(*) as entry_count,
          COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as total_cost
         FROM time_entries te
         ${baseWhere}
        GROUP BY DATE_TRUNC('month', te.date)
        ORDER BY label ASC`,
      ),
      executeRows<{ location: string; hours: string; entry_count: string }>(
        exec,
        sql`SELECT
          COALESCE(NULLIF(te.location, ''), 'unknown') as location,
          COALESCE(SUM(te.duration), 0) as hours,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere}
        GROUP BY COALESCE(NULLIF(te.location, ''), 'unknown')
        ORDER BY hours DESC`,
      ),
    ]);

  const totalHours = parseDbNumber(totals[0]?.hours, 0);
  const totalEntries = parseDbNumber(totals[0]?.entry_count, 0);

  const mapTopRow = (r: { label: string; value: string; entry_count: string }) => ({
    label: toDbText(r.label),
    value: parseDbNumber(r.value, 0),
    entryCount: parseDbNumber(r.entry_count, 0),
  });

  return {
    totals: {
      hours: totalHours,
      entryCount: totalEntries,
      cost: parseCost(totals[0]?.total_cost),
      avgEntryHours: totalEntries > 0 ? totalHours / totalEntries : 0,
    },
    byMonth: byMonth.map((r) => ({
      label: toDbText(r.label),
      hours: parseDbNumber(r.hours, 0),
      entryCount: parseDbNumber(r.entry_count, 0),
      cost: parseCost(r.total_cost),
    })),
    byLocation: byLocation.map((r) => ({
      location: toDbText(r.location),
      hours: parseDbNumber(r.hours, 0),
      entryCount: parseDbNumber(r.entry_count, 0),
    })),
    topHoursByUser: topUsers.map(mapTopRow),
    topHoursByClient: topClients.map(mapTopRow),
    topHoursByProject: topProjects.map(mapTopRow),
    topHoursByTask: topTasks.map(mapTopRow),
  };
};

export type ProjectsSectionOptions = {
  viewerId: string;
  fromDate: string;
  toDate: string;
  canViewAllProjects: boolean;
  canViewProjectDetails: boolean;
  canViewTimesheets: boolean;
  canViewAllTimesheets: boolean;
  allowedTimesheetUserIds: string[] | null;
  itemsLimit: number;
  topLimit: number;
};

export type ProjectInfo = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  description: string;
  orderId?: string;
  offerId?: string;
  startDate: string;
  endDate: string;
  revenue?: number;
  billingType: string;
  billingFrequency: string;
  status: string;
  type: string;
  isDisabled: boolean;
};

export type ProjectsSection = {
  count: number;
  activeCount: number;
  disabledCount: number;
  items: ProjectInfo[];
  topByHours: Array<{ label: string; value: number; cost: number }>;
  topByCost: Array<{ label: string; value: number; hours: number }>;
};

export const getProjectsSection = async (
  opts: ProjectsSectionOptions,
  exec: DbExecutor = db,
): Promise<ProjectsSection> => {
  const {
    viewerId,
    fromDate,
    toDate,
    canViewAllProjects,
    canViewProjectDetails,
    canViewTimesheets,
    canViewAllTimesheets,
    allowedTimesheetUserIds,
    itemsLimit,
    topLimit,
  } = opts;
  const commercialProjectFieldsSql = canViewProjectDetails
    ? sql`p.order_id, p.offer_id, p.revenue,`
    : sql``;

  const summaryQuery = canViewAllProjects
    ? executeRows<{ count: string; disabled_count: string }>(
        exec,
        sql`SELECT
            COUNT(*) as count,
            SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count
           FROM projects`,
      )
    : executeRows<{ count: string; disabled_count: string }>(
        exec,
        sql`SELECT
            COUNT(*) as count,
            SUM(CASE WHEN p.is_disabled THEN 1 ELSE 0 END) as disabled_count
           FROM projects p
           JOIN user_projects up ON up.project_id = p.id
          WHERE up.user_id = ${viewerId}`,
      );

  const itemsQuery = canViewAllProjects
    ? executeRows<ProjectRow>(
        exec,
        sql`SELECT
            p.id,
            p.name,
            p.client_id,
            c.name as client_name,
            p.description,
            ${commercialProjectFieldsSql}
            p.start_date,
            p.end_date,
            ${derivedBillingTypeSql} AS billing_type,
            p.billing_frequency,
            p.status,
            p.tipo,
            p.is_disabled
           FROM projects p
           JOIN clients c ON c.id = p.client_id
          ORDER BY p.name ASC
          LIMIT ${itemsLimit}`,
      )
    : executeRows<ProjectRow>(
        exec,
        sql`SELECT
            p.id,
            p.name,
            p.client_id,
            c.name as client_name,
            p.description,
            ${commercialProjectFieldsSql}
            p.start_date,
            p.end_date,
            ${derivedBillingTypeSql} AS billing_type,
            p.billing_frequency,
            p.status,
            p.tipo,
            p.is_disabled
           FROM projects p
           JOIN clients c ON c.id = p.client_id
           JOIN user_projects up ON up.project_id = p.id
          WHERE up.user_id = ${viewerId}
          ORDER BY p.name ASC
          LIMIT ${itemsLimit}`,
      );

  // Per-project hours come from time_entries; user/project scoping toggles a JOIN and two
  // optional WHERE-clause filters. The promise stays null when the viewer can't see any
  // timesheets - caller falls back to [].
  const projectScopeJoin = canViewAllProjects
    ? sql``
    : sql`JOIN user_projects up ON up.project_id = te.project_id`;
  const userScopeFilter = canViewAllTimesheets
    ? sql``
    : sql`AND te.user_id = ANY(${sql.param(allowedTimesheetUserIds || [])})`;
  const viewerScopeFilter = canViewAllProjects ? sql`` : sql`AND up.user_id = ${viewerId}`;

  const projectHoursQuery = canViewTimesheets
    ? executeRows<{ label: string; hours: string; cost: string }>(
        exec,
        sql`SELECT
            te.project_name as label,
            COALESCE(SUM(te.duration), 0) as hours,
            COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as cost
           FROM time_entries te
           ${projectScopeJoin}
          WHERE te.date >= ${fromDate}
            AND te.date <= ${toDate}
            ${userScopeFilter}
            ${viewerScopeFilter}
          GROUP BY te.project_name`,
      )
    : null;

  const [summaryRows, itemsRows, hoursRows] = await Promise.all([
    summaryQuery,
    itemsQuery,
    projectHoursQuery,
  ]);

  const projectStats = hoursRows
    ? hoursRows.map((r) => ({
        label: toDbText(r.label),
        hours: parseDbNumber(r.hours, 0),
        cost: parseCost(r.cost),
      }))
    : [];
  const topByHours = projectStats
    .toSorted((a, b) => b.hours - a.hours)
    .slice(0, topLimit)
    .map(({ label, hours, cost }) => ({ label, value: hours, cost }));
  const topByCost = projectStats
    .toSorted((a, b) => b.cost - a.cost)
    .slice(0, topLimit)
    .map(({ label, hours, cost }) => ({ label, value: cost, hours }));

  const projectCount = parseDbNumber(summaryRows[0]?.count, 0);
  const disabledCount = parseDbNumber(summaryRows[0]?.disabled_count, 0);
  return {
    count: projectCount,
    activeCount: Math.max(projectCount - disabledCount, 0),
    disabledCount,
    items: itemsRows.map((r) => ({
      id: toDbText(r.id),
      name: toDbText(r.name),
      clientId: toDbText(r.client_id),
      clientName: toDbText(r.client_name),
      description: toDbText(r.description),
      ...(canViewProjectDetails
        ? {
            orderId: toDbText(r.order_id),
            offerId: toDbText(r.offer_id),
            revenue: parseDbNumber(r.revenue, 0),
          }
        : {}),
      startDate: toDbText(r.start_date),
      endDate: toDbText(r.end_date),
      billingType: toDbText(r.billing_type),
      billingFrequency: toDbText(r.billing_frequency),
      status: toDbText(r.status),
      type: toDbText(r.tipo),
      isDisabled: Boolean(r.is_disabled),
    })),
    topByHours,
    topByCost,
  };
};

export type TasksSectionOptions = {
  viewerId: string;
  fromDate: string;
  toDate: string;
  canViewAllTasks: boolean;
  canViewTimesheets: boolean;
  canViewAllTimesheets: boolean;
  allowedTimesheetUserIds: string[] | null;
  itemsLimit: number;
  topLimit: number;
};

export type TaskInfo = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  isDisabled: boolean;
  isRecurring: boolean;
  recurrencePattern: string;
  description: string;
  recurrenceStart: string;
  recurrenceEnd: string;
  recurrenceDuration: number;
  expectedEffort: number;
  revenue: number;
  duration: number;
  billingType: string;
  billingFrequency: string;
  monthlyEffort: number;
};

export type TasksSection = {
  count: number;
  activeCount: number;
  disabledCount: number;
  recurringCount: number;
  items: TaskInfo[];
  topByHours: Array<{ label: string; value: number; entryCount: number }>;
};

export const getTasksSection = async (
  opts: TasksSectionOptions,
  exec: DbExecutor = db,
): Promise<TasksSection> => {
  const {
    viewerId,
    fromDate,
    toDate,
    canViewAllTasks,
    canViewTimesheets,
    canViewAllTimesheets,
    allowedTimesheetUserIds,
    itemsLimit,
    topLimit,
  } = opts;

  const summaryQuery = canViewAllTasks
    ? executeRows<{ count: string; disabled_count: string; recurring_count: string }>(
        exec,
        sql`SELECT
            COUNT(*) as count,
            SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count,
            SUM(CASE WHEN is_recurring THEN 1 ELSE 0 END) as recurring_count
           FROM tasks`,
      )
    : executeRows<{ count: string; disabled_count: string; recurring_count: string }>(
        exec,
        sql`SELECT
            COUNT(*) as count,
            SUM(CASE WHEN t.is_disabled THEN 1 ELSE 0 END) as disabled_count,
            SUM(CASE WHEN t.is_recurring THEN 1 ELSE 0 END) as recurring_count
           FROM tasks t
           JOIN user_tasks ut ON ut.task_id = t.id
          WHERE ut.user_id = ${viewerId}`,
      );

  const itemsQuery = canViewAllTasks
    ? executeRows<TaskRow>(
        exec,
        sql`SELECT
            t.id,
            t.name,
            t.project_id,
            p.name as project_name,
            t.is_disabled,
            t.is_recurring,
            t.recurrence_pattern,
            t.description,
            t.recurrence_start,
            t.recurrence_end,
            t.recurrence_duration,
            t.revenue,
            t.duration,
            t.billing_type,
            t.billing_frequency,
            t.monthly_effort
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
          ORDER BY t.name ASC
          LIMIT ${itemsLimit}`,
      )
    : executeRows<TaskRow>(
        exec,
        sql`SELECT
            t.id,
            t.name,
            t.project_id,
            p.name as project_name,
            t.is_disabled,
            t.is_recurring,
            t.recurrence_pattern,
            t.description,
            t.recurrence_start,
            t.recurrence_end,
            t.recurrence_duration,
            t.revenue,
            t.duration,
            t.billing_type,
            t.billing_frequency,
            t.monthly_effort
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
           JOIN user_tasks ut ON ut.task_id = t.id
          WHERE ut.user_id = ${viewerId}
          ORDER BY t.name ASC
          LIMIT ${itemsLimit}`,
      );

  // Top-N tasks by hours; user/task scoping toggles a JOIN block and two optional WHERE-clause
  // filters. The !canViewAllTasks JOIN uses `timeEntriesTasksJoin` so legacy entries (where
  // time_entries.task_id is NULL) still attribute to the right task by (project_id, name)
  // fallback before the user_tasks scoping JOIN runs.
  const taskScopeJoin = canViewAllTasks
    ? sql``
    : sql`${timeEntriesTasksJoin}
       JOIN user_tasks ut ON ut.task_id = ${tasksT.id}`;
  const userScopeFilter = canViewAllTimesheets
    ? sql``
    : sql`AND te.user_id = ANY(${sql.param(allowedTimesheetUserIds || [])})`;
  const viewerScopeFilter = canViewAllTasks ? sql`` : sql`AND ut.user_id = ${viewerId}`;

  const taskHoursQuery = canViewTimesheets
    ? executeRows<{ label: string; hours: string; entry_count: string }>(
        exec,
        sql`SELECT te.task as label, COALESCE(SUM(te.duration), 0) as hours, COUNT(*) as entry_count
           FROM time_entries te
           ${taskScopeJoin}
          WHERE te.date >= ${fromDate}
            AND te.date <= ${toDate}
            ${userScopeFilter}
            ${viewerScopeFilter}
          GROUP BY te.task
          ORDER BY hours DESC
          LIMIT ${topLimit}`,
      )
    : null;

  const [summaryRows, itemsRows, taskHoursRows] = await Promise.all([
    summaryQuery,
    itemsQuery,
    taskHoursQuery,
  ]);

  const topByHours = taskHoursRows
    ? taskHoursRows.map((r) => ({
        label: toDbText(r.label),
        value: parseDbNumber(r.hours, 0),
        entryCount: parseDbNumber(r.entry_count, 0),
      }))
    : [];

  const taskCount = parseDbNumber(summaryRows[0]?.count, 0);
  const disabledCount = parseDbNumber(summaryRows[0]?.disabled_count, 0);
  return {
    count: taskCount,
    activeCount: Math.max(taskCount - disabledCount, 0),
    disabledCount,
    recurringCount: parseDbNumber(summaryRows[0]?.recurring_count, 0),
    items: itemsRows.map((r) => {
      const duration = parseDbNumber(r.duration, 1);
      const monthlyEffort = parseDbNumber(r.monthly_effort, 0);
      return {
        id: toDbText(r.id),
        name: toDbText(r.name),
        projectId: toDbText(r.project_id),
        projectName: toDbText(r.project_name),
        isDisabled: Boolean(r.is_disabled),
        isRecurring: Boolean(r.is_recurring),
        recurrencePattern: toDbText(r.recurrence_pattern),
        description: toDbText(r.description),
        recurrenceStart: toDbText(r.recurrence_start),
        recurrenceEnd: toDbText(r.recurrence_end),
        recurrenceDuration: parseDbNumber(r.recurrence_duration, 0),
        expectedEffort: roundCurrency(monthlyEffort * duration),
        revenue: parseDbNumber(r.revenue, 0),
        duration,
        billingType: toDbText(r.billing_type),
        billingFrequency: toDbText(r.billing_frequency),
        monthlyEffort,
      };
    }),
    topByHours,
  };
};
