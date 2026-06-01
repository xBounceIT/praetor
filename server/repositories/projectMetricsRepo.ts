import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { type BillingType, DEFAULT_BILLING_TYPE } from '../utils/billing.ts';
import { roundCurrency } from '../utils/invoice-math.ts';
import { parseNullableDbNumber } from '../utils/parse.ts';
import type { ProjectRuleField } from '../utils/projectRuleFields.ts';

export type ProjectRuleMetricValue = string | number | null;

export type ProjectRuleMetrics = {
  projectId: string;
  projectName: string;
  revenue: number | null;
  costToDate: number;
  budgetUsedPct: number | null;
  hoursToDate: number;
  daysUntilDeadline: number | null;
  billingType: BillingType;
  status: 'active' | 'disabled';
};

type ProjectMetricsRow = {
  projectId: string;
  projectName: string;
  projectIsDisabled: boolean | null;
  clientIsDisabled: boolean | null;
  endDate: string | null;
  manualRevenue: string | number | null;
  orderId: string | null;
  taskRevenue: string | number | null;
  orderTotal: string | number | null;
  costToDate: string | number | null;
  hoursToDate: string | number | null;
  billingType: BillingType | null;
};

const MS_PER_DAY = 86_400_000;

const diffCalendarDays = (endDate: string | null, now: Date): number | null => {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / MS_PER_DAY);
};

const resolveRevenue = (row: ProjectMetricsRow): number | null => {
  const taskRevenue = parseNullableDbNumber(row.taskRevenue) ?? 0;
  if (taskRevenue > 0) return roundCurrency(taskRevenue);

  if (row.orderId) return roundCurrency(parseNullableDbNumber(row.orderTotal) ?? 0);

  const manualRevenue = parseNullableDbNumber(row.manualRevenue);
  return manualRevenue === null ? null : roundCurrency(manualRevenue);
};

const mapRow = (row: ProjectMetricsRow, now: Date): ProjectRuleMetrics => {
  const revenue = resolveRevenue(row);
  const costToDate = roundCurrency(parseNullableDbNumber(row.costToDate) ?? 0);
  return {
    projectId: row.projectId,
    projectName: row.projectName,
    revenue,
    costToDate,
    budgetUsedPct: revenue && revenue > 0 ? Math.round((costToDate / revenue) * 100) : null,
    hoursToDate: parseNullableDbNumber(row.hoursToDate) ?? 0,
    daysUntilDeadline: diffCalendarDays(row.endDate, now),
    billingType: row.billingType ?? DEFAULT_BILLING_TYPE,
    status: row.projectIsDisabled || row.clientIsDisabled ? 'disabled' : 'active',
  };
};

export const listForProjects = async (
  projectIds: string[],
  now: Date,
  exec: DbExecutor = db,
): Promise<Map<string, ProjectRuleMetrics>> => {
  const uniqueProjectIds = Array.from(new Set(projectIds));
  if (uniqueProjectIds.length === 0) return new Map();

  const rows = await executeRows<ProjectMetricsRow>(
    exec,
    sql`
      WITH task_metrics AS (
        SELECT
          t.project_id,
          COALESCE(SUM(COALESCE(t.revenue, 0)), 0) AS task_revenue
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
      order_subtotals AS (
        SELECT
          si.sale_id,
          COALESCE(SUM(
            COALESCE(si.quantity, 0)
            * COALESCE(si.unit_price, 0)
            * (1 - COALESCE(si.discount, 0) / 100)
          ), 0) AS subtotal
        FROM sale_items si
        GROUP BY si.sale_id
      ),
      order_totals AS (
        SELECT
          s.id,
          ROUND(
            (
              COALESCE(os.subtotal, 0)
              - CASE
                  WHEN s.discount_type = 'currency'
                    THEN LEAST(GREATEST(COALESCE(s.discount, 0), 0), COALESCE(os.subtotal, 0))
                  ELSE COALESCE(os.subtotal, 0) * (COALESCE(s.discount, 0) / 100)
                END
            )::numeric,
            2
          ) AS order_total
        FROM sales s
        LEFT JOIN order_subtotals os ON os.sale_id = s.id
      )
      SELECT
        p.id AS "projectId",
        p.name AS "projectName",
        p.is_disabled AS "projectIsDisabled",
        c.is_disabled AS "clientIsDisabled",
        p.end_date::text AS "endDate",
        p.revenue AS "manualRevenue",
        p.order_id AS "orderId",
        tm.task_revenue AS "taskRevenue",
        ot.order_total AS "orderTotal",
        em.cost_to_date AS "costToDate",
        em.hours_to_date AS "hoursToDate",
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
      LEFT JOIN order_totals ot ON ot.id = p.order_id
      WHERE p.id = ANY(${sql.param(uniqueProjectIds)}::text[])
    `,
  );

  return new Map(rows.map((row) => [row.projectId, mapRow(row, now)]));
};

export const metricValueForField = (
  metrics: ProjectRuleMetrics,
  field: ProjectRuleField | string,
): ProjectRuleMetricValue => {
  switch (field) {
    case 'revenue':
      return metrics.revenue;
    case 'cost_to_date':
      return metrics.costToDate;
    case 'budget_used_pct':
      return metrics.budgetUsedPct;
    case 'hours_to_date':
      return metrics.hoursToDate;
    case 'days_until_deadline':
      return metrics.daysUntilDeadline;
    case 'billing_type':
      return metrics.billingType;
    case 'status':
      return metrics.status;
    default:
      return null;
  }
};
