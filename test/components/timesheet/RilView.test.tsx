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
    expect(screen.getByText('ril.tableTitle')).toBeInTheDocument();
    expect(screen.getByText('ril.columns.day')).toBeInTheDocument();
    expect(screen.queryByText('ril.columns.order')).toBeNull();
  });

  test('keeps draft edits local and reset rebuilds from timesheets', async () => {
    api.entries.listPage.mockResolvedValue({
      entries: [entry({ date: '2026-05-04', duration: 8 })],
      nextCursor: null,
    });

    renderRilView();

    const notesInput = await screen.findByLabelText('ril.columns.notes 4');
    fireEvent.change(notesInput, { target: { value: 'Draft note' } });
    expect(notesInput).toHaveValue('Draft note');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ril.reset/ })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /ril.reset/ }));
    await waitFor(() => expect(notesInput).toHaveValue(''));
    expect(api.entries.update).not.toHaveBeenCalled();
    expect(api.entries.create).not.toHaveBeenCalled();
  });

  test('highlights holiday rows and keeps them read-only', async () => {
    api.entries.listPage.mockResolvedValue({ entries: [], nextCursor: null });

    renderRilView();

    const holidayNotesInput = await screen.findByLabelText('ril.columns.notes 1');
    expect(holidayNotesInput).toBeDisabled();
    expect(holidayNotesInput).toHaveValue('FN');

    fireEvent.change(holidayNotesInput, { target: { value: 'Changed' } });
    expect(holidayNotesInput).toHaveValue('FN');
    expect(holidayNotesInput.closest('tr')?.className).toContain('bg-amber-50');
    expect(holidayNotesInput.closest('tr')?.querySelector('td')?.textContent).toMatch(/^1\D/);
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
