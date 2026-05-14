import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask, TimeEntry } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const toastErrorMock = mock(() => {});
mock.module('../../../utils/toast', () => ({
  toastError: toastErrorMock,
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

const EntryEditDialog = (await import('../../../components/timesheet/EntryEditDialog')).default;

const clients: Client[] = [
  { id: 'client-alpha', name: 'Alpha Client' },
  { id: 'client-beta', name: 'Beta Client' },
];

const projects: Project[] = [
  { id: 'project-alpha', name: 'Alpha Project', clientId: 'client-alpha', color: '#111111' },
  { id: 'project-beta', name: 'Beta Project', clientId: 'client-beta', color: '#222222' },
];

const projectTasks: ProjectTask[] = [
  { id: 'task-alpha', name: 'Alpha Task', projectId: 'project-alpha' },
  { id: 'task-alpha-2', name: 'Alpha QA', projectId: 'project-alpha' },
  { id: 'task-beta', name: 'Beta Task', projectId: 'project-beta' },
];

const sampleEntry: TimeEntry = {
  id: 'te-1',
  userId: 'u-1',
  date: '2026-05-11',
  clientId: 'client-alpha',
  clientName: 'Alpha Client',
  projectId: 'project-alpha',
  projectName: 'Alpha Project',
  task: 'Alpha Task',
  taskId: 'task-alpha',
  notes: 'initial notes',
  duration: 2.5,
  hourlyCost: 50,
  cost: 125,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1_700_000_000_000,
};

const baseProps = {
  clients,
  projects,
  projectTasks,
  permissions: [],
  currency: '$',
  onAddCustomTask: mock(() => Promise.resolve(undefined)) as never,
};

describe('<EntryEditDialog />', () => {
  test('renders nothing when entry is null', () => {
    const { container } = render(
      <EntryEditDialog
        {...baseProps}
        entry={null}
        onClose={mock(() => {})}
        onSave={mock(() => {})}
      />,
    );
    expect(container).not.toHaveTextContent('entry.editEntry');
  });

  test('pre-populates fields from the entry and saves the edited duration + notes', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    // Hours input shows the original duration; notes input shows the original notes.
    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    const notesInput = document.getElementById('entry-edit-notes') as HTMLInputElement;
    expect(hoursInput.value).toBe('2.5');
    expect(notesInput.value).toBe('initial notes');

    fireEvent.change(hoursInput, { target: { value: '3.25' } });
    fireEvent.change(notesInput, { target: { value: 'updated notes' } });

    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const [id, patch] = (onSave as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Partial<TimeEntry>,
    ];
    expect(id).toBe('te-1');
    expect(patch).toEqual({ duration: 3.25, notes: 'updated notes' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('does not call onSave when no field changed; still closes', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  test('keeps the dialog open and surfaces a toast when onSave rejects', async () => {
    toastErrorMock.mockClear();
    const onSave = mock(() => Promise.reject(new Error('Server said no')));
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    fireEvent.change(hoursInput, { target: { value: '4' } });
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Server said no');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('allows editing other fields on a duration=0 placeholder entry', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={{ ...sampleEntry, duration: 0, isPlaceholder: true }}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    const notesInput = document.getElementById('entry-edit-notes') as HTMLInputElement;
    expect(hoursInput.value).toBe('0');

    fireEvent.change(notesInput, { target: { value: 'placeholder note' } });
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const [, patch] = (onSave as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Partial<TimeEntry>,
    ];
    expect(patch).toEqual({ notes: 'placeholder note' });
  });

  test('cancel closes without saving', () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    fireEvent.change(hoursInput, { target: { value: '9' } });

    const cancelButtons = Array.from(document.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('common:buttons.cancel'),
    );
    expect(cancelButtons.length).toBeGreaterThan(0);
    fireEvent.click(cancelButtons[0]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
