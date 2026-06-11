import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const Calendar = (await import('../../components/shared/Calendar')).default;

describe('<Calendar />', () => {
  // PR #293 moved Calendar day/month strings to i18next. Tests run under the identity
  // mock in test/helpers/i18n.tsx (t(key) => key), so we assert on the literal keys
  // emitted by t(`calendar.daysShort.${key}`) / t(`calendar.months.${key}`).
  const DAY_KEYS_MONDAY = [
    'calendar.daysShort.mon',
    'calendar.daysShort.tue',
    'calendar.daysShort.wed',
    'calendar.daysShort.thu',
    'calendar.daysShort.fri',
    'calendar.daysShort.sat',
    'calendar.daysShort.sun',
  ];
  const DAY_KEY_PATTERN = /^calendar\.daysShort\.(mon|tue|wed|thu|fri|sat|sun)$/;

  test('renders day headers in Monday-first order', () => {
    render(<Calendar startOfWeek="Monday" />);
    DAY_KEYS_MONDAY.forEach((key) => {
      expect(screen.getByText(key)).toBeInTheDocument();
    });
  });

  test('Sunday-first order swaps headers', () => {
    render(<Calendar startOfWeek="Sunday" />);
    const headers = screen.getAllByText(DAY_KEY_PATTERN);
    expect(headers[0].textContent).toBe('calendar.daysShort.sun');
    expect(headers[6].textContent).toBe('calendar.daysShort.sat');
  });

  test('clicking a non-weekend day calls onDateSelect', () => {
    const onDateSelect = mock((_d: string) => {});
    // 2024-03-15 is a Friday (non-holiday in Italy)
    render(
      <Calendar
        selectedDate="2024-03-01"
        onDateSelect={onDateSelect}
        startOfWeek="Monday"
        allowWeekendSelection={false}
      />,
    );

    const day15 = screen.getByText('15');
    fireEvent.click(day15);
    expect(onDateSelect).toHaveBeenCalledWith('2024-03-15');
  });

  test('weekend days are disabled when allowWeekendSelection=false in single mode', () => {
    const onDateSelect = mock((_d: string) => {});
    // 2024-03-09 is a Saturday with treatSaturdayAsHoliday=true → forbidden
    render(
      <Calendar
        selectedDate="2024-03-01"
        onDateSelect={onDateSelect}
        startOfWeek="Monday"
        treatSaturdayAsHoliday
        allowWeekendSelection={false}
      />,
    );

    const day9 = screen.getByText('9');
    const button = day9.closest('button');
    expect(button).not.toBeNull();
    expect(button).toBeDisabled();
  });

  test('allowWeekendSelection=true permits weekend clicks', () => {
    const onDateSelect = mock((_d: string) => {});
    render(
      <Calendar
        selectedDate="2024-03-01"
        onDateSelect={onDateSelect}
        startOfWeek="Monday"
        allowWeekendSelection
      />,
    );
    const day10 = screen.getByText('10'); // Sunday 2024-03-10
    fireEvent.click(day10);
    expect(onDateSelect).toHaveBeenCalledWith('2024-03-10');
  });

  test('allowWeekendSelection=true permits Italian holiday clicks', () => {
    const onDateSelect = mock((_d: string) => {});
    render(
      <Calendar
        selectedDate="2026-05-01"
        onDateSelect={onDateSelect}
        startOfWeek="Monday"
        allowWeekendSelection
      />,
    );
    const day1Buttons = screen.getAllByText('1').map((el) => el.closest('button'));
    const may1Button = day1Buttons.find((button) => button?.textContent === '1');
    expect(may1Button).not.toBeDisabled();
    fireEvent.click(may1Button as HTMLButtonElement);
    expect(onDateSelect).toHaveBeenCalledWith('2026-05-01');
  });

  test('range mode: two clicks emit (start, end)', () => {
    const onRangeSelect = mock((_s: string, _e: string | null) => {});
    const { rerender } = render(
      <Calendar
        selectionMode="range"
        startDate=""
        endDate=""
        onRangeSelect={onRangeSelect}
        startOfWeek="Monday"
        allowWeekendSelection
      />,
    );
    // First click starts the range with end=null.
    fireEvent.click(screen.getByText('1'));
    expect(onRangeSelect).toHaveBeenCalledTimes(1);
    const firstStart = onRangeSelect.mock.calls[0][0] as string;
    expect(firstStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(onRangeSelect.mock.calls[0][1]).toBeNull();

    // The parent would typically push the new range back into props. Simulate that
    // so the second click hits the "complete the range" branch instead of starting
    // a new one.
    rerender(
      <Calendar
        selectionMode="range"
        startDate={firstStart}
        endDate=""
        onRangeSelect={onRangeSelect}
        startOfWeek="Monday"
        allowWeekendSelection
      />,
    );
    fireEvent.click(screen.getByText('5'));
    expect(onRangeSelect).toHaveBeenCalledTimes(2);
    const [secondStart, secondEnd] = onRangeSelect.mock.calls[1];
    expect(secondStart).toBe(firstStart);
    expect(secondEnd).toMatch(/^\d{4}-\d{2}-05$/);
  });

  test('Today button selects today in single mode', () => {
    const onDateSelect = mock((_d: string) => {});
    render(<Calendar onDateSelect={onDateSelect} startOfWeek="Monday" allowWeekendSelection />);
    fireEvent.click(screen.getByText('calendar.today'));
    expect(onDateSelect).toHaveBeenCalled();
    const arg = onDateSelect.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('month picker opens on click and selects a month', () => {
    render(<Calendar selectedDate="2024-03-15" startOfWeek="Monday" />);
    // Click the month-name button in the header (March → calendar.months.march under the
    // identity i18n mock). The picker shows the first 3 chars of each translated name —
    // under the mock that's "cal" for every month, so target the May button by index.
    fireEvent.click(screen.getByText('calendar.months.march'));
    const pickerButtons = screen.getAllByRole('button').filter((btn) => btn.textContent === 'cal');
    expect(pickerButtons.length).toBeGreaterThanOrEqual(12);
    fireEvent.click(pickerButtons[4]); // index 4 = May
    // Header should now show the May key in the title button.
    expect(screen.getByText('calendar.months.may')).toBeInTheDocument();
  });

  test('mousedown outside container closes the open picker', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Calendar selectedDate="2024-03-15" startOfWeek="Monday" />
      </div>,
    );
    fireEvent.click(screen.getByText('calendar.months.march'));
    // Open picker renders 12 month buttons (each rendering "cal" under identity mock).
    expect(screen.getAllByRole('button').filter((b) => b.textContent === 'cal').length).toBe(12);

    fireEvent.mouseDown(screen.getByTestId('outside'));
    // Picker now closed: no "cal" buttons remain.
    expect(screen.queryAllByRole('button').filter((b) => b.textContent === 'cal').length).toBe(0);
  });

  test('navigating across months keeps day keys unique (no React key warnings)', () => {
    // Stable, year-month-day keys mean React never sees duplicate sibling keys
    // when the calendar re-renders for a different month. Spy on console.error
    // and rebuild a few months to confirm none of the warnings trigger.
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const { rerender } = render(<Calendar selectedDate="2024-01-15" startOfWeek="Monday" />);
      rerender(<Calendar selectedDate="2024-02-15" startOfWeek="Monday" />);
      rerender(<Calendar selectedDate="2024-03-15" startOfWeek="Monday" />);
      rerender(<Calendar selectedDate="2024-04-15" startOfWeek="Monday" />);
      const keyWarnings = errors.filter((args) => {
        const msg = Array.isArray(args) && typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('unique "key"') || msg.includes('Encountered two children');
      });
      expect(keyWarnings).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });

  test('Italian holiday Jan 1 marks day as forbidden in single mode', () => {
    const onDateSelect = mock((_d: string) => {});
    render(
      <Calendar
        selectedDate="2025-01-15"
        onDateSelect={onDateSelect}
        startOfWeek="Monday"
        allowWeekendSelection={false}
      />,
    );
    // 2025-01-01 (Capodanno) - disabled because it's a national holiday
    const day1Buttons = screen.getAllByText('1').map((el) => el.closest('button'));
    // The first "1" in the calendar grid is Jan 1, 2025 (Wednesday)
    const jan1Button = day1Buttons.find((btn) => btn?.disabled);
    expect(jan1Button).toBeDefined();
    expect(jan1Button).toBeDisabled();
  });
});
