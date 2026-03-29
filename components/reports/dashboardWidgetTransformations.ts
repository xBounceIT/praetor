import type {
  DashboardDataset,
  DashboardWidget,
  DashboardWidgetDataPoint,
  DashboardWidgetDataQueryResult,
  DashboardWidgetDataResult,
  DashboardWidgetFilterRowsTransformation,
  DashboardWidgetMergeSeriesTransformation,
  DashboardWidgetOrganizeSeriesTransformation,
  DashboardWidgetQuery,
  DashboardWidgetReduceQueriesTransformation,
  DashboardWidgetSortRowsTransformation,
  DashboardWidgetTransformation,
  DashboardWidgetTransformationDirection,
  DashboardWidgetTransformationLabelOperator,
  DashboardWidgetTransformationNumberOperator,
  DashboardWidgetTransformationReducer,
  DashboardWidgetTransformationSortBy,
} from '../../services/api/reports';
import { createPrefixedId } from '../../utils/id';
import { getDashboardQueryDisplayName } from './dashboardWidgetUtils';

type DashboardWidgetTransformationType = DashboardWidgetTransformation['type'];

type DashboardWidgetChartRow = {
  label: string;
  total: number;
  values: Record<string, number>;
};

export type DashboardWidgetChartSeries = {
  id: string;
  label: string;
  ref?: string;
  dataset?: DashboardDataset;
  metric?: string;
  total: number;
  derived: boolean;
  sourceQueryIds: string[];
};

type DashboardWidgetChartModel = {
  groupBy: string;
  rows: DashboardWidgetChartRow[];
  series: DashboardWidgetChartSeries[];
};

export interface DashboardWidgetVisualizationModel extends DashboardWidgetChartModel {
  barRows: Array<Record<string, number | string>>;
  pieSeries: DashboardWidgetDataPoint[];
  hasSeriesData: boolean;
}

export interface DashboardWidgetTransformationLabels {
  mergedSeries: string;
  reducedValue: string;
}

const DEFAULT_TRANSFORMATION_LABELS: DashboardWidgetTransformationLabels = {
  mergedSeries: 'Merged series',
  reducedValue: 'Reduced value',
};

const DEFAULT_ROW_LIMIT = 8;

const getNormalizedLimit = (value?: number) => {
  const parsed = Number.parseInt(String(value ?? DEFAULT_ROW_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ROW_LIMIT;
  return Math.max(3, Math.min(parsed, 20));
};

const normalizeUniqueQueryIds = (raw: unknown, allowedValues: Set<string>) => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0 && allowedValues.has(item)),
    ),
  );
};

const normalizeLabel = (value: unknown) =>
  String(value || '')
    .trim()
    .slice(0, 120);

const aggregateValues = (values: number[], reducer: DashboardWidgetTransformationReducer) => {
  if (values.length === 0) return 0;

  if (reducer === 'avg') {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  if (reducer === 'min') {
    return Math.min(...values);
  }

  if (reducer === 'max') {
    return Math.max(...values);
  }

  return values.reduce((sum, value) => sum + value, 0);
};

const rebuildChartModel = (model: DashboardWidgetChartModel): DashboardWidgetChartModel => {
  const series = model.series.map((item) => ({
    ...item,
    sourceQueryIds: Array.from(new Set(item.sourceQueryIds)),
    total: 0,
  }));

  const rows = model.rows.map((row) => {
    const values: Record<string, number> = {};
    let total = 0;

    for (const seriesItem of series) {
      const value = Number(row.values[seriesItem.id] ?? 0);
      const normalizedValue = Number.isFinite(value) ? value : 0;
      values[seriesItem.id] = normalizedValue;
      total += normalizedValue;
      seriesItem.total += normalizedValue;
    }

    return {
      label: row.label,
      values,
      total,
    };
  });

  return {
    groupBy: model.groupBy,
    rows,
    series,
  };
};

const sortRowsByDefault = (rows: DashboardWidgetChartRow[], groupBy: string) =>
  [...rows].sort((left, right) => {
    if (groupBy === 'month') {
      return left.label.localeCompare(right.label);
    }
    if (right.total !== left.total) {
      return right.total - left.total;
    }
    return left.label.localeCompare(right.label);
  });

const sortRows = (
  rows: DashboardWidgetChartRow[],
  transformation: DashboardWidgetSortRowsTransformation,
) =>
  [...rows].sort((left, right) => {
    if (transformation.sortBy === 'label') {
      const comparison = left.label.localeCompare(right.label);
      return transformation.direction === 'asc' ? comparison : comparison * -1;
    }

    if (left.total === right.total) {
      return left.label.localeCompare(right.label);
    }

    return transformation.direction === 'asc' ? left.total - right.total : right.total - left.total;
  });

const filterRows = (
  rows: DashboardWidgetChartRow[],
  transformation: DashboardWidgetFilterRowsTransformation,
) => {
  if (transformation.field === 'label') {
    const rawValue = String(transformation.value || '')
      .trim()
      .toLowerCase();
    if (!rawValue) return rows;

    return rows.filter((row) => {
      const label = row.label.toLowerCase();
      if (transformation.operator === 'equals') return label === rawValue;
      if (transformation.operator === 'startsWith') return label.startsWith(rawValue);
      return label.includes(rawValue);
    });
  }

  const numericValue = Number(transformation.value);
  if (!Number.isFinite(numericValue)) return rows;

  const secondaryValue = Number(transformation.secondaryValue);
  return rows.filter((row) => {
    if (transformation.operator === 'gt') return row.total > numericValue;
    if (transformation.operator === 'gte') return row.total >= numericValue;
    if (transformation.operator === 'lt') return row.total < numericValue;
    if (transformation.operator === 'lte') return row.total <= numericValue;
    if (!Number.isFinite(secondaryValue)) return true;
    const lower = Math.min(numericValue, secondaryValue);
    const upper = Math.max(numericValue, secondaryValue);
    return row.total >= lower && row.total <= upper;
  });
};

const buildMergedSeriesLabel = (
  transformation: DashboardWidgetMergeSeriesTransformation,
  selectedSeries: DashboardWidgetChartSeries[],
  labels: DashboardWidgetTransformationLabels,
) => {
  const customLabel = normalizeLabel(transformation.label);
  if (customLabel) return customLabel;
  if (selectedSeries.length > 0) {
    return selectedSeries.map((item) => item.label).join(' + ');
  }
  return labels.mergedSeries;
};

const buildReducedSeriesLabel = (
  transformation: DashboardWidgetReduceQueriesTransformation,
  labels: DashboardWidgetTransformationLabels,
) => {
  const customLabel = normalizeLabel(transformation.label);
  return customLabel || labels.reducedValue;
};

const applyOrganizeSeriesTransformation = (
  model: DashboardWidgetChartModel,
  transformation: DashboardWidgetOrganizeSeriesTransformation,
) => {
  if (model.series.length === 0) return model;

  const seriesMap = new Map(model.series.map((item) => [item.id, item] as const));
  const orderedIds = Array.from(
    new Set([
      ...transformation.queryOrder.filter((id) => seriesMap.has(id)),
      ...model.series
        .map((item) => item.id)
        .filter((id) => !transformation.queryOrder.includes(id)),
    ]),
  );
  const hiddenIds = new Set(transformation.hiddenQueryIds);

  return rebuildChartModel({
    ...model,
    series: orderedIds
      .map((id) => seriesMap.get(id) || null)
      .filter((item): item is DashboardWidgetChartSeries => Boolean(item))
      .filter((item) => !hiddenIds.has(item.id)),
  });
};

const applyMergeSeriesTransformation = (
  model: DashboardWidgetChartModel,
  transformation: DashboardWidgetMergeSeriesTransformation,
  labels: DashboardWidgetTransformationLabels,
) => {
  const selectedIds = transformation.queryIds.filter((id) =>
    model.series.some((seriesItem) => seriesItem.id === id),
  );
  if (selectedIds.length < 2) return model;

  const selectedSeries = model.series.filter((item) => selectedIds.includes(item.id));
  const insertionIndex = Math.min(
    ...selectedIds.map((id) => model.series.findIndex((item) => item.id === id)),
  );
  const nextSeries: DashboardWidgetChartSeries[] = [];

  for (const [index, seriesItem] of model.series.entries()) {
    if (selectedIds.includes(seriesItem.id)) {
      if (index === insertionIndex) {
        nextSeries.push({
          id: `merged-${transformation.id}`,
          label: buildMergedSeriesLabel(transformation, selectedSeries, labels),
          total: 0,
          derived: true,
          sourceQueryIds: selectedSeries.flatMap((item) => item.sourceQueryIds),
        });
      }
      continue;
    }
    nextSeries.push(seriesItem);
  }

  const mergedSeriesId = `merged-${transformation.id}`;
  return rebuildChartModel({
    ...model,
    series: nextSeries,
    rows: model.rows.map((row) => ({
      ...row,
      values: {
        ...row.values,
        [mergedSeriesId]: aggregateValues(
          selectedIds.map((id) => Number(row.values[id] ?? 0)),
          transformation.reducer,
        ),
      },
    })),
  });
};

const applyReduceQueriesTransformation = (
  model: DashboardWidgetChartModel,
  transformation: DashboardWidgetReduceQueriesTransformation,
  labels: DashboardWidgetTransformationLabels,
) => {
  const selectedIds = transformation.queryIds.filter((id) =>
    model.series.some((seriesItem) => seriesItem.id === id),
  );
  if (selectedIds.length === 0) return model;

  const seriesMap = new Map(model.series.map((item) => [item.id, item] as const));
  const reducedSeriesId = `reduced-${transformation.id}`;

  return rebuildChartModel({
    groupBy: model.groupBy,
    series: [
      {
        id: reducedSeriesId,
        label: buildReducedSeriesLabel(transformation, labels),
        total: 0,
        derived: true,
        sourceQueryIds: selectedIds.flatMap((id) => seriesMap.get(id)?.sourceQueryIds || [id]),
      },
    ],
    rows: selectedIds.map((id) => ({
      label: seriesMap.get(id)?.label || id,
      total: 0,
      values: {
        [reducedSeriesId]: aggregateValues(
          model.rows.map((row) => Number(row.values[id] ?? 0)),
          transformation.reducer,
        ),
      },
    })),
  });
};

const buildBaseChartModel = (data: DashboardWidgetDataResult): DashboardWidgetChartModel => {
  const rowMap = new Map<string, DashboardWidgetChartRow>();

  for (const query of data.queries) {
    for (const point of query.series) {
      const row = rowMap.get(point.label) || {
        label: point.label,
        total: 0,
        values: {},
      };
      row.values[query.id] = Number.isFinite(point.value) ? point.value : 0;
      rowMap.set(point.label, row);
    }
  }

  const baseModel = rebuildChartModel({
    groupBy: data.groupBy,
    rows: Array.from(rowMap.values()),
    series: data.queries.map((query) => ({
      id: query.id,
      label: getDashboardQueryDisplayName(query),
      ref: query.ref,
      dataset: query.dataset,
      metric: query.metric,
      total: 0,
      derived: false,
      sourceQueryIds: [query.id],
    })),
  });

  return rebuildChartModel({
    ...baseModel,
    rows: sortRowsByDefault(baseModel.rows, data.groupBy),
  });
};

export const createDashboardWidgetTransformation = (
  type: DashboardWidgetTransformationType,
  queries: Pick<DashboardWidgetQuery, 'id'>[],
): DashboardWidgetTransformation => {
  const queryIds = queries.map((query) => query.id);

  if (type === 'sortRows') {
    return {
      id: createPrefixedId('wdt'),
      type,
      sortBy: 'total',
      direction: 'desc',
    };
  }

  if (type === 'filterRows') {
    return {
      id: createPrefixedId('wdt'),
      type,
      field: 'total',
      operator: 'gte',
      value: 0,
    };
  }

  if (type === 'organizeSeries') {
    return {
      id: createPrefixedId('wdt'),
      type,
      queryOrder: queryIds,
      hiddenQueryIds: [],
    };
  }

  if (type === 'mergeSeries') {
    return {
      id: createPrefixedId('wdt'),
      type,
      queryIds: queryIds.slice(0, 2),
      reducer: 'sum',
      label: '',
    };
  }

  return {
    id: createPrefixedId('wdt'),
    type: 'reduceQueries',
    queryIds,
    reducer: 'sum',
    label: '',
  };
};

export const normalizeDashboardWidgetTransformations = (
  transformations: DashboardWidgetTransformation[] | undefined,
  queries: Pick<DashboardWidgetQuery, 'id'>[],
): DashboardWidgetTransformation[] => {
  const availableQueryIds = new Set(queries.map((query) => query.id));

  return (transformations || []).map((transformation) => {
    if (transformation.type === 'sortRows') {
      const sortBy: DashboardWidgetTransformationSortBy =
        transformation.sortBy === 'label' ? 'label' : 'total';
      const direction: DashboardWidgetTransformationDirection =
        transformation.direction === 'asc' ? 'asc' : 'desc';

      return {
        ...transformation,
        sortBy,
        direction,
      };
    }

    if (transformation.type === 'filterRows') {
      const field = transformation.field === 'label' ? 'label' : 'total';

      if (field === 'label') {
        const operator: DashboardWidgetTransformationLabelOperator =
          transformation.operator === 'equals' || transformation.operator === 'startsWith'
            ? transformation.operator
            : 'contains';

        return {
          ...transformation,
          field,
          operator,
          value: normalizeLabel(transformation.value),
          secondaryValue: undefined,
        };
      }

      const numericValue = Number(transformation.value);
      const nextValue = Number.isFinite(numericValue) ? numericValue : 0;
      const numericSecondaryValue = Number(transformation.secondaryValue);
      const nextSecondaryValue = Number.isFinite(numericSecondaryValue)
        ? numericSecondaryValue
        : nextValue;
      const operator: DashboardWidgetTransformationNumberOperator =
        transformation.operator === 'gt' ||
        transformation.operator === 'lt' ||
        transformation.operator === 'lte' ||
        transformation.operator === 'between'
          ? transformation.operator
          : 'gte';

      return {
        ...transformation,
        field,
        operator,
        value: nextValue,
        secondaryValue: nextSecondaryValue,
      };
    }

    if (transformation.type === 'organizeSeries') {
      return {
        ...transformation,
        queryOrder: normalizeUniqueQueryIds(transformation.queryOrder, availableQueryIds),
        hiddenQueryIds: normalizeUniqueQueryIds(transformation.hiddenQueryIds, availableQueryIds),
      };
    }

    if (transformation.type === 'mergeSeries') {
      return {
        ...transformation,
        queryIds: normalizeUniqueQueryIds(transformation.queryIds, availableQueryIds),
        reducer:
          transformation.reducer === 'avg' ||
          transformation.reducer === 'min' ||
          transformation.reducer === 'max'
            ? transformation.reducer
            : 'sum',
        label: normalizeLabel(transformation.label),
      };
    }

    return {
      ...transformation,
      queryIds: normalizeUniqueQueryIds(transformation.queryIds, availableQueryIds),
      reducer:
        transformation.reducer === 'avg' ||
        transformation.reducer === 'min' ||
        transformation.reducer === 'max'
          ? transformation.reducer
          : 'sum',
      label: normalizeLabel(transformation.label),
    };
  });
};

export const buildDashboardWidgetVisualizationModel = (
  widget: Pick<DashboardWidget, 'limit' | 'transformations'>,
  data: DashboardWidgetDataResult,
  labels: Partial<DashboardWidgetTransformationLabels> = {},
): DashboardWidgetVisualizationModel => {
  const resolvedLabels = {
    ...DEFAULT_TRANSFORMATION_LABELS,
    ...labels,
  };

  let model = buildBaseChartModel(data);

  for (const transformation of widget.transformations || []) {
    if (transformation.type === 'sortRows') {
      model = rebuildChartModel({
        ...model,
        rows: sortRows(model.rows, transformation),
      });
      continue;
    }

    if (transformation.type === 'filterRows') {
      model = rebuildChartModel({
        ...model,
        rows: filterRows(model.rows, transformation),
      });
      continue;
    }

    if (transformation.type === 'organizeSeries') {
      model = applyOrganizeSeriesTransformation(model, transformation);
      continue;
    }

    if (transformation.type === 'mergeSeries') {
      model = applyMergeSeriesTransformation(model, transformation, resolvedLabels);
      continue;
    }

    model = applyReduceQueriesTransformation(model, transformation, resolvedLabels);
  }

  const limitedRows = model.rows.slice(0, getNormalizedLimit(widget.limit));
  model = rebuildChartModel({
    ...model,
    rows: limitedRows,
  });

  const firstSeries = model.series[0] || null;
  const pieSeries = firstSeries
    ? model.rows.map((row) => ({
        label: row.label,
        value: row.values[firstSeries.id] ?? 0,
      }))
    : [];

  return {
    ...model,
    barRows: model.rows.map((row) => ({
      label: row.label,
      ...Object.fromEntries(
        model.series.map((seriesItem) => [seriesItem.id, row.values[seriesItem.id] ?? 0]),
      ),
    })),
    pieSeries,
    hasSeriesData: model.series.length > 0 && model.rows.length > 0,
  };
};

export const getDashboardWidgetTransformationQueryOptions = (
  queries: Pick<DashboardWidgetQuery, 'id' | 'ref' | 'label'>[],
) =>
  queries.map((query) => ({
    id: query.id,
    name: getDashboardQueryDisplayName(query),
  }));

export const getDashboardWidgetTransformationDataQueryOptions = (
  queries: Pick<DashboardWidgetDataQueryResult, 'id' | 'ref' | 'label'>[],
) =>
  queries.map((query) => ({
    id: query.id,
    name: getDashboardQueryDisplayName(query),
  }));
