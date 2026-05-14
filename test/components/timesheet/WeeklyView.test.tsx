import { describe, expect, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

// Two distinct (client, project, task) combos. The form auto-selects the first
// combo, so an entry referencing the *second* combo lands in entryRows rather
// than collapsing into the form row.
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

const getSubmitButton = () => screen.getByRole('button', { name: /weekly\.(submitTime|success)/ });

const clickSubmit = () => {
  const submit = getSubmitButton();
  fireEvent.click(submit);
  return submit as HTMLButtonElement;
};

const setDurationInput = (input: HTMLInputElement, value: string) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

const waitForDurationInputs = async (predicate: (inputs: HTMLInputElement[]) => boolean) =>
  waitFor(() => {
    const inputs = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    );
    if (!predicate(inputs)) throw new Error('expected duration inputs not yet rendered');
    return inputs;
  });

describe('<WeeklyView /> submit mutations', () => {
  test('clearing an existing entry-row cell calls onDeleteEntry and not onUpdateEntry', async () => {
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

    setDurationInput(durationInput, '');
    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-b']);
    });
    expect(updateCalls).toEqual([]);
  });

  test('clearing a form-row cell that maps to an existing entry calls onDeleteEntry', async () => {
    // The single-combo catalog auto-selects, collapsing the matching entry
    // into the form row. Clearing it must still flow through submitRow so
    // hasFormChanges triggers the delete instead of dropping the edit.
    const today = todayDateOnly();
    const deleteCalls: string[] = [];

    render(
      <WeeklyView
        entries={[
          {
            ...entryBOn(today),
            id: 'entry-a',
            clientId: 'client-a',
            clientName: 'Client A',
            projectId: 'project-a',
            projectName: 'Project A',
            task: 'Task A',
          },
        ]}
        clients={[{ id: 'client-a', name: 'Client A' }]}
        projects={[{ id: 'project-a', name: 'Project A', clientId: 'client-a', color: '#111' }]}
        projectTasks={[{ id: 'task-a', name: 'Task A', projectId: 'project-a' }]}
        {...sharedProps}
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

    setDurationInput(durationInput, '');
    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-a']);
    });
  });

  test('one submit dispatches mixed add, update, and delete batches', async () => {
    // Row with two existing entries on two different days: clear one (delete),
    // change the other (update), and fill an empty day (add). All three batches
    // must fire from the same submit and resolve before success flashes.
    const today = todayDateOnly();
    const previousDay = (() => {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const addCalls: unknown[][] = [];
    const updateCalls: Array<{ id: string; updates: unknown }> = [];
    const deleteCalls: string[] = [];

    render(
      <WeeklyView
        entries={[
          { ...entryBOn(today), id: 'entry-today', duration: 2 },
          { ...entryBOn(previousDay), id: 'entry-prev', duration: 4 },
        ]}
        {...twoComboCatalog}
        {...sharedProps}
        onAddBulkEntries={async (entries) => {
          addCalls.push(entries);
        }}
        onUpdateEntry={(id, updates) => {
          updateCalls.push({ id, updates });
        }}
        onDeleteEntry={(id) => {
          deleteCalls.push(id);
        }}
      />,
    );

    const inputs = await waitForDurationInputs(
      (xs) => xs.some((i) => i.value === '2') && xs.some((i) => i.value === '4'),
    );
    const todayInput = inputs.find((i) => i.value === '2');
    const prevInput = inputs.find((i) => i.value === '4');
    if (!todayInput || !prevInput) throw new Error('expected both pre-filled inputs');

    setDurationInput(prevInput, '');
    setDurationInput(todayInput, '6');

    const emptyInput = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    ).find((i) => i.value === '' && !i.disabled && i !== prevInput);
    if (!emptyInput) throw new Error('no empty day-cell input available');
    setDurationInput(emptyInput, '1.5');

    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-prev']);
      expect(updateCalls.map((c) => c.id)).toEqual(['entry-today']);
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).toHaveLength(1);
      expect(addCalls[0][0] as Record<string, unknown>).not.toHaveProperty('hourlyCost');
    });
  });

  test('handleSubmit awaits onUpdateEntry before flashing success', async () => {
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

    setDurationInput(durationInput, '5');

    const submit = clickSubmit();

    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(submit.textContent).toContain('weekly.submitTime');
    expect(submit.textContent).not.toContain('weekly.success');

    resolveUpdate();

    await waitFor(() => {
      expect(getSubmitButton().textContent).toContain('weekly.success');
    });
  });
});
