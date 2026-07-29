import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import {
  type BillingFrequency,
  type BillingType,
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
} from '../utils/billing.ts';
import { roundCurrency } from '../utils/invoice-math.ts';
import { parseNullableDbNumber } from '../utils/parse.ts';
import type { ProjectRuleField } from '../utils/projectRuleFields.ts';
import { DEFAULT_PROJECT_STATUS, type ProjectStatus } from '../utils/projectStatus.ts';
import { DEFAULT_PROJECT_TIPO, type ProjectTipo } from '../utils/projectTipo.ts';

export type ProjectRuleMetricValue = string | number | boolean | null;

export type ProjectRuleMetricPeriodScope = {
  startDate: string;
  endDate: string;
  timeZone: string;
  userIds: string[];
  taskIds: string[];
};

export type ProjectRuleMetrics = {
  projectId: string;
  projectName: string;
  clientId: string;
  description: string | null;
  isDisabled: boolean;
  createdAt: string | null;
  orderId: string | null;
  offerId: string | null;
  offerRevisionCode: string | null;
  startDate: string | null;
  endDate: string | null;
  revenue: number | null;
  billingType: BillingType;
  billingFrequency: BillingFrequency;
  status: ProjectStatus;
  tipo: ProjectTipo;
  tipoConfirmed: boolean;
  costToDate: number;
  budgetUsedPct: number | null;
  hoursToDate: number;
  daysUntilDeadline: number | null;
  daysUntilStart: number | null;
  daysSinceStart: number | null;
  tasksCount: number;
  enabledTasksCount: number;
  plannedEffortHours: number;
  monthlyEffortHours: number;
  periodHours: number;
  periodEntryCount: number;
  periodActiveUsers: number;
  periodActiveTasks: number;
  periodCost: number;
  invalidPeriodUserIds: string[];
  invalidPeriodTaskIds: string[];
};

type ProjectMetricsRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  description: string | null;
  isDisabled: boolean | null;
  createdAt: string | null;
  orderId: string | null;
  offerId: string | null;
  offerRevisionCode: string | null;
  startDate: string | null;
  endDate: string | null;
  manualRevenue: string | number | null;
  taskRevenue: string | number | null;
  billingType: BillingType | null;
  billingFrequency: BillingFrequency | null;
  status: ProjectStatus | null;
  tipo: ProjectTipo | null;
  tipoConfirmed: boolean | null;
  costToDate: string | number | null;
  hoursToDate: string | number | null;
  tasksCount: string | number | null;
  enabledTasksCount: string | number | null;
  plannedEffortHours: string | number | null;
  monthlyEffortHours: string | number | null;
  periodHours: string | number | null;
  periodEntryCount: string | number | null;
  periodActiveUsers: string | number | null;
  periodActiveTasks: string | number | null;
  periodCost: string | number | null;
  invalidPeriodUserIds: string[] | null;
  invalidPeriodTaskIds: string[] | null;
};

const MS_PER_DAY = 86_400_000;

const isoDateInTimeZone = (now: Date, timeZone?: string): string => {
  if (!timeZone) return now.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const diffCalendarDays = (date: string | null, now: Date, timeZone?: string): number | null => {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(`${isoDateInTimeZone(now, timeZone)}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
};

const resolveRevenue = (row: ProjectMetricsRow): number | null => {
  const taskRevenue = parseNullableDbNumber(row.taskRevenue) ?? 0;
  if (taskRevenue > 0) return roundCurrency(taskRevenue);
  const manualRevenue = parseNullableDbNumber(row.manualRevenue);
  return manualRevenue === null ? null : roundCurrency(manualRevenue);
};

const metricNumber = (value: string | number | null) => parseNullableDbNumber(value) ?? 0;

const mapRow = (row: ProjectMetricsRow, now: Date, timeZone?: string): ProjectRuleMetrics => {
  const revenue = resolveRevenue(row);
  const costToDate = roundCurrency(metricNumber(row.costToDate));
  const daysUntilStart = diffCalendarDays(row.startDate, now, timeZone);
  return {
    projectId: row.projectId,
    projectName: row.projectName,
    clientId: row.clientId,
    description: row.description,
    isDisabled: row.isDisabled ?? false,
    createdAt: row.createdAt,
    orderId: row.orderId,
    offerId: row.offerId,
    offerRevisionCode: row.offerRevisionCode,
    startDate: row.startDate,
    endDate: row.endDate,
    revenue,
    billingType: row.billingType ?? DEFAULT_BILLING_TYPE,
    billingFrequency: row.billingFrequency ?? DEFAULT_BILLING_FREQUENCY,
    status: row.status ?? DEFAULT_PROJECT_STATUS,
    tipo: row.tipo ?? DEFAULT_PROJECT_TIPO,
    tipoConfirmed: row.tipoConfirmed ?? false,
    costToDate,
    budgetUsedPct: revenue && revenue > 0 ? Math.round((costToDate / revenue) * 100) : null,
    hoursToDate: metricNumber(row.hoursToDate),
    daysUntilDeadline: diffCalendarDays(row.endDate, now, timeZone),
    daysUntilStart,
    daysSinceStart: daysUntilStart === null ? null : -daysUntilStart,
    tasksCount: metricNumber(row.tasksCount),
    enabledTasksCount: metricNumber(row.enabledTasksCount),
    plannedEffortHours: metricNumber(row.plannedEffortHours),
    monthlyEffortHours: metricNumber(row.monthlyEffortHours),
    periodHours: metricNumber(row.periodHours),
    periodEntryCount: metricNumber(row.periodEntryCount),
    periodActiveUsers: metricNumber(row.periodActiveUsers),
    periodActiveTasks: metricNumber(row.periodActiveTasks),
    periodCost: roundCurrency(metricNumber(row.periodCost)),
    invalidPeriodUserIds: row.invalidPeriodUserIds ?? [],
    invalidPeriodTaskIds: row.invalidPeriodTaskIds ?? [],
  };
};

export const listForProjects = async (
  projectIds: string[],
  now: Date,
  exec: DbExecutor = db,
  periodScope?: ProjectRuleMetricPeriodScope,
): Promise<Map<string, ProjectRuleMetrics>> => {
  const uniqueProjectIds = Array.from(new Set(projectIds));
  if (uniqueProjectIds.length === 0) return new Map();
  const periodUserIds = Array.from(new Set(periodScope?.userIds ?? []));
  const periodTaskIds = Array.from(new Set(periodScope?.taskIds ?? []));

  const rows = await executeRows<ProjectMetricsRow>(
    exec,
    sql`
      WITH task_metrics AS (
        SELECT
          t.project_id,
          COALESCE(SUM(COALESCE(t.revenue, 0) * COALESCE(t.duration, 1)), 0) AS task_revenue,
          COUNT(*) AS tasks_count,
          COUNT(*) FILTER (WHERE COALESCE(t.is_disabled, false) = false) AS enabled_tasks_count,
          COALESCE(SUM(COALESCE(t.expected_effort, 0)), 0) AS planned_effort_hours,
          COALESCE(SUM(COALESCE(t.monthly_effort, 0)), 0) AS monthly_effort_hours
        FROM tasks t
        WHERE t.project_id = ANY(${sql.param(uniqueProjectIds)}::text[])
        GROUP BY t.project_id
      ),
      entry_metrics AS (
        SELECT
          te.project_id,
          COALESCE(SUM(ROUND((COALESCE(te.duration, 0) * COALESCE(te.hourly_cost, 0))::numeric, 2)), 0) AS cost_to_date,
          COALESCE(SUM(COALESCE(te.duration, 0)), 0) AS hours_to_date
        FROM time_entries te
        WHERE te.project_id = ANY(${sql.param(uniqueProjectIds)}::text[])
        GROUP BY te.project_id
      ),
      period_scope_validation AS (
        SELECT
          CASE
            WHEN ${periodScope !== undefined} THEN ARRAY(
              SELECT requested_user.id
              FROM unnest(${sql.param(periodUserIds)}::text[]) AS requested_user(id)
              WHERE NOT EXISTS (
                SELECT 1
                FROM users u
                WHERE u.id = requested_user.id
                  AND (
                    EXISTS (
                      SELECT 1
                      FROM user_projects up
                      WHERE up.project_id = ANY(${sql.param(uniqueProjectIds)}::text[])
                        AND up.user_id = u.id
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM time_entries historical_entry
                      WHERE historical_entry.project_id = ANY(${sql.param(uniqueProjectIds)}::text[])
                        AND historical_entry.user_id = u.id
                    )
                  )
              )
            )
            ELSE ARRAY[]::text[]
          END AS invalid_user_ids,
          CASE
            WHEN ${periodScope !== undefined} THEN ARRAY(
              SELECT requested_task.id
              FROM unnest(${sql.param(periodTaskIds)}::text[]) AS requested_task(id)
              WHERE NOT EXISTS (
                SELECT 1
                FROM tasks scope_task
                WHERE scope_task.id = requested_task.id
                  AND scope_task.project_id = ANY(${sql.param(uniqueProjectIds)}::text[])
              )
            )
            ELSE ARRAY[]::text[]
          END AS invalid_task_ids
      ),
      period_metrics AS (
        SELECT
          te.project_id,
          COALESCE(SUM(COALESCE(te.duration, 0)), 0) AS period_hours,
          COUNT(*) AS period_entry_count,
          COUNT(DISTINCT te.user_id) AS period_active_users,
          COUNT(
            DISTINCT COALESCE(
              te.task_id,
              resolved_task.id,
              'legacy:' || lower(te.task)
            )
          ) AS period_active_tasks,
          COALESCE(SUM(ROUND((COALESCE(te.duration, 0) * COALESCE(te.hourly_cost, 0))::numeric, 2)), 0) AS period_cost
        FROM time_entries te
        LEFT JOIN LATERAL (
          SELECT t_inner.id
          FROM tasks t_inner
          WHERE te.task_id IS NULL
            AND t_inner.project_id = te.project_id
            AND t_inner.name = te.task
          ORDER BY t_inner.id
          LIMIT 1
        ) resolved_task ON TRUE
        WHERE ${periodScope !== undefined}
          AND te.project_id = ANY(${sql.param(uniqueProjectIds)}::text[])
          AND te.date >= ${periodScope?.startDate ?? '1970-01-01'}::date
          AND te.date < ${periodScope?.endDate ?? '1970-01-01'}::date
          AND (
            ${periodUserIds.length === 0}
            OR te.user_id = ANY(${sql.param(periodUserIds)}::text[])
          )
          AND (
            ${periodTaskIds.length === 0}
            OR COALESCE(te.task_id, resolved_task.id) = ANY(${sql.param(periodTaskIds)}::text[])
          )
        GROUP BY te.project_id
      )
      SELECT
        p.id AS "projectId",
        p.name AS "projectName",
        p.client_id AS "clientId",
        p.description AS "description",
        p.is_disabled AS "isDisabled",
        p.created_at::date::text AS "createdAt",
        p.order_id AS "orderId",
        p.offer_id AS "offerId",
        (SELECT co.revision_code FROM customer_offers co WHERE co.id = p.offer_id) AS "offerRevisionCode",
        p.start_date::text AS "startDate",
        p.end_date::text AS "endDate",
        p.revenue AS "manualRevenue",
        tm.task_revenue AS "taskRevenue",
        em.cost_to_date AS "costToDate",
        em.hours_to_date AS "hoursToDate",
        tm.tasks_count AS "tasksCount",
        tm.enabled_tasks_count AS "enabledTasksCount",
        tm.planned_effort_hours AS "plannedEffortHours",
        tm.monthly_effort_hours AS "monthlyEffortHours",
        pm.period_hours AS "periodHours",
        pm.period_entry_count AS "periodEntryCount",
        pm.period_active_users AS "periodActiveUsers",
        pm.period_active_tasks AS "periodActiveTasks",
        pm.period_cost AS "periodCost",
        psv.invalid_user_ids AS "invalidPeriodUserIds",
        psv.invalid_task_ids AS "invalidPeriodTaskIds",
        p.billing_frequency AS "billingFrequency",
        p.status AS "status",
        p.tipo AS "tipo",
        p.tipo_confirmed AS "tipoConfirmed",
        CASE
          WHEN EXISTS (
            SELECT 1 FROM tasks bt
            WHERE bt.project_id = p.id
              AND bt.billing_type <> p.billing_type
          )
          OR (
            SELECT COUNT(DISTINCT bt2.billing_type)
            FROM tasks bt2
            WHERE bt2.project_id = p.id
          ) > 1
          THEN 'mixed'
          ELSE p.billing_type
        END AS "billingType"
      FROM projects p
      INNER JOIN clients c ON c.id = p.client_id
      LEFT JOIN task_metrics tm ON tm.project_id = p.id
      LEFT JOIN entry_metrics em ON em.project_id = p.id
      LEFT JOIN period_metrics pm ON pm.project_id = p.id
      CROSS JOIN period_scope_validation psv
      WHERE p.id = ANY(${sql.param(uniqueProjectIds)}::text[])
    `,
  );

  return new Map(rows.map((row) => [row.projectId, mapRow(row, now, periodScope?.timeZone)]));
};

export const metricValueForField = (
  metrics: ProjectRuleMetrics,
  field: ProjectRuleField | string,
): ProjectRuleMetricValue => {
  switch (field) {
    case 'project_name':
      return metrics.projectName;
    case 'description':
      return metrics.description;
    case 'is_disabled':
      return metrics.isDisabled;
    case 'start_date':
      return metrics.startDate;
    case 'end_date':
      return metrics.endDate;
    case 'revenue':
      return metrics.revenue;
    case 'billing_type':
      return metrics.billingType;
    case 'billing_frequency':
      return metrics.billingFrequency;
    case 'status':
      return metrics.status;
    case 'tipo':
      return metrics.tipo;
    case 'tipo_confirmed':
      return metrics.tipoConfirmed;
    case 'cost_to_date':
      return metrics.costToDate;
    case 'budget_used_pct':
      return metrics.budgetUsedPct;
    case 'hours_to_date':
      return metrics.hoursToDate;
    case 'days_until_deadline':
      return metrics.daysUntilDeadline;
    case 'days_until_start':
      return metrics.daysUntilStart;
    case 'days_since_start':
      return metrics.daysSinceStart;
    case 'tasks_count':
      return metrics.tasksCount;
    case 'enabled_tasks_count':
      return metrics.enabledTasksCount;
    case 'planned_effort_hours':
      return metrics.plannedEffortHours;
    case 'monthly_effort_hours':
      return metrics.monthlyEffortHours;
    case 'period_hours':
      return metrics.periodHours;
    case 'period_entry_count':
      return metrics.periodEntryCount;
    case 'period_active_users':
      return metrics.periodActiveUsers;
    case 'period_active_tasks':
      return metrics.periodActiveTasks;
    case 'period_cost':
      return metrics.periodCost;
    default:
      return null;
  }
};
