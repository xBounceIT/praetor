import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const Calendar = (await import('../../components/shared/Calendar')).default;

describe('<Calendar />', () => {
  test('renders day-of-week header keys in Monday-first order', () => {
    render(<Calendar startOfWeek="Monday" />);
    const headers = [
      'calendar.daysShort.mon',
      'calendar.daysShort.tue',
      'calendar.daysShort.wed',
      'calendar.daysShort.thu',
      'calendar.daysShort.fri',
      'calendar.daysShort.sat',
      'calendar.daysShort.sun',
    ];
    headers.forEach((h) => {
      expect(screen.getByText(h)).toBeInTheDocument();
    });
  });

  test('Sunday-first order swaps headers', () => {
    render(<Calendar startOfWeek="Sunday" />);
    const headers = screen.getAllByText(/^calendar\.daysShort\.(mon|tue|wed|thu|fri|sat|sun)$/);
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

  test('Today button uses translation key and selects today in single mode', () => {
    const onDateSelect = mock((_d: string) => {});
    render(<Calendar onDateSelect={onDateSelect} startOfWeek="Monday" allowWeekendSelection />);
    fireEvent.click(screen.getByText('calendar.today'));
    expect(onDateSelect).toHaveBeenCalled();
    const arg = onDateSelect.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('month picker opens on click and selects a month', () => {
    render(<Calendar selectedDate="2024-03-15" startOfWeek="Monday" />);
    // Identity-translator mock returns the translation key verbatim in the header.
    fireEvent.click(screen.getByText('calendar.months.march'));
    // Picker buttons each render `mName.slice(0, 3)` — under identity mock that's
    // the first 3 chars of every key ("cal"), so all 12 picker buttons say "cal".
    const pickerButtons = screen.getAllByText('cal');
    expect(pickerButtons).toHaveLength(12);
    // Click May (index 4 in the picker).
    fireEvent.click(pickerButtons[4] as HTMLElement);
    // Header should now show the May key.
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
    // Picker open → 12 "cal" buttons are in the DOM.
    expect(screen.getAllByText('cal')).toHaveLength(12);

    fireEvent.mouseDown(screen.getByTestId('outside'));
    // Picker now closed → no "cal" buttons remain.
    expect(screen.queryByText('cal')).not.toBeInTheDocument();
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
