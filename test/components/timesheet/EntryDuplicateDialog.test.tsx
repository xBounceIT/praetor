import { describe, expect, mock } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { TimeEntry } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';

installI18nMock();

const EntryDuplicateDialog = (await import('../../../components/timesheet/EntryDuplicateDialog'))
  .default;

const sampleEntry: TimeEntry = {
  id: 'te-1',
  userId: 'u-1',
  date: '2024-03-11',
  clientId: 'client-alpha',
  clientName: 'Alpha Client',
  projectId: 'project-alpha',
  projectName: 'Alpha Project',
  task: 'Alpha Task',
  taskId: 'task-alpha',
  notes: 'notes',
  duration: 2.5,
  hourlyCost: 50,
  cost: 125,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1_700_000_000_000,
  version: 1,
};

describe('<EntryDuplicateDialog />', () => {
  test('renders nothing interactive when entry is null', () => {
    render(
      <EntryDuplicateDialog
        entry={null}
        onClose={mock(() => {})}
        onDuplicate={mock(async () => {})}
      />,
    );
    expect(screen.queryByText('entry.duplicateEntry')).not.toBeInTheDocument();
  });

  test('disables submit until a day is selected and submits selected dates', async () => {
    const onDuplicate = mock(async (_dates: string[]) => {});
    const onClose = mock(() => {});

    render(
      <EntryDuplicateDialog
        entry={sampleEntry}
        onClose={onClose}
        onDuplicate={onDuplicate}
        existingConflictDates={['2024-03-11', '2024-03-12']}
      />,
    );

    expect(screen.getByText('entry.duplicateEntry')).toBeInTheDocument();
    expect(screen.getByText(/Alpha Client/)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'entry.duplicate' });
    expect(submit).toBeDisabled();

    // Source day and conflict day are disabled
    expect(screen.getByText('11').closest('button')).toBeDisabled();
    expect(screen.getByText('12').closest('button')).toBeDisabled();

    fireEvent.click(screen.getByText('15'));
    expect(screen.getByRole('button', { name: /entry\.duplicateToDays/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /entry\.duplicateToDays/ }));

    await waitFor(() => {
      expect(onDuplicate).toHaveBeenCalledWith(['2024-03-15']);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('keeps the dialog open when onDuplicate rejects', async () => {
    const onDuplicate = mock(async () => {
      throw new Error('failed');
    });
    const onClose = mock(() => {});

    render(
      <EntryDuplicateDialog entry={sampleEntry} onClose={onClose} onDuplicate={onDuplicate} />,
    );

    fireEvent.click(screen.getByText('14'));
    fireEvent.click(screen.getByRole('button', { name: /entry\.duplicateToDays/ }));

    await waitFor(() => {
      expect(onDuplicate).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('entry.duplicateEntry')).toBeInTheDocument();
  });
});
