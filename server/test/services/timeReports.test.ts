import { describe, expect, mock, test } from 'bun:test';
import type { TimeReportDefinition, TimeReportEntry } from '../../repositories/timeReportsRepo.ts';
import {
  buildTimeReportRows,
  buildTimeReportSubtotalRows,
  collectTimeReportEntryBatches,
} from '../../services/timeReports.ts';

const definition = (patch: Partial<TimeReportDefinition> = {}): TimeReportDefinition => ({
  fromDate: '2026-07-01',
  toDate: '2026-07-31',
  clientId: null,
  projectIds: [],
  task: null,
  noteContains: '',
  fields: ['client', 'project', 'task', 'duration'],
  groupBy: [],
  totalsOnly: false,
  ...patch,
});

const entry = (id: string, patch: Partial<TimeReportEntry> = {}): TimeReportEntry => ({
  id,
  userId: 'u1',
  userName: 'Ada',
  date: '2026-07-10',
  clientId: 'c1',
  clientName: 'Acme',
  projectId: 'p1',
  projectName: 'Portal',
  task: 'Build',
  taskId: null,
  notes: null,
  duration: 2,
  hourlyCost: 50,
  cost: 100,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1,
  version: 1,
  ...patch,
});

describe('time report grouping', () => {
  test('emits hierarchical subtotals for three ordered levels', () => {
    const rows = buildTimeReportRows(
      [
        entry('e1'),
        entry('e2', { task: 'Review', duration: 1, cost: 50 }),
        entry('e3', {
          clientId: 'c2',
          clientName: 'Beta',
          projectId: 'p2',
          projectName: 'API',
          task: 'Build',
          duration: 3,
          cost: 150,
        }),
      ],
      definition({ groupBy: ['client', 'project', 'task'] }),
      true,
    );

    expect(rows.filter((row) => row.kind === 'detail')).toHaveLength(3);
    expect(rows.filter((row) => row.kind === 'subtotal')).toHaveLength(7);
    expect(rows.at(-1)).toMatchObject({
      kind: 'subtotal',
      groupLevel: 0,
      label: 'Beta',
      duration: 3,
      cost: 150,
    });
  });

  test('totalsOnly omits details and preserves group totals', () => {
    const rows = buildTimeReportRows(
      [entry('e1'), entry('e2', { duration: 1, cost: 50 })],
      definition({ groupBy: ['date', 'task'], totalsOnly: true }),
      true,
    );

    expect(rows.every((row) => row.kind === 'subtotal')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)).toMatchObject({ groupLevel: 0, duration: 3, cost: 150 });
  });

  test('strips cost and hourlyCost without report cost permission', () => {
    const [row] = buildTimeReportRows([entry('e1')], definition(), false);

    expect(row.cost).toBeNull();
    expect(row.entry).not.toHaveProperty('cost');
    expect(row.entry).not.toHaveProperty('hourlyCost');
  });

  test('uses complete database aggregates when displayed details are truncated', () => {
    const rows = buildTimeReportRows([entry('e1')], definition({ groupBy: ['client'] }), true, [
      { groupLevel: 0, groupValues: ['Acme'], label: 'Acme', duration: 10, cost: 500 },
    ]);

    expect(rows.at(-1)).toMatchObject({ kind: 'subtotal', duration: 10, cost: 500 });
  });

  test('builds totals-only output directly from complete aggregates', () => {
    const rows = buildTimeReportSubtotalRows(
      [
        {
          groupLevel: 1,
          groupValues: ['Acme', 'Portal'],
          label: 'Portal',
          duration: 8,
          cost: 400,
        },
      ],
      definition({ groupBy: ['client', 'project'], totalsOnly: true }),
      true,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      groupLevel: 1,
      projectName: 'Portal',
      duration: 8,
      cost: 400,
    });
  });
});

describe('time report CSV batching', () => {
  test('loads an allowed export in bounded pages', async () => {
    const fetchPage = mock(async (limit: number, offset: number) =>
      Array.from({ length: limit }, (_, index) => entry(`e${offset + index}`)),
    );

    const entries = await collectTimeReportEntryBatches(12_000, fetchPage);

    expect(entries).toHaveLength(12_000);
    expect(fetchPage.mock.calls).toEqual([
      [5_000, 0],
      [5_000, 5_000],
      [2_000, 10_000],
    ]);
  });
});
