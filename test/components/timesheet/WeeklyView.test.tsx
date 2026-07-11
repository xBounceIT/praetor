import { describe, expect, spyOn, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask, TimeEntry } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const WeeklyView = (await import('../../../components/timesheet/WeeklyView')).default;

const alphaCatalog = {
  clients: [{ id: 'client-alpha', name: 'Alpha Client' }] satisfies Client[],
  projects: [
    { id: 'project-alpha', name: 'Alpha Project', clientId: 'client-alpha' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-alpha', name: 'Alpha Task', projectId: 'project-alpha' },
  ] satisfies ProjectTask[],
};

const betaCatalog = {
  clients: [{ id: 'client-beta', name: 'Beta Client' }] satisfies Client[],
  projects: [
    { id: 'project-beta', name: 'Beta Project', clientId: 'client-beta' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-beta', name: 'Beta Task', projectId: 'project-beta' },
  ] satisfies ProjectTask[],
};

const weeklyExpiredCatalog = {
  clients: [
    { id: 'client-active', name: 'Active Client' },
    { id: 'client-expired', name: 'Expired Client' },
  ] satisfies Client[],
  projects: [
    { id: 'project-active', name: 'Active Project', clientId: 'client-active' },
    {
      id: 'project-expired',
      name: 'Expired Project',
      clientId: 'client-expired',
      endDate: '2000-01-01',
    },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-active', name: 'Active Task', projectId: 'project-active' },
    { id: 'task-expired', name: 'Expired Task', projectId: 'project-expired' },
  ] satisfies ProjectTask[],
};

const todayDateOnly = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

// Local-time date arithmetic on a YYYY-MM-DD string. Mirrors how WeeklyView
// parses dates (local midnight), so the result lands in the same rendered week
// regardless of the runner's timezone.
const addDaysLocal = (dateOnly: string, delta: number): string => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

// A day adjacent to `today` that is guaranteed to fall inside the same
// Monday-started week. Every weekday's previous day stays in-week except
// Monday's (its previous day is the prior week's Sunday), so on Monday we step
// forward instead. Prevents the mixed-batch test from flaking on Mondays, when
// `today - 1` would render outside the current week and never appear in the grid.
const sameWeekSiblingDay = (today: string): string => {
  const [year, month, day] = today.split('-').map(Number);
  const isMonday = new Date(year, month - 1, day).getDay() === 1;
  return addDaysLocal(today, isMonday ? 1 : -1);
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
  test('keeps holiday and weekend duration cells editable when weekend selection is allowed', async () => {
    render(
      <WeeklyView
        entries={[]}
        {...alphaCatalog}
        {...sharedProps}
        selectedDate="2026-05-01"
        allowWeekendSelection
        treatSaturdayAsHoliday
      />,
    );

    await waitFor(() => {
      const durationInputs = Array.from(
        document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
      );
      expect(durationInputs.length).toBeGreaterThanOrEqual(7);
      expect(durationInputs[4]).not.toBeDisabled();
      expect(durationInputs[5]).not.toBeDisabled();
      expect(durationInputs[6]).not.toBeDisabled();
    });
  });

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
        version: 1,
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

  test('renders an existing entry as its own row with pre-filled hours', async () => {
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
        version: 1,
        location: 'remote',
      },
    ];

    render(<WeeklyView entries={entries} {...alphaCatalog} {...sharedProps} />);

    await waitFor(() => {
      const inputs = document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]');
      const prefilled = Array.from(inputs).some((input) => input.value === '3,5');
      expect(prefilled).toBe(true);
    });
  });

  test('exports localized hours without corrupting row totals', async () => {
    const csvModule = await import('../../../utils/csv');
    const downloadCsvSpy = spyOn(csvModule, 'downloadCsv').mockImplementation(() => () => {});

    try {
      // A fresh module instance ensures this test observes the CSV spy even when another test file
      // imported WeeklyView first through Bun's shared module registry.
      // @ts-expect-error -- query-suffixed specifier is intentionally unresolvable to tsc
      const CsvWeeklyView = (await import('../../../components/timesheet/WeeklyView.tsx?csv-test'))
        .default;
      const entries: TimeEntry[] = [
        {
          id: 'entry-csv',
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
          version: 1,
          location: 'remote',
        },
      ];

      render(<CsvWeeklyView entries={entries} {...alphaCatalog} {...sharedProps} />);
      fireEvent.click(await screen.findByRole('button', { name: 'common:table.exportToCsv' }));

      expect(downloadCsvSpy).toHaveBeenCalledTimes(1);
      const rows = downloadCsvSpy.mock.calls[0]?.[0];
      const entryRow = rows?.find((row) =>
        row[0].includes('Alpha Client · Alpha Project · Alpha Task'),
      );
      expect(entryRow).toBeDefined();
      expect(entryRow?.at(-1)).toBe('3,50');
    } finally {
      downloadCsvSpy.mockRestore();
    }
  });

  test('keeps existing expired-project rows visible while new-entry selection uses active projects', async () => {
    const entries: TimeEntry[] = [
      {
        id: 'entry-expired',
        userId: 'user-a',
        date: todayDateOnly(),
        clientId: 'client-expired',
        clientName: 'Expired Client',
        projectId: 'project-expired',
        projectName: 'Expired Project',
        task: 'Expired Task',
        duration: 2,
        hourlyCost: 0,
        createdAt: 1700000000,
        version: 1,
        location: 'remote',
      },
    ];

    render(<WeeklyView entries={entries} {...weeklyExpiredCatalog} {...sharedProps} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Expired Project');
      expect(document.body).toHaveTextContent('Expired Task');
      expect(document.body).toHaveTextContent('Active Project');
      expect(document.body).toHaveTextContent('Active Task');
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
    { id: 'project-a', name: 'Project A', clientId: 'client-a' },
    { id: 'project-b', name: 'Project B', clientId: 'client-b' },
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
  version: 7,
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
      const input = findDurationInputWithValue('3,5');
      if (!input) throw new Error('pre-filled 3,5 input not found');
      return input;
    });

    setDurationInput(durationInput, '');
    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-b']);
    });
    expect(updateCalls).toEqual([]);
  });

  test('clearing an entry-row cell triggers onDeleteEntry even when the catalog has a single combo', async () => {
    // With a single-combo catalog the form auto-selects that combo, but the
    // existing entry still renders as its own Phase 1 row (keyed by entry.id).
    // Clearing it must flow through submitRow and delete the entry.
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
        projects={[{ id: 'project-a', name: 'Project A', clientId: 'client-a' }]}
        projectTasks={[{ id: 'task-a', name: 'Task A', projectId: 'project-a' }]}
        {...sharedProps}
        onDeleteEntry={(id) => {
          deleteCalls.push(id);
        }}
      />,
    );

    const durationInput = await waitFor(() => {
      const input = findDurationInputWithValue('3,5');
      if (!input) throw new Error('pre-filled 3,5 input not found');
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
    const previousDay = sameWeekSiblingDay(today);
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
    setDurationInput(emptyInput, '1,5');

    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-prev']);
      expect(updateCalls.map((c) => c.id)).toEqual(['entry-today']);
      expect(updateCalls[0].updates).toMatchObject({ version: 7 });
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).toHaveLength(1);
      expect(addCalls[0][0] as Record<string, unknown>).not.toHaveProperty('hourlyCost');
    });
  });

  test('renders two TimeEntries sharing (client, project, task, date) as independent rows', async () => {
    // Regression: the old per-combo grouping wrote `baseDays[entry.date]` in
    // a loop and the second entry overwrote the first, so duplicates were
    // invisible in the UI. With one row per entry both must render and be
    // independently deletable.
    const today = todayDateOnly();
    const deleteCalls: string[] = [];
    const updateCalls: Array<{ id: string; updates: unknown }> = [];

    render(
      <WeeklyView
        entries={[
          { ...entryBOn(today), id: 'entry-b-1', duration: 2, createdAt: 1 },
          { ...entryBOn(today), id: 'entry-b-2', duration: 5, createdAt: 2 },
        ]}
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

    const inputs = await waitForDurationInputs(
      (xs) => xs.some((i) => i.value === '2') && xs.some((i) => i.value === '5'),
    );
    const twoInput = inputs.find((i) => i.value === '2');
    if (!twoInput) throw new Error('expected 2h input to render');

    setDurationInput(twoInput, '');
    clickSubmit();

    await waitFor(() => {
      expect(deleteCalls).toEqual(['entry-b-1']);
    });
    expect(updateCalls).toEqual([]);
  });

  test('typing hours on an empty day of a Phase 1 row creates a new entry with that row combo', async () => {
    // A Phase 1 row is keyed by an existing entry's id, but the user can fill
    // any of its empty day cells to add a new entry against the same
    // (client, project, task) — the row's location carries forward.
    const today = todayDateOnly();
    const addCalls: Array<Record<string, unknown>[]> = [];

    render(
      <WeeklyView
        entries={[entryBOn(today)]}
        {...twoComboCatalog}
        {...sharedProps}
        onAddBulkEntries={async (entries) => {
          addCalls.push(entries as unknown as Record<string, unknown>[]);
        }}
      />,
    );

    const filledInput = await waitFor(() => {
      const input = findDurationInputWithValue('3,5');
      if (!input) throw new Error('pre-filled 3,5 input not found');
      return input;
    });

    const row = filledInput.closest('tr');
    if (!row) throw new Error('phase 1 row not found');
    const emptyInRow = Array.from(
      row.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    ).find((i) => i !== filledInput && i.value === '' && !i.disabled);
    if (!emptyInRow) throw new Error('no empty day cell in the phase 1 row');

    setDurationInput(emptyInRow, '1,5');
    clickSubmit();

    await waitFor(() => {
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).toHaveLength(1);
      const added = addCalls[0][0];
      expect(added.task).toBe('Task B');
      expect(added.clientId).toBe('client-b');
      expect(added.projectId).toBe('project-b');
      expect(added.duration).toBe(1.5);
      expect(added.location).toBe('remote');
      expect(added.date).not.toBe(today);
    });
  });

  test('renders an out-of-week combo as an empty quick-log row', async () => {
    // Phase 2: a combo with no current-week entries surfaces as an empty
    // quick-log row keyed by `combo:…`. The historical entry itself is not
    // pre-filled anywhere, but the user can type into the row to log against
    // the same combo on any day of the visible week.
    const lastMonth = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 40);
      return d.toISOString().slice(0, 10);
    })();

    render(<WeeklyView entries={[entryBOn(lastMonth)]} {...twoComboCatalog} {...sharedProps} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Task B');
    });

    const inputs = document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]');
    const prefilled = Array.from(inputs).some((i) => i.value === '3,5');
    expect(prefilled).toBe(false);
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
      const input = findDurationInputWithValue('3,5');
      if (!input) throw new Error('pre-filled 3,5 input not found');
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
