import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask, TimeEntry, User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const WeeklyView = (await import('../../../components/timesheet/WeeklyView')).default;

const availableUsers: User[] = [
  {
    id: 'user-a',
    name: 'User A',
    role: 'user',
    avatarInitials: 'UA',
    username: 'user-a',
  },
];

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

describe('<WeeklyView /> startOfWeek prop', () => {
  const RealDate = Date;
  const FIXED_NOW = new RealDate(2024, 2, 13, 12, 0, 0); // Wed, Mar 13, 2024 noon

  beforeAll(() => {
    class MockDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(FIXED_NOW.getTime());
        } else {
          // @ts-expect-error spread satisfies Date constructor overloads
          super(...args);
        }
      }
      static now() {
        return FIXED_NOW.getTime();
      }
    }
    // @ts-expect-error replace global Date for deterministic week math
    globalThis.Date = MockDate;
  });

  afterAll(() => {
    globalThis.Date = RealDate;
  });

  const baseProps = {
    entries: [],
    clients: [] as Client[],
    projects: [] as Project[],
    projectTasks: [] as ProjectTask[],
    onAddBulkEntries: mock(async () => {}),
    onDeleteEntry: mock(() => {}),
    onUpdateEntry: mock(() => {}),
    viewingUserId: 'user-a',
    availableUsers,
    onViewUserChange: mock(() => {}),
    treatSaturdayAsHoliday: false,
    allowWeekendSelection: true,
  };

  test('Sunday-first ordering puts Sunday in the first column and Saturday last', () => {
    const { container } = render(<WeeklyView {...baseProps} startOfWeek="Sunday" />);
    // Day-of-week header cells contain "weekly.days.{sun|...|sat}" because the
    // i18n mock returns keys verbatim.
    const headerCells = Array.from(container.querySelectorAll('thead th'));
    const dayHeaders = headerCells.filter((cell) =>
      (cell.textContent || '').includes('weekly.days.'),
    );
    expect(dayHeaders.length).toBe(7);
    expect(dayHeaders[0].textContent).toContain('weekly.days.sun');
    expect(dayHeaders[6].textContent).toContain('weekly.days.sat');
  });

  test('Monday-first ordering puts Monday in the first column and Sunday last', () => {
    const { container } = render(<WeeklyView {...baseProps} startOfWeek="Monday" />);
    const headerCells = Array.from(container.querySelectorAll('thead th'));
    const dayHeaders = headerCells.filter((cell) =>
      (cell.textContent || '').includes('weekly.days.'),
    );
    expect(dayHeaders.length).toBe(7);
    expect(dayHeaders[0].textContent).toContain('weekly.days.mon');
    expect(dayHeaders[6].textContent).toContain('weekly.days.sun');
  });

  test('Sunday-first: week containing Wed 2024-03-13 starts on Sun 2024-03-10', () => {
    const { container } = render(<WeeklyView {...baseProps} startOfWeek="Sunday" />);
    const headerCells = Array.from(container.querySelectorAll('thead th'));
    const dayHeaders = headerCells.filter((cell) =>
      (cell.textContent || '').includes('weekly.days.'),
    );
    // First column should display "10" (Sunday Mar 10), last should display "16" (Saturday Mar 16).
    expect(dayHeaders[0].textContent).toContain('10');
    expect(dayHeaders[6].textContent).toContain('16');
  });

  test('Monday-first: week containing Wed 2024-03-13 starts on Mon 2024-03-11', () => {
    const { container } = render(<WeeklyView {...baseProps} startOfWeek="Monday" />);
    const headerCells = Array.from(container.querySelectorAll('thead th'));
    const dayHeaders = headerCells.filter((cell) =>
      (cell.textContent || '').includes('weekly.days.'),
    );
    // First column should display "11" (Monday Mar 11), last should display "17" (Sunday Mar 17).
    expect(dayHeaders[0].textContent).toContain('11');
    expect(dayHeaders[6].textContent).toContain('17');
  });

  test('Week range header spans a full 7-day week, not 5 days', () => {
    const { container } = render(<WeeklyView {...baseProps} startOfWeek="Monday" />);
    // The h3 in the header shows the range from week start to week start + 6 days.
    const heading = container.querySelector('h3');
    expect(heading).not.toBeNull();
    const text = heading?.textContent || '';
    // Must end at day 17 (Sunday Mar 17), not at day 15 (the old +4 buggy offset).
    expect(text).toContain('17');
    expect(text).not.toMatch(/Mar\s*11.*Mar\s*15(?!\d)/);
  });
});

describe('<WeeklyView /> RBAC catalog sync', () => {
  test('rerendering with another scoped catalog rebuilds row selections', async () => {
    const props = {
      entries: [],
      onAddBulkEntries: mock(async () => {}),
      onDeleteEntry: mock(() => {}),
      onUpdateEntry: mock(() => {}),
      viewingUserId: 'user-a',
      availableUsers,
      onViewUserChange: mock(() => {}),
      startOfWeek: 'Monday' as const,
      treatSaturdayAsHoliday: false,
      allowWeekendSelection: true,
    };

    const { rerender } = render(<WeeklyView {...props} {...alphaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Client');
      expect(document.body).toHaveTextContent('Alpha Project');
      expect(document.body).toHaveTextContent('Alpha Task');
    });

    rerender(<WeeklyView {...props} {...betaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Beta Client');
      expect(document.body).toHaveTextContent('Beta Project');
      expect(document.body).toHaveTextContent('Beta Task');
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('does not relabel an existing out-of-scope entry to the first available catalog item', async () => {
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

    render(
      <WeeklyView
        entries={entries}
        {...betaCatalog}
        onAddBulkEntries={mock(async () => {})}
        onDeleteEntry={mock(() => {})}
        onUpdateEntry={mock(() => {})}
        viewingUserId="user-a"
        availableUsers={availableUsers}
        onViewUserChange={mock(() => {})}
        startOfWeek="Monday"
        treatSaturdayAsHoliday={false}
        allowWeekendSelection
      />,
    );

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent('Beta Client');
      expect(document.body).not.toHaveTextContent('Beta Project');
      expect(document.body).not.toHaveTextContent('Beta Task');
    });
  });
});
