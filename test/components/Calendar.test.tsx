import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const Calendar = (await import('../../components/shared/Calendar')).default;

describe('<Calendar />', () => {
  test('renders Italian day headers in Monday-first order', () => {
    render(<Calendar startOfWeek="Monday" />);
    const headers = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    headers.forEach((h) => {
      expect(screen.getByText(h)).toBeInTheDocument();
    });
  });

  test('Sunday-first order swaps headers', () => {
    render(<Calendar startOfWeek="Sunday" />);
    const headers = screen.getAllByText(/^(Lun|Mar|Mer|Gio|Ven|Sab|Dom)$/);
    expect(headers[0].textContent).toBe('Dom');
    expect(headers[6].textContent).toBe('Sab');
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
    render(
      <Calendar
        selectionMode="range"
        startDate=""
        endDate=""
        onRangeSelect={onRangeSelect}
        startOfWeek="Monday"
        allowWeekendSelection
      />,
    );
    // viewDate defaults to current month — pick days 1 and 5
    fireEvent.click(screen.getByText('1'));
    expect(onRangeSelect).toHaveBeenCalledTimes(1);
    expect(onRangeSelect.mock.calls[0][1]).toBeNull();
  });

  test('Today button selects today in single mode', () => {
    const onDateSelect = mock((_d: string) => {});
    render(<Calendar onDateSelect={onDateSelect} startOfWeek="Monday" allowWeekendSelection />);
    fireEvent.click(screen.getByText('Oggi'));
    expect(onDateSelect).toHaveBeenCalled();
    const arg = onDateSelect.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('month picker opens on click and selects a month', () => {
    render(<Calendar selectedDate="2024-03-15" startOfWeek="Monday" />);
    // Click the month-name button in the header (March in Italian = "Marzo")
    fireEvent.click(screen.getByText('Marzo'));
    // Picker shows abbreviated names — click "Mag" for May
    fireEvent.click(screen.getByText('Mag'));
    // Header should now show full name "Maggio"
    expect(screen.getByText('Maggio')).toBeInTheDocument();
  });

  test('mousedown outside container closes the open picker', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Calendar selectedDate="2024-03-15" startOfWeek="Monday" />
      </div>,
    );
    fireEvent.click(screen.getByText('Marzo'));
    // Picker shows abbreviated month names — "Apr" appears only when picker is open
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
    // 2025-01-01 (Capodanno) — disabled because it's a national holiday
    const day1Buttons = screen.getAllByText('1').map((el) => el.closest('button'));
    // The first "1" in the calendar grid is Jan 1, 2025 (Wednesday)
    const jan1Button = day1Buttons.find((btn) => btn?.disabled);
    expect(jan1Button).toBeDefined();
    expect(jan1Button).toBeDisabled();
  });
});
