import { beforeEach, describe, expect, mock } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimeReportView, {
  type TimeReportViewProps,
} from '../../../components/reports/TimeReportView';
import { CurrentUserIdProvider } from '../../../contexts/CurrentUserContext';

type ReportApi = NonNullable<TimeReportViewProps['reportApi']>;
type SavedViewsApi = NonNullable<TimeReportViewProps['savedViewsApi']>;
type UserCatalogsApi = NonNullable<TimeReportViewProps['userCatalogsApi']>;

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
const getTrackerCatalogsMock = mock();
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
const userCatalogsApi = {
  getTrackerCatalogs: getTrackerCatalogsMock,
} as unknown as UserCatalogsApi;

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
    getTrackerCatalogsMock,
    scrollIntoViewMock,
  ]) {
    fn.mockReset();
  }
  optionsMock.mockResolvedValue({
    editableUserIds: ['u1'],
    users: [
      { id: 'u1', name: 'Alice' },
      { id: 'u2', name: 'Bob' },
    ],
    clients: [],
    projects: [],
    tasks: [],
  });
  listViewsMock.mockResolvedValue([]);
  getTrackerCatalogsMock.mockResolvedValue({ clients: [], projects: [], projectTasks: [] });
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
        onUpdateEntry={mock()}
        onAddCustomTask={mock()}
        reportApi={reportApi}
        userCatalogsApi={userCatalogsApi}
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

  test('defers revoking the CSV object URL until after the download click', async () => {
    const createObjectUrl = mock(() => 'blob:time-report');
    const revokeObjectUrl = mock(() => undefined);
    const anchorClick = mock(() => undefined);
    const previousCreateObjectUrl = URL.createObjectURL;
    const previousRevokeObjectUrl = URL.revokeObjectURL;
    const previousAnchorClick = HTMLAnchorElement.prototype.click;
    let resolveExport: ((blob: Blob) => void) | undefined;

    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
    HTMLAnchorElement.prototype.click = anchorClick;
    exportCsvMock.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          resolveExport = resolve;
        }),
    );

    try {
      renderView(['reports.time_report.view']);
      fireEvent.click(await screen.findByText('timeReport.actions.generate'));
      await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));

      fireEvent.click(await screen.findByText('table.export'));
      await waitFor(() => expect(exportCsvMock).toHaveBeenCalledTimes(1));
      await act(async () => {
        resolveExport?.(new Blob(['csv']));
        await Promise.resolve();
      });

      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrl).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:time-report');
    } finally {
      URL.createObjectURL = previousCreateObjectUrl;
      URL.revokeObjectURL = previousRevokeObjectUrl;
      HTMLAnchorElement.prototype.click = previousAnchorClick;
    }
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
  test('searches clients and limits the project filter to all or one project', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue({
      editableUserIds: ['u1'],
      users: [{ id: 'u1', name: 'Alice' }],
      clients: [
        { id: 'c1', name: 'Acme' },
        { id: 'c2', name: 'Beta' },
      ],
      projects: [
        { id: 'p1', name: 'Migration', clientId: 'c2' },
        { id: 'p2', name: 'Portal', clientId: 'c2' },
      ],
      tasks: [],
    });
    renderView(['reports.time_report.view']);

    await user.click(await screen.findByRole('button', { name: 'timeReport.filters.allClients' }));
    await user.type(screen.getByPlaceholderText('select.search'), 'beta');
    expect(screen.queryByText('Acme')).toBeNull();
    await user.click(screen.getByText('Beta'));

    await user.click(screen.getByRole('button', { name: 'timeReport.filters.allProjects' }));
    expect(screen.queryByRole('button', { name: 'select.selectAll' })).toBeNull();
    await user.click(screen.getByText('Migration'));
    await user.click(screen.getByRole('button', { name: 'Migration' }));
    await user.click(screen.getByText('Portal'));
    await user.click(screen.getByText('timeReport.actions.generate'));

    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    expect(generateMock.mock.calls[0]?.[0]).toMatchObject({
      clientId: 'c2',
      projectIds: ['p2'],
    });

    await user.click(screen.getByRole('button', { name: 'Portal' }));
    await user.click(screen.getByText('timeReport.filters.allProjects'));
    await user.click(screen.getByText('timeReport.actions.generate'));

    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2));
    expect(generateMock.mock.calls[1]?.[0]).toMatchObject({ projectIds: [] });
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

  test('hides edit actions for users outside the editable scope', async () => {
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

  test('shows the standard row actions menu for a managed user entry', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue({
      editableUserIds: ['u1', 'u2'],
      users: [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: 'Bob' },
      ],
      clients: [],
      projects: [],
      tasks: [],
    });
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
          entry: {
            id: 'e1',
            userId: 'u2',
            date: '2026-07-10',
            clientId: 'c1',
            clientName: 'Acme',
            projectId: 'p1',
            projectName: 'Portal',
            task: 'Build',
            taskId: 't1',
            notes: null,
            duration: 2,
            hourlyCost: 0,
            cost: 0,
            isPlaceholder: false,
            location: 'remote',
            createdAt: 1,
            version: 1,
          },
        },
      ],
      matchedEntryCount: 1,
      outputRowCount: 1,
      truncated: false,
      totals: { duration: 2, cost: null },
    });

    renderView([
      'reports.time_report.view',
      'reports.time_report_all.view',
      'timesheets.tracker.view',
      'timesheets.tracker.update',
    ]);
    fireEvent.click(await screen.findByText('timeReport.actions.generate'));

    await user.click(await screen.findByLabelText('table.rowActions'));
    await user.click(await screen.findByLabelText('timeReport.actions.edit'));
    await waitFor(() => expect(getTrackerCatalogsMock).toHaveBeenCalledWith('u2'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
