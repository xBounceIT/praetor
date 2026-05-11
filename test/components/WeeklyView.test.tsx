import { describe, expect, mock, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Client, Project, ProjectTask, TimeEntry, User } from '../../types';

// Use stable `t` and `i18n` references. WeeklyView memoizes `weekDays` with `t` in its
// dep array, which combined with the in-render `setState` pattern (rows ← initialRows)
// would infinite-loop if `t` is re-created on every useTranslation call.
const t = (key: string) => key;
const i18n = { language: 'en', changeLanguage: () => {} };
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const WeeklyView = (await import('../../components/timesheet/WeeklyView')).default;

const clients: Client[] = [];
const projects: Project[] = [];
const projectTasks: ProjectTask[] = [];
const entries: TimeEntry[] = [];
const availableUsers: User[] = [
  {
    id: 'u-1',
    name: 'Test User',
    role: 'user',
    avatarInitials: 'TU',
    username: 'testuser',
  },
];

const baseProps = {
  entries,
  clients,
  projects,
  projectTasks,
  onAddBulkEntries: async () => {},
  onDeleteEntry: () => {},
  onUpdateEntry: () => {},
  viewingUserId: 'u-1',
  availableUsers,
  onViewUserChange: () => {},
  treatSaturdayAsHoliday: false,
};

/**
 * The seven `<th>` cells that render `weekly.days.<dayKey>` are the per-day column
 * headers. With the i18n identity mock those labels appear verbatim, so reading
 * them in document order tells us the rendered weekday order.
 */
const getRenderedDayKeys = () =>
  screen
    .getAllByText(/^weekly\.days\.(sun|mon|tue|wed|thu|fri|sat)$/)
    .map((el) => el.textContent?.replace('weekly.days.', '') ?? '');

describe('<WeeklyView /> startOfWeek prop', () => {
  test('startOfWeek="Sunday" renders columns starting on Sunday', () => {
    render(<WeeklyView {...baseProps} startOfWeek="Sunday" />);
    const order = getRenderedDayKeys();
    expect(order[0]).toBe('sun');
    expect(order[6]).toBe('sat');
    expect(order).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  });

  test('startOfWeek="Monday" renders columns starting on Monday', () => {
    render(<WeeklyView {...baseProps} startOfWeek="Monday" />);
    const order = getRenderedDayKeys();
    expect(order[0]).toBe('mon');
    expect(order[6]).toBe('sun');
    expect(order).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });
});
