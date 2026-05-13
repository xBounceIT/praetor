import { describe, expect, test } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask, TimeEntry } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const WeeklyView = (await import('../../../components/timesheet/WeeklyView')).default;

const alphaCatalog = {
  clients: [{ id: 'client-alpha', name: 'Alpha Client' }] satisfies Client[],
  projects: [
    { id: 'project-alpha', name: 'Alpha Project', clientId: 'client-alpha', color: '#111111' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-alpha', name: 'Alpha Task', projectId: 'project-alpha' },
  ] satisfies ProjectTask[],
};

const betaCatalog = {
  clients: [{ id: 'client-beta', name: 'Beta Client' }] satisfies Client[],
  projects: [
    { id: 'project-beta', name: 'Beta Project', clientId: 'client-beta', color: '#222222' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-beta', name: 'Beta Task', projectId: 'project-beta' },
  ] satisfies ProjectTask[],
};

const todayDateOnly = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

const sharedProps = {
  permissions: [] as string[],
  currency: '€',
  onAddCustomTask: async () =>
    ({ id: 'task-new', name: 'new', projectId: 'project-new' }) as ProjectTask,
  onAddBulkEntries: async () => {},
  onUpdateEntry: () => {},
  onDeleteEntry: () => {},
  viewingUserId: 'user-a',
  selectedDate: todayDateOnly(),
  onSelectedDateChange: () => {},
  startOfWeek: 'Monday' as const,
  treatSaturdayAsHoliday: false,
  allowWeekendSelection: true,
  dailyGoal: 8,
};

describe('<WeeklyView /> RBAC catalog scoping', () => {
  test('drops an entry whose client/project/task is out of the scoped catalogs', async () => {
    // The viewing user has an entry referencing alpha catalog items, but only
    // the beta catalog is currently in scope. The alpha entry must NOT render
    // as a row — silently relabelling it to the beta catalog would mask a
    // real RBAC mismatch.
    const entries: TimeEntry[] = [
      {
        id: 'entry-alpha',
        userId: 'user-a',
        date: todayDateOnly(),
        clientId: 'client-alpha',
        clientName: 'Alpha Client',
        projectId: 'project-alpha',
        projectName: 'Alpha Project',
        task: 'Alpha Task',
        duration: 2,
        hourlyCost: 0,
        createdAt: 1,
        location: 'remote',
      },
    ];

    render(<WeeklyView entries={entries} {...betaCatalog} {...sharedProps} />);

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('pre-fills the form row when the catalog selection matches an existing entry', async () => {
    const entries: TimeEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-a',
        date: todayDateOnly(),
        clientId: 'client-alpha',
        clientName: 'Alpha Client',
        projectId: 'project-alpha',
        projectName: 'Alpha Project',
        task: 'Alpha Task',
        duration: 3.5,
        hourlyCost: 0,
        createdAt: 1700000000,
        location: 'remote',
      },
    ];

    render(<WeeklyView entries={entries} {...alphaCatalog} {...sharedProps} />);

    // The form auto-selects Alpha Task, so the entry collapses into the
    // editable "Nuova voce" row. The pre-filled 3.5h must surface in a
    // day-cell decimal input.
    await waitFor(() => {
      const inputs = document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]');
      const prefilled = Array.from(inputs).some((input) => input.value === '3.5');
      expect(prefilled).toBe(true);
    });
  });
});

// Catalog with two distinct (client, project, task) combos. The catalog
// selection auto-picks the first combo for the form row, so any entry that
// uses the *second* combo stays in the entryRows section — exactly the place
// where the bug manifested before the fix.
const twoComboCatalog = {
  clients: [
    { id: 'client-a', name: 'Client A' },
    { id: 'client-b', name: 'Client B' },
  ] satisfies Client[],
  projects: [
    { id: 'project-a', name: 'Project A', clientId: 'client-a', color: '#111111' },
    { id: 'project-b', name: 'Project B', clientId: 'client-b', color: '#222222' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-a', name: 'Task A', projectId: 'project-a' },
    { id: 'task-b', name: 'Task B', projectId: 'project-b' },
  ] satisfies ProjectTask[],
};

const entryBOn = (date: string): TimeEntry => ({
  id: 'entry-b',
  userId: 'user-a',
  date,
  clientId: 'client-b',
  clientName: 'Client B',
  projectId: 'project-b',
  projectName: 'Project B',
  task: 'Task B',
  duration: 3.5,
  hourlyCost: 0,
  createdAt: 1700000000,
  location: 'remote',
});

const findDurationInputWithValue = (value: string): HTMLInputElement | undefined => {
  const inputs = document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]');
  return Array.from(inputs).find((input) => input.value === value);
};

const clickSubmit = () => {
  const buttons = document.body.querySelectorAll('button');
  const submit = Array.from(buttons).find((b) => b.textContent?.includes('weekly.submitTime'));
  if (!submit) throw new Error('submit button not found');
  fireEvent.click(submit);
  return submit as HTMLButtonElement;
};

describe('<WeeklyView /> submit mutations', () => {
  test('clearing an existing entry calls onDeleteEntry and not onUpdateEntry', async () => {
    // Regression for issue #364 bug 1: prior to the fix, setting duration to 0
    // on an existing entry hit `continue` without calling onUpdateEntry OR
    // onDeleteEntry, so the cell looked cleared in the UI but the entry
    // survived on refresh.
    const today = todayDateOnly();
    const updateCalls: Array<{ id: string; updates: unknown }> = [];
    const deleteCalls: string[] = [];

    render(
      <WeeklyView
        entries={[entryBOn(today)]}
        {...twoComboCatalog}
        {...sharedProps}
        onUpdateEntry={(id, updates) => {
          updateCalls.push({ id, updates });
        }}
        onDeleteEntry={(id) => {
          deleteCalls.push(id);
        }}
      />,
    );

    const durationInput = await waitFor(() => {
      const input = findDurationInputWithValue('3.5');
      if (!input) throw new Error('pre-filled 3.5 input not found');
      return input;
    });

    fireEvent.focus(durationInput);
    fireEvent.change(durationInput, { target: { value: '' } });
    fireEvent.blur(durationInput);

    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-b']);
    });
    expect(updateCalls).toEqual([]);
  });

  test('handleSubmit awaits onUpdateEntry before flashing success', async () => {
    // Regression for issue #364 bug 2: onUpdateEntry was previously invoked
    // without await, so setShowSuccess(true) fired before the PATCH resolved.
    // We expose this by holding the update promise pending and asserting the
    // success state has not been reached.
    const today = todayDateOnly();
    let resolveUpdate: () => void = () => {
      throw new Error('updatePromise executor did not assign resolve');
    };
    const updatePromise = new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    });

    render(
      <WeeklyView
        entries={[entryBOn(today)]}
        {...twoComboCatalog}
        {...sharedProps}
        onUpdateEntry={() => updatePromise}
      />,
    );

    const durationInput = await waitFor(() => {
      const input = findDurationInputWithValue('3.5');
      if (!input) throw new Error('pre-filled 3.5 input not found');
      return input;
    });

    fireEvent.focus(durationInput);
    fireEvent.change(durationInput, { target: { value: '5' } });
    fireEvent.blur(durationInput);

    const submit = clickSubmit();

    // While the update is pending: button disabled and still labelled with
    // `weekly.submitTime` (not the `weekly.success` flash).
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(submit.textContent).toContain('weekly.submitTime');
    expect(submit.textContent).not.toContain('weekly.success');

    resolveUpdate();

    await waitFor(() => {
      const refreshed = Array.from(document.body.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('weekly.success'),
      );
      expect(refreshed).toBeTruthy();
    });
  });
});
