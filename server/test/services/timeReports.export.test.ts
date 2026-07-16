import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { TimeReportDefinition, TimeReportEntry } from '../../repositories/timeReportsRepo.ts';
import * as realTimeReportsRepo from '../../repositories/timeReportsRepo.ts';

const repoSnapshot = { ...realTimeReportsRepo };
const getTotalsMock = mock();
const listEntriesPageMock = mock();
const listSubtotalsMock = mock();
let generateCompleteTimeReport: typeof import('../../services/timeReports.ts').generateCompleteTimeReport;

const definition: TimeReportDefinition = {
  fromDate: '2026-07-01',
  toDate: '2026-07-31',
  clientId: null,
  projectIds: [],
  task: null,
  noteContains: '',
  fields: ['client', 'duration', 'cost'],
  groupBy: ['client'],
  totalsOnly: false,
};

const entry = (id: string): TimeReportEntry => ({
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
  duration: 1,
  hourlyCost: 0.335,
  cost: 0.34,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1,
  version: 1,
});

beforeAll(async () => {
  mock.module('../../repositories/timeReportsRepo.ts', () => ({
    ...repoSnapshot,
    getTotals: getTotalsMock,
    listEntriesPage: listEntriesPageMock,
    listSubtotals: listSubtotalsMock,
  }));
  ({ generateCompleteTimeReport } = await import('../../services/timeReports.ts'));
});

afterAll(() => {
  mock.module('../../repositories/timeReportsRepo.ts', () => repoSnapshot);
});

beforeEach(() => {
  getTotalsMock.mockReset();
  listEntriesPageMock.mockReset();
  listSubtotalsMock.mockReset();
});

describe('complete time report export', () => {
  test('uses database aggregates for grouped costs with fractional cents', async () => {
    getTotalsMock.mockResolvedValue({ count: 2, duration: 2, cost: 0.67 });
    listEntriesPageMock.mockResolvedValue([entry('e1'), entry('e2')]);
    listSubtotalsMock.mockResolvedValue([
      { groupLevel: 0, groupKeys: ['c1'], label: 'Acme', duration: 2, cost: 0.67 },
    ]);

    const result = await generateCompleteTimeReport(definition, ['u1'], true);

    expect(result.rows.filter((row) => row.kind === 'detail').map((row) => row.cost)).toEqual([
      0.34, 0.34,
    ]);
    expect(result.rows.at(-1)).toMatchObject({ kind: 'subtotal', cost: 0.67 });
    expect(listSubtotalsMock).toHaveBeenCalledWith(definition, ['u1'], 2);
  });

  test('builds totals-only exports without loading detail entries', async () => {
    const totalsOnlyDefinition = { ...definition, totalsOnly: true };
    getTotalsMock.mockResolvedValue({ count: 2, duration: 2, cost: 0.67 });
    listSubtotalsMock.mockResolvedValue([
      { groupLevel: 0, groupKeys: ['c1'], label: 'Acme', duration: 2, cost: 0.67 },
    ]);

    const result = await generateCompleteTimeReport(totalsOnlyDefinition, ['u1'], true);

    expect(listEntriesPageMock).not.toHaveBeenCalled();
    expect(result.rows).toEqual([
      expect.objectContaining({ kind: 'subtotal', label: 'Acme', cost: 0.67 }),
    ]);
  });
});
