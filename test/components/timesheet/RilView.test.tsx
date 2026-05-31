import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { GeneralSettings, Project, TimeEntry, User } from '../../../types';
import type { RilWorkbookInput } from '../../../utils/rilExport';
import { installApiMock } from '../../helpers/api';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();
const api = installApiMock();
const downloadRilWorkbookMock = mock(
  async (_input: RilWorkbookInput) => 'RIL_2026_05_User_Name.xlsx',
);

mock.module('../../../utils/rilExport', () => ({
  downloadRilWorkbook: downloadRilWorkbookMock,
}));

const RilView = (await import('../../../components/timesheet/RilView')).default;

const currentUser: User = {
  id: 'u1',
  name: 'User Name',
  role: 'user',
  avatarInitials: 'UN',
  username: 'user',
};

const projects: Project[] = [
  { id: 'p1', name: 'Project', clientId: 'c1', color: '#111111', orderId: 'ORD-1' },
];

const may2026ValidWeekdays = [
  4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29,
];

const entriesForAllMay2026ValidWeekdays = () =>
  may2026ValidWeekdays.map((day) =>
    entry({
      id: `te-2026-05-${day}`,
      date: `2026-05-${String(day).padStart(2, '0')}`,
      location: 'remote',
    }),
  );

const entry = (overrides: Partial<TimeEntry>): TimeEntry => ({
  id: overrides.id ?? 'te-1',
  userId: overrides.userId ?? 'u1',
  date: overrides.date ?? '2026-05-04',
  clientId: overrides.clientId ?? 'c1',
  clientName: overrides.clientName ?? 'Client',
  projectId: overrides.projectId ?? 'p1',
  projectName: overrides.projectName ?? 'Project',
  task: overrides.task ?? 'Dev',
  duration: overrides.duration ?? 8,
  createdAt: overrides.createdAt ?? 1,
  version: overrides.version ?? 1,
  location: overrides.location ?? 'remote',
  ...overrides,
});

const renderRilView = (settingsOverrides: Partial<GeneralSettings> = {}) =>
  render(
    <RilView
      currentUser={currentUser}
      availableUsers={[currentUser]}
      viewingUserId="u1"
      onViewUserChange={() => {}}
      projects={projects}
      settings={{
        rilCompanyName: 'ACME',
        rilDefaultStartTime: '09:00',
        rilDefaultExitTime: '18:00',
        rilLunchBreakMinutes: 60,
        rilNoteOptions: [
          { value: 'P', label: 'Ferie' },
          { value: 'P2', label: 'Permesso' },
          { value: 'M', label: 'Malattia' },
          { value: 'F', label: 'Festivita' },
        ],
        rilTransferOptions: ['In office', 'Remote working'],
        ...settingsOverrides,
      }}
    />,
  );

const mockProjectList = (value: Project[]) => {
  api.projects.list.mockImplementation(() => Promise.resolve(value));
};

describe('<RilView />', () => {
  beforeEach(() => {
    setSystemTime(new Date('2026-05-15T12:00:00Z'));
    api.entries.listPage.mockReset();
    api.projects.list.mockReset();
    mockProjectList(projects);
    api.entries.create.mockReset();
    api.entries.update.mockReset();
    downloadRilWorkbookMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    setSystemTime();
  });

  test('retrieves the selected month and renders translated labels', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    await waitFor(() => expect(api.entries.listPage).toHaveBeenCalled());
    expect(api.entries.listPage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        fromDate: '2026-05-01',
        toDate: '2026-05-31',
        purpose: 'ril',
      }),
    );
    expect(api.projects.list).toHaveBeenCalledWith({ userId: 'u1' });
    expect(screen.getByText('ril.title')).toBeInTheDocument();
    expect(screen.queryByText('ril.tableTitle')).toBeNull();
    expect(screen.getByText('ril.columns.day')).toBeInTheDocument();
    expect(screen.getByText('ril.columns.picap')).toBeInTheDocument();
    expect(screen.getByText('ril.columns.code')).toBeInTheDocument();
    expect(screen.queryByText('ril.columns.phoneAvailability')).toBeNull();
    expect(screen.queryByText('ril.columns.order')).toBeNull();
    expect(await screen.findByLabelText('ril.columns.entrance 4')).toHaveValue('09:00');
    expect(screen.getByLabelText('ril.columns.exit 4')).toHaveValue('18:00');
    expect(screen.getByLabelText('ril.columns.hours 4')).toHaveTextContent('8:00');
    expect(screen.getByLabelText('ril.columns.picap 4')).toHaveTextContent('8');
    expect(screen.getByText('ril.columns.day').closest('th')).toHaveAttribute('colspan', '2');
    const dayCells = screen
      .getByLabelText('ril.columns.entrance 4')
      .closest('tr')
      ?.querySelectorAll('td');
    expect(dayCells?.[0].className).toContain('w-8');
    expect(dayCells?.[0]).toHaveTextContent('lun');
    expect(dayCells?.[1].className).toContain('w-8');
    expect(dayCells?.[1]).toHaveTextContent('4');
    expect(screen.queryByText('ril.entriesLoaded')).toBeNull();
    expect(screen.getByLabelText('ril.summary.workedDays')).toHaveTextContent('20');
    expect(screen.getByLabelText('ril.summary.lunchWindow')).toHaveTextContent('13:00-14:00');
    expect(screen.getByLabelText('ril.summary.extraHours')).toHaveTextContent('0.0');
    expect(screen.getByLabelText('ril.summary.totalHours')).toHaveTextContent('160.0');
    expect(screen.getByLabelText('ril.summary.totalPicap')).toHaveTextContent('160.00');
    expect(screen.getByLabelText('ril.summary.title')).toHaveClass('xl:sticky', 'xl:top-24');
    expect(screen.getByLabelText('ril.summary.title').closest('section')?.className).toContain(
      'xl:grid-cols-[minmax(0,1fr)_15rem]',
    );
    const summaryItem = screen.getByLabelText('ril.summary.workedDays').closest('div');
    expect(summaryItem?.className).toContain('bg-muted/35');
    expect(summaryItem?.className).not.toContain('bg-yellow');
    const lunchSummaryItem = screen.getByLabelText('ril.summary.lunchWindow').closest('div');
    expect(lunchSummaryItem?.querySelector('dt')?.className).toContain('whitespace-nowrap');
    expect(lunchSummaryItem?.querySelector('dd')?.className).toContain('whitespace-nowrap');
  });

  test('selecting month and year reloads and syncs the draft table', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    await waitFor(() =>
      expect(api.entries.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ fromDate: '2026-05-01', toDate: '2026-05-31' }),
      ),
    );

    fireEvent.click(screen.getByLabelText('ril.month'));
    fireEvent.click(screen.getByRole('option', { name: 'June' }));

    await waitFor(() =>
      expect(api.entries.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ fromDate: '2026-06-01', toDate: '2026-06-30' }),
      ),
    );
    expect(screen.getByLabelText('ril.columns.entrance 1')).toHaveValue('09:00');

    fireEvent.click(screen.getByLabelText('ril.year'));
    fireEvent.click(screen.getByRole('option', { name: '2025' }));

    await waitFor(() =>
      expect(api.entries.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ fromDate: '2025-06-01', toDate: '2025-06-30' }),
      ),
    );
  });

  test('loads project catalog for the selected managed user', async () => {
    const managedUser: User = {
      id: 'u2',
      name: 'Managed User',
      role: 'user',
      avatarInitials: 'MU',
      username: 'managed',
    };
    api.entries.listPage.mockResolvedValue({
      entries: entriesForAllMay2026ValidWeekdays().map((timeEntry) => ({
        ...timeEntry,
        userId: 'u2',
        projectId: 'p2',
        projectName: 'Fallback',
      })),
      nextCursor: null,
    });
    mockProjectList([
      { id: 'p2', name: 'Managed Project', clientId: 'c1', color: '#222222', orderId: 'ORD-2' },
    ]);

    render(
      <RilView
        currentUser={currentUser}
        availableUsers={[currentUser, managedUser]}
        viewingUserId="u2"
        onViewUserChange={() => {}}
        projects={projects}
        settings={{
          rilCompanyName: 'ACME',
          rilDefaultStartTime: '09:00',
          rilDefaultExitTime: '18:00',
          rilLunchBreakMinutes: 60,
          rilNoteOptions: [
            { value: 'P', label: 'Ferie' },
            { value: 'P2', label: 'Permesso' },
            { value: 'M', label: 'Malattia' },
            { value: 'F', label: 'Festivita' },
          ],
          rilTransferOptions: ['In office', 'Remote working'],
        }}
      />,
    );

    await waitFor(() => expect(api.projects.list).toHaveBeenCalledWith({ userId: 'u2' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ril.exportExcel/ })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /ril.exportExcel/ }));

    await waitFor(() => expect(downloadRilWorkbookMock).toHaveBeenCalled());
    const exportInput = downloadRilWorkbookMock.mock.calls.at(-1)?.[0];
    expect(exportInput).toMatchObject({ employeeName: 'Managed User' });
    expect(exportInput?.rows.find((row) => row.day === 4)?.order).toBe('ORD-2');
  });

  test('keeps draft edits local, recalculates totals from times, and resets from timesheets', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: [entry({ date: '2026-05-04', duration: 8 })],
      nextCursor: null,
    });

    renderRilView();

    const exitInput = await screen.findByLabelText('ril.columns.exit 4');
    fireEvent.change(exitInput, { target: { value: '17:00' } });
    expect(exitInput).toHaveValue('17:00');
    expect(screen.getByLabelText('ril.columns.hours 4')).toHaveTextContent('7:00');
    expect(screen.getByLabelText('ril.columns.picap 4')).toHaveTextContent('7');

    fireEvent.change(exitInput, { target: { value: '15:00' } });
    expect(exitInput).toHaveValue('15:00');
    expect(screen.getByLabelText('ril.columns.hours 4')).toHaveTextContent('5:00');
    expect(screen.getByLabelText('ril.columns.picap 4')).toHaveTextContent('5');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ril.reset/ })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /ril.reset/ }));
    await waitFor(() => expect(exitInput).toHaveValue('18:00'));
    expect(screen.getByLabelText('ril.columns.hours 4')).toHaveTextContent('8:00');
    expect(screen.getByLabelText('ril.columns.picap 4')).toHaveTextContent('8');
    expect(api.entries.update).not.toHaveBeenCalled();
    expect(api.entries.create).not.toHaveBeenCalled();
  });

  test('highlights holiday rows and keeps them read-only', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    const holidayNotesSelect = await screen.findByLabelText('ril.columns.notes 1');
    expect(holidayNotesSelect).toBeDisabled();
    expect(holidayNotesSelect).toHaveTextContent('F - Festivita');
    expect(holidayNotesSelect.closest('tr')?.className).toContain('bg-amber-50');
    const holidayDayCells = holidayNotesSelect.closest('tr')?.querySelectorAll('td');
    expect(holidayDayCells?.[0]).toHaveTextContent('ven');
    expect(holidayDayCells?.[1]).toHaveTextContent('1');
  });

  test('highlights weekend rows in muted grey without disabling editing', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    const weekendNotesSelect = await screen.findByLabelText('ril.columns.notes 2');
    expect(weekendNotesSelect).not.toBeDisabled();
    expect(weekendNotesSelect.closest('tr')?.className).toContain('bg-zinc-900');
  });

  test('keeps non-month placeholder rows read-only', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    fireEvent.click(screen.getByLabelText('ril.month'));
    fireEvent.click(screen.getByRole('option', { name: 'February' }));

    await waitFor(() =>
      expect(api.entries.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ fromDate: '2026-02-01', toDate: '2026-02-28' }),
      ),
    );
    const placeholderEntrance = await screen.findByLabelText('ril.columns.entrance 30');
    expect(placeholderEntrance).toBeDisabled();
    fireEvent.change(placeholderEntrance, { target: { value: '09:00' } });
    expect(placeholderEntrance).toHaveValue('');

    const placeholderNotes = screen.getByLabelText('ril.columns.notes 30');
    expect(placeholderNotes).toBeDisabled();
    expect(placeholderNotes.closest('tr')?.className).toContain('bg-muted/30');
  });

  test('renders notes, transfer, and code as compact selects', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: [entry({ date: '2026-05-04', duration: 8, location: 'remote' })],
      nextCursor: null,
    });

    renderRilView();

    const notesSelect = await screen.findByLabelText('ril.columns.notes 4');
    expect(notesSelect.tagName).toBe('BUTTON');
    const transferSelect = await screen.findByLabelText('ril.columns.transfer 4');
    expect(transferSelect).toHaveTextContent('Remote working');
    expect(transferSelect.tagName).toBe('BUTTON');
    const codeSelect = await screen.findByLabelText('ril.columns.code 4');
    expect(codeSelect.tagName).toBe('BUTTON');
  });

  test('uses RIL note and transfer options from general settings', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: [entry({ date: '2026-05-04', duration: 8, location: 'remote' })],
      nextCursor: null,
    });

    renderRilView({
      rilNoteOptions: [{ value: 'FEST', label: 'Festivo' }],
      rilTransferOptions: ['Sede configurata', 'Remoto configurato'],
    });

    const holidayNotesSelect = await screen.findByLabelText('ril.columns.notes 1');
    expect(holidayNotesSelect).toHaveTextContent('FEST - Festivo');
    expect(screen.getByLabelText('ril.columns.transfer 4')).toHaveTextContent('Remoto configurato');
  });

  test('uses RIL default exit time from general settings', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView({ rilDefaultStartTime: '08:30', rilDefaultExitTime: '17:30' });

    expect(await screen.findByLabelText('ril.columns.entrance 4')).toHaveValue('08:30');
    expect(screen.getByLabelText('ril.columns.exit 4')).toHaveValue('17:30');
    expect(screen.getByLabelText('ril.columns.hours 4')).toHaveTextContent('8:00');
  });

  test('exports the current draft rows', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: entriesForAllMay2026ValidWeekdays(),
      nextCursor: null,
    });

    renderRilView();

    await screen.findByLabelText('ril.columns.notes 4');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ril.exportExcel/ })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /ril.exportExcel/ }));

    await waitFor(() => expect(downloadRilWorkbookMock).toHaveBeenCalled());
    expect(downloadRilWorkbookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeName: 'User Name',
        companyName: 'ACME',
        year: 2026,
        month: 5,
        defaultStartTime: '09:00',
        defaultExitTime: '18:00',
      }),
    );
  });

  test('requires entrance and exit values on every valid day before export', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: [entry({ date: '2026-05-04', duration: 8 })],
      nextCursor: null,
    });

    renderRilView();

    const entranceInput = await screen.findByLabelText('ril.columns.entrance 4');
    fireEvent.change(entranceInput, { target: { value: '' } });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ril.exportExcel/ })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /ril.exportExcel/ }));

    expect(await screen.findByText('ril.missingTimes')).toBeInTheDocument();
    expect(downloadRilWorkbookMock).not.toHaveBeenCalled();
  });

  test('allows absence-note weekdays to export without times or transfer', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: entriesForAllMay2026ValidWeekdays(),
      nextCursor: null,
    });

    renderRilView();

    const notesSelect = await screen.findByLabelText('ril.columns.notes 4');
    fireEvent.click(notesSelect);
    fireEvent.click(screen.getByRole('option', { name: 'P - Ferie' }));

    expect(screen.getByLabelText('ril.columns.entrance 4')).toHaveValue('');
    expect(screen.getByLabelText('ril.columns.exit 4')).toHaveValue('');
    expect(screen.getByLabelText('ril.columns.hours 4')).toHaveTextContent('-');
    expect(screen.getByLabelText('ril.columns.picap 4')).toHaveTextContent('-');
    expect(screen.getByLabelText('ril.columns.transfer 4')).toHaveTextContent('-');

    fireEvent.click(screen.getByRole('button', { name: /ril.exportExcel/ }));

    await waitFor(() => expect(downloadRilWorkbookMock).toHaveBeenCalled());
    const absenceRow = downloadRilWorkbookMock.mock.calls
      .at(-1)?.[0]
      .rows.find((row) => row.day === 4);
    expect(absenceRow).toMatchObject({
      entrance: '',
      exit: '',
      hours: '',
      hoursDecimal: 0,
      picap: 0,
      notes: 'P',
      transfer: '',
      worked: false,
    });
  });

  test('requires transfer values on every valid day before export', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    await screen.findByLabelText('ril.columns.entrance 4');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ril.exportExcel/ })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /ril.exportExcel/ }));

    expect(await screen.findByText('ril.missingTransfer')).toBeInTheDocument();
    expect(downloadRilWorkbookMock).not.toHaveBeenCalled();
  });
});
