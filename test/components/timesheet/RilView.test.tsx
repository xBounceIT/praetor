import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Project, TimeEntry, User } from '../../../types';
import { installApiMock } from '../../helpers/api';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();
const api = installApiMock();
const downloadRilWorkbookMock = mock(async () => 'RIL_2026_05_User_Name.xlsx');

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

const renderRilView = () =>
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
        rilLunchBreakMinutes: 60,
      }}
    />,
  );

describe('<RilView />', () => {
  beforeEach(() => {
    api.entries.listPage.mockReset();
    api.entries.create.mockReset();
    api.entries.update.mockReset();
    downloadRilWorkbookMock.mockClear();
  });

  afterEach(() => {
    cleanup();
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
      }),
    );
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

  test('exports the current draft rows', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: [entry({ date: '2026-05-04', duration: 8 })],
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
});
