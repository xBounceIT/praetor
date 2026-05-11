import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const Calendar = (await import('../../components/shared/Calendar')).default;

describe('<Calendar />', () => {
  test('renders English day headers in Monday-first order (locale-driven via Intl)', () => {
    render(<Calendar startOfWeek="Monday" />);
    const headers = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    headers.forEach((h) => {
      expect(screen.getByText(h)).toBeInTheDocument();
    });
    // No Italian abbreviations should leak through anymore.
    expect(screen.queryByText('Lun')).not.toBeInTheDocument();
    expect(screen.queryByText('Dom')).not.toBeInTheDocument();
  });

  test('Sunday-first order rotates English headers', () => {
    render(<Calendar startOfWeek="Sunday" />);
    const headers = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    expect(headers[0].textContent).toBe('Sun');
    expect(headers[6].textContent).toBe('Sat');
  });

  test('header month name is localized (English January, not Gennaio)', () => {
    render(<Calendar selectedDate="2024-01-15" startOfWeek="Monday" />);
    expect(screen.getByText('January')).toBeInTheDocument();
    expect(screen.queryByText('Gennaio')).not.toBeInTheDocument();
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

  test('Today button selects today in single mode', () => {
    const onDateSelect = mock((_d: string) => {});
    render(<Calendar onDateSelect={onDateSelect} startOfWeek="Monday" allowWeekendSelection />);
    // Translation mock returns the key, so the button label is the i18n key.
    fireEvent.click(screen.getByText('common:time.today'));
    expect(onDateSelect).toHaveBeenCalled();
    const arg = onDateSelect.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('month picker opens on click and selects a month', () => {
    render(<Calendar selectedDate="2024-03-15" startOfWeek="Monday" />);
    // Click the month-name button in the header (English: March)
    fireEvent.click(screen.getByText('March'));
    // Picker shows abbreviated names - click "May"
    fireEvent.click(screen.getByText('May'));
    // Header should now show full name "May"
    expect(screen.getByText('May')).toBeInTheDocument();
  });

  test('mousedown outside container closes the open picker', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Calendar selectedDate="2024-03-15" startOfWeek="Monday" />
      </div>,
    );
    fireEvent.click(screen.getByText('March'));
    // Picker shows abbreviated month names - "Apr" appears only when picker is open
    expect(screen.getByText('Apr')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    // Picker now closed: "Apr" should no longer be in DOM
    expect(screen.queryByText('Apr')).not.toBeInTheDocument();
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
