import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { act } from 'react';
import type { Client, Project, ProjectTask, TimeEntry } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const WeeklyView = (await import('../../components/timesheet/WeeklyView')).default;

const clients: Client[] = [];
const projects: Project[] = [];
const projectTasks: ProjectTask[] = [];
const entries: TimeEntry[] = [];

const baseProps = {
  entries,
  clients,
  projects,
  projectTasks,
  onAddBulkEntries: async () => {},
  onDeleteEntry: () => {},
  onUpdateEntry: () => {},
  viewingUserId: 'u-1',
  treatSaturdayAsHoliday: false,
  dailyGoal: 8,
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

  test('re-aligns the week when startOfWeek changes after mount', () => {
    // generalSettings loads async, so startOfWeek can flip from Monday → Sunday
    // after the user is already viewing the week. The column order must follow.
    const { rerender } = render(<WeeklyView {...baseProps} startOfWeek="Monday" />);
    expect(getRenderedDayKeys()).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

    act(() => {
      rerender(<WeeklyView {...baseProps} startOfWeek="Sunday" />);
    });

    expect(getRenderedDayKeys()).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  });
});
