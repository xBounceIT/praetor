import { beforeEach, describe, expect, mock } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimeReportView, {
  type TimeReportViewProps,
} from '../../../components/reports/TimeReportView';
import { CurrentUserIdProvider } from '../../../contexts/CurrentUserContext';

type ReportApi = NonNullable<TimeReportViewProps['reportApi']>;
type SavedViewsApi = NonNullable<TimeReportViewProps['savedViewsApi']>;

import { getLocalDateString } from '../../../utils/date';
import { installI18nMock } from '../../helpers/i18n';
import { reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';

installI18nMock();

const optionsMock = mock();
const generateMock = mock();
const exportCsvMock = mock();
const listViewsMock = mock();
const createViewMock = mock();
const removeViewMock = mock();
const scrollIntoViewMock = mock();
const reportApi = {
  options: optionsMock,
  generate: generateMock,
  exportCsv: exportCsvMock,
} as unknown as ReportApi;
const savedViewsApi = {
  list: listViewsMock,
  create: createViewMock,
  remove: removeViewMock,
} as unknown as SavedViewsApi;

beforeEach(() => {
  Element.prototype.scrollIntoView =
    scrollIntoViewMock as unknown as typeof Element.prototype.scrollIntoView;
  for (const fn of [
    optionsMock,
    generateMock,
    exportCsvMock,
    listViewsMock,
    createViewMock,
    removeViewMock,
    scrollIntoViewMock,
  ]) {
    fn.mockReset();
  }
  optionsMock.mockResolvedValue({
    users: [
      { id: 'u1', name: 'Alice' },
      { id: 'u2', name: 'Bob' },
    ],
    clients: [],
    projects: [],
    tasks: [],
  });
  listViewsMock.mockResolvedValue([]);
  generateMock.mockResolvedValue({
    rows: [],
    matchedEntryCount: 0,
    outputRowCount: 0,
    truncated: false,
    totals: { duration: 0, cost: null },
  });
});

const renderView = (permissions: string[]) =>
  render(
    <CurrentUserIdProvider userId="u1">
      <TimeReportView
        permissions={permissions}
        currency="€"
        startOfWeek="Monday"
        clients={[]}
        projects={[]}
        projectTasks={[]}
        onUpdateEntry={mock()}
        onAddCustomTask={mock()}
        reportApi={reportApi}
        savedViewsApi={savedViewsApi}
        currentUserId="u1"
      />
    </CurrentUserIdProvider>,
  );

describe('TimeReportView', () => {
  test('renders the table without a redundant results card and scrolls to it', async () => {
    renderView(['reports.time_report.view']);

    fireEvent.click(await screen.findByText('timeReport.actions.generate'));

    const results = await screen.findByTestId('time-report-results');
    expect(screen.queryByTestId('time-report-results-section')).toBeNull();
    expect(results).not.toHaveAttribute('data-slot', 'card');
    expect(results.querySelector(':scope > [data-slot="card-header"]')).toBeNull();
    await waitFor(() =>
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      }),
    );
  });

  test('uses LDAP-style cards arranged as vertical sections', async () => {
    renderView(['reports.time_report.view']);

    await screen.findByText('timeReport.filters.title');

    const layout = screen.getByTestId('time-report-layout');
    expect(layout).toHaveClass('max-w-5xl', 'space-y-8');

    const sectionIds = [
      'time-report-favorites-section',
      'time-report-filters-section',
      'time-report-fields-section',
      'time-report-groups-section',
    ];
    const sections = sectionIds.map((id) => screen.getByTestId(id));

    expect(
      Array.from(layout.children)
        .filter((element) => sectionIds.includes(element.getAttribute('data-testid') ?? ''))
        .map((element) => element.getAttribute('data-testid')),
    ).toEqual(sectionIds);

    for (const section of sections) {
      expect(section).toHaveClass('border-border', 'bg-background', 'py-0');
      expect(section.querySelector('[data-slot="card-header"]')).toHaveClass(
        'border-b',
        'bg-muted/40',
      );
    }
  });

  test('defaults to the current month and forces self without multi-user scope', async () => {
    renderView(['reports.time_report.view']);

    await screen.findByText('timeReport.filters.title');
    expect(screen.queryByText('timeReport.filters.users')).toBeNull();

    fireEvent.click(screen.getByText('timeReport.actions.generate'));

    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    expect(generateMock.mock.calls[0]?.[0]).toMatchObject({
      periodPreset: 'this_month',
      fromDate: getLocalDateString(monthStart),
      toDate: getLocalDateString(monthEnd),
      userIds: ['u1'],
      fields: ['client', 'project', 'task', 'duration', 'note'],
    });
  });

  test('shows multi-user and cost controls only with their permissions', async () => {
    renderView(['reports.time_report.view', 'reports.time_report_all.view', 'reports.cost.view']);

    await screen.findByText('timeReport.filters.title');
    expect(screen.getByText('timeReport.filters.users')).toBeTruthy();
    expect(screen.getByText('timeReport.columns.cost')).toBeTruthy();
  });

  test('shows the edit action in the row actions menu for an owned detail entry', async () => {
    const user = userEvent.setup();
    generateMock.mockResolvedValue({
      rows: [
        {
          key: 'detail:e1',
          kind: 'detail',
          groupLevel: null,
          label: null,
          date: '2026-07-10',
          userId: 'u1',
          userName: 'Alice',
          clientId: 'c1',
          clientName: 'Acme',
          projectId: 'p1',
          projectName: 'Portal',
          taskId: null,
          taskName: 'Build',
          notes: null,
          duration: 2,
          cost: null,
          entry: { userId: 'u1' },
        },
      ],
      matchedEntryCount: 1,
      outputRowCount: 1,
      truncated: false,
      totals: { duration: 2, cost: null },
    });

    renderView([
      'reports.time_report.view',
      'timesheets.tracker.view',
      'timesheets.tracker.update',
    ]);
    fireEvent.click(await screen.findByText('timeReport.actions.generate'));

    await user.click(await screen.findByLabelText('table.rowActions'));
    expect(await screen.findByLabelText('timeReport.actions.edit')).toBeTruthy();
  });

  test('hides edit actions for other users without all-scope Timesheet permissions', async () => {
    generateMock.mockResolvedValue({
      rows: [
        {
          key: 'detail:e1',
          kind: 'detail',
          groupLevel: null,
          label: null,
          date: '2026-07-10',
          userId: 'u2',
          userName: 'Bob',
          clientId: 'c1',
          clientName: 'Acme',
          projectId: 'p1',
          projectName: 'Portal',
          taskId: null,
          taskName: 'Build',
          notes: null,
          duration: 2,
          cost: null,
          entry: { userId: 'u2' },
        },
      ],
      matchedEntryCount: 1,
      outputRowCount: 1,
      truncated: false,
      totals: { duration: 2, cost: null },
    });

    renderView([
      'reports.time_report.view',
      'timesheets.tracker.view',
      'timesheets.tracker.update',
    ]);
    fireEvent.click(await screen.findByText('timeReport.actions.generate'));

    await screen.findByText('2026-07-10');
    expect(screen.queryByLabelText('timeReport.actions.edit')).toBeNull();
  });
});
