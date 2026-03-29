import type {
  DashboardDataset,
  DashboardWidgetDataQueryResult,
  DashboardWidgetDataResult,
  DashboardWidgetQuery,
} from '../../services/api/reports';
import { createPrefixedId } from '../../utils/id';
import { GROUP_BY_OPTIONS, METRIC_OPTIONS } from './dashboardConstants';

export const DASHBOARD_QUERY_REFS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

type DashboardQueryLike = Pick<DashboardWidgetQuery, 'label' | 'ref'>;

type DashboardBarChartRow = {
  label: string;
  total: number;
  values: Record<string, number>;
};

export const getDefaultMetricForDataset = (dataset: DashboardDataset) =>
  METRIC_OPTIONS[dataset][0] || '';

export const createDashboardWidgetQuery = (
  ref: string,
  dataset: DashboardDataset = 'timesheets',
): DashboardWidgetQuery => ({
  id: createPrefixedId('wdq'),
  ref,
  dataset,
  metric: getDefaultMetricForDataset(dataset),
  label: '',
});

export const getDashboardQueryDisplayName = (query: DashboardQueryLike) =>
  query.label?.trim() || query.ref;

export const getNextDashboardQueryRef = (
  queries: Pick<DashboardWidgetQuery, 'ref'>[],
): (typeof DASHBOARD_QUERY_REFS)[number] | null => {
  const usedRefs = new Set(queries.map((query) => query.ref));
  return DASHBOARD_QUERY_REFS.find((ref) => !usedRefs.has(ref)) || null;
};

export const getSharedGroupByOptions = (datasets: DashboardDataset[]) => {
  if (datasets.length === 0) return [];
  return GROUP_BY_OPTIONS[datasets[0]].filter((option) =>
    datasets.every((dataset) => GROUP_BY_OPTIONS[dataset].includes(option)),
  );
};

export const getDefaultGroupByForDatasets = (datasets: DashboardDataset[]) =>
  getSharedGroupByOptions(datasets)[0] || '';

export const buildDashboardBarChartRows = (data: DashboardWidgetDataResult, limit?: number) => {
  const rows = new Map<string, DashboardBarChartRow>();

  for (const query of data.queries) {
    for (const point of query.series) {
      const current = rows.get(point.label) || {
        label: point.label,
        total: 0,
        values: {},
      };
      current.total += point.value;
      current.values[query.id] = point.value;
      rows.set(point.label, current);
    }
  }

  const normalizedRows = Array.from(rows.values())
    .map((row) => {
      const values: Record<string, number> = {};
      for (const query of data.queries) {
        values[query.id] = row.values[query.id] ?? 0;
      }
      return {
        label: row.label,
        total: row.total,
        values,
      };
    })
    .sort((left, right) => {
      if (data.groupBy === 'month') {
        return left.label.localeCompare(right.label);
      }
      if (right.total !== left.total) {
        return right.total - left.total;
      }
      return left.label.localeCompare(right.label);
    });

  const boundedRows =
    typeof limit === 'number'
      ? normalizedRows.slice(0, Math.max(1, Math.floor(limit)))
      : normalizedRows;

  return boundedRows.map((row) => ({
    label: row.label,
    ...row.values,
  }));
};

export const getWidgetQuerySummary = (
  query: Pick<DashboardWidgetDataQueryResult, 'dataset' | 'metric' | 'label' | 'ref'>,
) => ({
  dataset: query.dataset,
  metric: query.metric,
  label: getDashboardQueryDisplayName(query),
});
