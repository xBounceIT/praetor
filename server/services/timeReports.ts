import type {
  TimeReportDefinition,
  TimeReportEntry,
  TimeReportGroup,
  TimeReportSubtotal,
} from '../repositories/timeReportsRepo.ts';
import * as timeReportsRepo from '../repositories/timeReportsRepo.ts';

export const TIME_REPORT_TABLE_ROW_LIMIT = 5_000;
const TIME_REPORT_EXPORT_BATCH_SIZE = 5_000;
export const TIME_REPORT_EXPORT_ENTRY_LIMIT = 50_000;

export type TimeReportRow = {
  key: string;
  kind: 'detail' | 'subtotal';
  groupLevel: number | null;
  label: string | null;
  date: string | null;
  userId: string | null;
  userName: string | null;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskName: string | null;
  notes: string | null;
  duration: number;
  cost: number | null;
  entry: Record<string, unknown> | null;
};

export type TimeReportResult = {
  rows: TimeReportRow[];
  matchedEntryCount: number;
  outputRowCount: number;
  truncated: boolean;
  totals: { duration: number; cost: number | null };
};

export class TimeReportExportLimitError extends Error {
  constructor(public readonly count: number) {
    super(
      `The report contains ${count} entries; CSV export is limited to ${TIME_REPORT_EXPORT_ENTRY_LIMIT}`,
    );
    this.name = 'TimeReportExportLimitError';
  }
}

export const collectTimeReportEntryBatches = async (
  count: number,
  fetchPage: (limit: number, offset: number) => Promise<TimeReportEntry[]>,
): Promise<TimeReportEntry[]> => {
  const entries: TimeReportEntry[] = [];
  let offset = 0;
  while (offset < count) {
    const batchSize = Math.min(TIME_REPORT_EXPORT_BATCH_SIZE, count - offset);
    const batch = await fetchPage(batchSize, offset);
    entries.push(...batch);
    if (batch.length < batchSize) break;
    offset += batch.length;
  }
  return entries;
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });

const groupKey = (entry: TimeReportEntry, group: TimeReportGroup): string => {
  switch (group) {
    case 'date':
      return entry.date;
    case 'user':
      return entry.userId;
    case 'client':
      return entry.clientId;
    case 'project':
      return entry.projectId;
    case 'task':
      return `${entry.projectId}:${entry.taskId ?? `legacy:${entry.task.toLowerCase()}`}`;
  }
};

const groupLabel = (entry: TimeReportEntry, group: TimeReportGroup): string => {
  switch (group) {
    case 'date':
      return entry.date;
    case 'user':
      return entry.userName;
    case 'client':
      return entry.clientName;
    case 'project':
      return entry.projectName;
    case 'task':
      return entry.task;
  }
};

const sortedEntries = (entries: TimeReportEntry[], groupBy: TimeReportGroup[]): TimeReportEntry[] =>
  [...entries].sort((left, right) => {
    for (const group of groupBy) {
      const comparison = compareText(groupKey(left, group), groupKey(right, group));
      if (comparison !== 0) return comparison;
    }
    return (
      left.date.localeCompare(right.date) ||
      compareText(left.userName, right.userName) ||
      compareText(left.projectName, right.projectName) ||
      left.id.localeCompare(right.id)
    );
  });

const detailRow = (entry: TimeReportEntry, includeCost: boolean): TimeReportRow => {
  const {
    hourlyCost: _hourlyCost,
    cost: _entryCost,
    userName: _userName,
    ...entryWithoutCostAndDisplayName
  } = entry;
  return {
    key: `detail:${entry.id}`,
    kind: 'detail',
    groupLevel: null,
    label: null,
    date: entry.date,
    userId: entry.userId,
    userName: entry.userName,
    clientId: entry.clientId,
    clientName: entry.clientName,
    projectId: entry.projectId,
    projectName: entry.projectName,
    taskId: entry.taskId,
    taskName: entry.task,
    notes: entry.notes,
    duration: entry.duration,
    cost: includeCost ? entry.cost : null,
    entry: {
      ...entryWithoutCostAndDisplayName,
      ...(includeCost ? { hourlyCost: entry.hourlyCost, cost: entry.cost } : {}),
    },
  };
};

const subtotalKey = (level: number, groupKeys: string[]) =>
  JSON.stringify([level, ...groupKeys.slice(0, level + 1)]);

const subtotalRow = (
  level: number,
  group: TimeReportGroup,
  label: string,
  sequence: number,
  includeCost: boolean,
  duration: number,
  cost: number,
): TimeReportRow => ({
  key: `subtotal:${level}:${sequence}:${label}`,
  kind: 'subtotal',
  groupLevel: level,
  label,
  date: group === 'date' ? label : null,
  userId: null,
  userName: group === 'user' ? label : null,
  clientId: null,
  clientName: group === 'client' ? label : null,
  projectId: null,
  projectName: group === 'project' ? label : null,
  taskId: null,
  taskName: group === 'task' ? label : null,
  notes: null,
  duration,
  cost: includeCost ? cost : null,
  entry: null,
});

export const buildTimeReportRows = (
  sourceEntries: TimeReportEntry[],
  definition: TimeReportDefinition,
  includeCost: boolean,
  subtotals: TimeReportSubtotal[] = [],
): TimeReportRow[] => {
  const entries = sortedEntries(sourceEntries, definition.groupBy);
  if (definition.groupBy.length === 0) {
    return entries.map((entry) => detailRow(entry, includeCost));
  }

  const rows: TimeReportRow[] = [];
  const subtotalByGroup = new Map(
    subtotals.map((subtotal) => [subtotalKey(subtotal.groupLevel, subtotal.groupKeys), subtotal]),
  );
  let subtotalSequence = 0;

  const appendLevel = (subset: TimeReportEntry[], level: number, parentValues: string[]) => {
    if (level >= definition.groupBy.length) {
      if (!definition.totalsOnly) {
        rows.push(...subset.map((entry) => detailRow(entry, includeCost)));
      }
      return;
    }
    const group = definition.groupBy[level];
    let start = 0;
    while (start < subset.length) {
      const key = groupKey(subset[start], group);
      let end = start + 1;
      while (end < subset.length && groupKey(subset[end], group) === key) end += 1;
      const groupedEntries = subset.slice(start, end);
      const groupKeys = [...parentValues, key];
      appendLevel(groupedEntries, level + 1, groupKeys);
      const aggregate = subtotalByGroup.get(subtotalKey(level, groupKeys));
      const duration =
        aggregate?.duration ?? groupedEntries.reduce((sum, entry) => sum + entry.duration, 0);
      const cost =
        aggregate?.cost ??
        Math.round(groupedEntries.reduce((sum, entry) => sum + entry.cost, 0) * 100) / 100;
      subtotalSequence += 1;
      rows.push(
        subtotalRow(
          level,
          group,
          groupLabel(groupedEntries[0], group),
          subtotalSequence,
          includeCost,
          duration,
          cost,
        ),
      );
      start = end;
    }
  };

  appendLevel(entries, 0, []);
  return rows;
};

export const buildTimeReportSubtotalRows = (
  subtotals: TimeReportSubtotal[],
  definition: TimeReportDefinition,
  includeCost: boolean,
): TimeReportRow[] =>
  subtotals.map((subtotal, index) =>
    subtotalRow(
      subtotal.groupLevel,
      definition.groupBy[subtotal.groupLevel],
      subtotal.label,
      index + 1,
      includeCost,

      subtotal.duration,
      subtotal.cost,
    ),
  );
export const generateTimeReport = async (
  definition: TimeReportDefinition,
  userIds: string[],
  includeCost: boolean,
): Promise<TimeReportResult> => {
  const [totals, entries, subtotals] = await Promise.all([
    timeReportsRepo.getTotals(definition, userIds),
    definition.totalsOnly
      ? Promise.resolve([])
      : timeReportsRepo.listEntries(definition, userIds, TIME_REPORT_TABLE_ROW_LIMIT + 1),
    definition.groupBy.length === 0
      ? Promise.resolve([])
      : timeReportsRepo.listSubtotals(definition, userIds, TIME_REPORT_TABLE_ROW_LIMIT + 1),
  ]);
  const entryTruncated = entries.length > TIME_REPORT_TABLE_ROW_LIMIT;
  const reportRows = definition.totalsOnly
    ? buildTimeReportSubtotalRows(subtotals, definition, includeCost)
    : buildTimeReportRows(
        entries.slice(0, TIME_REPORT_TABLE_ROW_LIMIT),
        definition,
        includeCost,
        subtotals,
      );
  const rows = reportRows.slice(0, TIME_REPORT_TABLE_ROW_LIMIT);
  return {
    rows,
    matchedEntryCount: totals.count,
    outputRowCount: rows.length,
    truncated:
      entryTruncated ||
      reportRows.length > TIME_REPORT_TABLE_ROW_LIMIT ||
      subtotals.length > TIME_REPORT_TABLE_ROW_LIMIT,
    totals: {
      duration: totals.duration,
      cost: includeCost ? totals.cost : null,
    },
  };
};

export const generateCompleteTimeReport = async (
  definition: TimeReportDefinition,
  userIds: string[],
  includeCost: boolean,
): Promise<TimeReportResult> => {
  const totals = await timeReportsRepo.getTotals(definition, userIds);
  if (totals.count > TIME_REPORT_EXPORT_ENTRY_LIMIT) {
    throw new TimeReportExportLimitError(totals.count);
  }
  const [entries, subtotals] = await Promise.all([
    definition.totalsOnly
      ? Promise.resolve([])
      : collectTimeReportEntryBatches(totals.count, (limit, offset) =>
          timeReportsRepo.listEntriesPage(definition, userIds, limit, offset),
        ),
    definition.groupBy.length === 0 || totals.count === 0
      ? Promise.resolve([])
      : timeReportsRepo.listSubtotals(
          definition,
          userIds,
          totals.count * definition.groupBy.length,
        ),
  ]);
  const rows = definition.totalsOnly
    ? buildTimeReportSubtotalRows(subtotals, definition, includeCost)
    : buildTimeReportRows(entries, definition, includeCost, subtotals);
  return {
    rows,
    matchedEntryCount: totals.count,
    outputRowCount: rows.length,
    truncated: false,
    totals: {
      duration: totals.duration,
      cost: includeCost ? totals.cost : null,
    },
  };
};
