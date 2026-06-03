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

const projects: Project[] = [{ id: 'p1', name: 'Project', clientId: 'c1', orderId: 'ORD-1' }];

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
    mockProjectList([{ id: 'p2', name: 'Managed Project', clientId: 'c1', orderId: 'ORD-2' }]);

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

  describe('draft sync', () => {
    const emptyDraft = { monthKey: '', rows: {} as Record<string, unknown>, updatedAt: null };

    beforeEach(() => {
      // Clear call history only — never mockReset, since `remove` shares the suite-wide `noop`
      // mock with other sub-APIs and wiping its implementation would leak into other tests.
      api.rilDrafts.get.mockClear();
      api.rilDrafts.save.mockClear();
      api.rilDrafts.remove.mockClear();
      // `get`/`save` are dedicated mocks; pin a permissive empty-draft default per test.
      api.rilDrafts.get.mockResolvedValue(emptyDraft);
      api.rilDrafts.save.mockResolvedValue(emptyDraft);
      // `remove` is the shared `noop`, which the outer beforeEach wipes via entries.create.
      // Restore a resolving implementation (set, not reset) so handleReset's `.catch` works.
      api.rilDrafts.remove.mockResolvedValue({});
    });

    afterEach(() => {
      // Restore the empty-draft default for the outer suite's tests (still no mockReset).
      api.rilDrafts.get.mockClear();
      api.rilDrafts.save.mockClear();
      api.rilDrafts.remove.mockClear();
      api.rilDrafts.get.mockResolvedValue(emptyDraft);
      api.rilDrafts.save.mockResolvedValue(emptyDraft);
    });

    test('hydrates editable cells from a persisted draft', async () => {
      api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });
      api.rilDrafts.get.mockResolvedValue({
        monthKey: '2026-05',
        rows: {
          '4': { entrance: '08:30', exit: '17:30', notes: '', transfer: 'In office', code: '' },
        },
        updatedAt: '2026-05-10T00:00:00Z',
      });

      renderRilView();

      expect(await screen.findByLabelText('ril.columns.entrance 4')).toHaveValue('08:30');
      expect(screen.getByLabelText('ril.columns.exit 4')).toHaveValue('17:30');
      expect(screen.getByLabelText('ril.columns.transfer 4')).toHaveTextContent('In office');
      expect(api.rilDrafts.get).toHaveBeenCalledWith('2026-05', 'u1');
      // A persisted draft (updatedAt present) surfaces the "saved" status.
      expect(screen.getByText('ril.draft.saved')).toBeInTheDocument();
    });

    test('flushes the pending draft edit when switching month', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });

      renderRilView();

      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      // Wait for the draft GET to resolve so autosave is armed before editing.
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalled());

      fireEvent.change(exitInput, { target: { value: '17:00' } });
      // Editing arms the debounce and shows the saving status.
      expect(screen.getByText('ril.draft.saving')).toBeInTheDocument();

      // Switching months flushes the outgoing month's (May) pending edit before loading the new
      // one, so the in-progress edit is never lost mid-debounce.
      fireEvent.click(screen.getByLabelText('ril.month'));
      fireEvent.click(screen.getByRole('option', { name: 'June' }));

      await waitFor(() =>
        expect(api.rilDrafts.save.mock.calls.some((call) => call[0] === '2026-05')).toBe(true),
      );
      const mayCall = api.rilDrafts.save.mock.calls.find((call) => call[0] === '2026-05');
      expect(mayCall?.[2]).toBe('u1');
      expect(mayCall?.[1]['4']).toMatchObject({ exit: '17:00' });
    });

    test('autosaves the draft edit after the debounce window elapses', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });

      renderRilView();

      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalled());

      fireEvent.change(exitInput, { target: { value: '16:00' } });

      await waitFor(() => expect(api.rilDrafts.save).toHaveBeenCalled(), { timeout: 3000 });
      await waitFor(() => expect(screen.getByText('ril.draft.saved')).toBeInTheDocument());
    });

    test('deletes the persisted draft on reset', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });

      renderRilView();

      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalled());
      // Make an edit so reset has something to clear; autosave is armed by now.
      fireEvent.change(exitInput, { target: { value: '15:00' } });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /ril.reset/ })).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: /ril.reset/ }));

      await waitFor(() => expect(api.rilDrafts.remove).toHaveBeenCalled());
      expect(api.rilDrafts.remove).toHaveBeenCalledWith('2026-05', 'u1');
    });

    test('defers the reset delete until an in-flight save resolves (no resurrection)', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });
      // Hold the autosave PUT open so it is on the wire (timer already fired) when Reset is clicked.
      let resolveSave: (value: {
        monthKey: string;
        rows: Record<string, unknown>;
        updatedAt: string | null;
      }) => void = () => {};
      api.rilDrafts.save.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      );

      renderRilView();

      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalled());
      fireEvent.change(exitInput, { target: { value: '15:00' } });

      // Let the debounce fire so the save is in flight (its promise is still pending).
      await waitFor(() => expect(api.rilDrafts.save).toHaveBeenCalled(), { timeout: 3000 });

      fireEvent.click(screen.getByRole('button', { name: /ril.reset/ }));
      // The delete must be sequenced AFTER the in-flight save, not raced against it.
      expect(api.rilDrafts.remove).not.toHaveBeenCalled();

      resolveSave({ monthKey: '2026-05', rows: {}, updatedAt: null });
      await waitFor(() => expect(api.rilDrafts.remove).toHaveBeenCalledWith('2026-05', 'u1'));
    });

    test('awaits an in-flight switch save before re-reading the same month draft', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });
      // Hold every save open so May's switch-flush PUT is still on the wire when we return to May.
      let resolveSave: (value: {
        monthKey: string;
        rows: Record<string, unknown>;
        updatedAt: string | null;
      }) => void = () => {};
      api.rilDrafts.save.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      );

      renderRilView();

      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalledWith('2026-05', 'u1'));
      // Edit May so the switch flush has a pending draft to persist.
      fireEvent.change(exitInput, { target: { value: '17:00' } });

      // Leave May for June: the flush fires save('2026-05'), which stays pending (deferred above).
      fireEvent.click(screen.getByLabelText('ril.month'));
      fireEvent.click(screen.getByRole('option', { name: 'June' }));
      await waitFor(() =>
        expect(api.rilDrafts.save.mock.calls.some((call) => call[0] === '2026-05')).toBe(true),
      );

      const mayGetCount = () =>
        api.rilDrafts.get.mock.calls.filter((call) => call[0] === '2026-05').length;
      // Only the initial mount has read May's draft; the pending save must block any re-read.
      expect(mayGetCount()).toBe(1);
      const loadsBeforeReturn = api.entries.listPage.mock.calls.length;

      // Return to May while its save is still on the wire.
      fireEvent.click(screen.getByLabelText('ril.month'));
      fireEvent.click(screen.getByRole('option', { name: 'May' }));

      // The entries reload starts immediately, but the draft GET stays gated behind the in-flight
      // PUT so it can't hydrate stale rows. The old fire-and-forget flush re-read the draft here and
      // could lose the just-flushed edit.
      await waitFor(() =>
        expect(api.entries.listPage.mock.calls.length).toBe(loadsBeforeReturn + 1),
      );
      expect(mayGetCount()).toBe(1);

      // Once the save commits, the gated GET runs and reads the freshly-persisted draft.
      resolveSave({ monthKey: '2026-05', rows: {}, updatedAt: null });
      await waitFor(() => expect(mayGetCount()).toBe(2));
    });

    test('serializes overlapping draft saves so a slow PUT cannot be overtaken', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });
      // Defer every save so the first PUT stays in flight while the second is scheduled.
      const resolvers: Array<() => void> = [];
      api.rilDrafts.save.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvers.push(() => resolve(emptyDraft));
          }),
      );

      renderRilView();
      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalled());

      // First edit → its debounced PUT fires and stays in flight.
      fireEvent.change(exitInput, { target: { value: '17:00' } });
      await waitFor(() => expect(api.rilDrafts.save).toHaveBeenCalledTimes(1), { timeout: 3000 });

      // Second edit while the first PUT is pending → its debounced save is scheduled, but the new
      // PUT must stay queued behind the first one (serialized) rather than racing it.
      fireEvent.change(exitInput, { target: { value: '16:00' } });
      // Wait past the 800ms debounce so the second flush has fired; the PUT must still be gated.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(api.rilDrafts.save).toHaveBeenCalledTimes(1);

      // Resolving the first PUT lets the serialized second PUT run — never overlapping.
      resolvers[0]();
      await waitFor(() => expect(api.rilDrafts.save).toHaveBeenCalledTimes(2), { timeout: 3000 });
    }, 10000);

    test('a reload waits for an in-flight reset delete before re-reading the draft', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8 })],
        nextCursor: null,
      });
      // Hold the reset DELETE open so it is still in flight when we navigate back to May.
      let resolveRemove: () => void = () => {};
      api.rilDrafts.remove.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRemove = () => resolve({});
          }),
      );

      renderRilView();
      const exitInput = await screen.findByLabelText('ril.columns.exit 4');
      await waitFor(() => expect(api.rilDrafts.get).toHaveBeenCalledWith('2026-05', 'u1'));

      // Edit then reset: the DELETE fires and stays in flight.
      fireEvent.change(exitInput, { target: { value: '17:00' } });
      fireEvent.click(screen.getByRole('button', { name: /ril.reset/ }));
      await waitFor(() => expect(api.rilDrafts.remove).toHaveBeenCalledWith('2026-05', 'u1'));

      const mayGetCount = () =>
        api.rilDrafts.get.mock.calls.filter((call) => call[0] === '2026-05').length;
      const getBefore = mayGetCount();
      const loadsBefore = api.entries.listPage.mock.calls.length;

      // Leave to June and return to May while the DELETE is still pending.
      fireEvent.click(screen.getByLabelText('ril.month'));
      fireEvent.click(screen.getByRole('option', { name: 'June' }));
      await waitFor(() =>
        expect(api.entries.listPage.mock.calls.length).toBeGreaterThan(loadsBefore),
      );
      fireEvent.click(screen.getByLabelText('ril.month'));
      fireEvent.click(screen.getByRole('option', { name: 'May' }));

      // The May reload starts, but its draft GET must stay gated behind the in-flight DELETE so it
      // can't re-read (and rehydrate) the draft the user just discarded.
      await waitFor(() =>
        expect(api.entries.listPage.mock.calls.length).toBeGreaterThan(loadsBefore + 1),
      );
      expect(mayGetCount()).toBe(getBefore);

      // Once the DELETE commits, the gated GET runs.
      resolveRemove();
      await waitFor(() => expect(mayGetCount()).toBe(getBefore + 1));
    });

    test('applies weekdayTransferDefaults to the user own RIL', async () => {
      api.entries.listPage.mockResolvedValue({
        entries: [entry({ date: '2026-05-04', duration: 8, location: 'remote' })],
        nextCursor: null,
      });

      // renderRilView does not expose weekdayTransferDefaults, so render directly to pass it.
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
          }}
          weekdayTransferDefaults={{ monday: 'Remote working' }}
        />,
      );

      // Day 4 is a Monday in May 2026 (the existing suite asserts its 'lun' weekday label).
      expect(await screen.findByLabelText('ril.columns.transfer 4')).toHaveTextContent(
        'Remote working',
      );
    });
  });
});
