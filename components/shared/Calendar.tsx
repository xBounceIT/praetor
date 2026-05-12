import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TimeEntry } from '../../types';
import { dateOnlyStringToLocalDate, getLocalDateString } from '../../utils/date';
import { isItalianHoliday } from '../../utils/holidays';

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

// Day keys run Mon→Sun; rotation handled at render time per `startOfWeek`.
const DAY_KEYS_MONDAY_FIRST = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_KEYS_SUNDAY_FIRST = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface CalendarProps {
  // Original props
  selectedDate?: string;
  onDateSelect?: (date: string) => void;
  entries?: TimeEntry[];
  startOfWeek?: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday?: boolean;
  dailyGoal?: number;

  // New props for range mode
  selectionMode?: 'single' | 'range';
  startDate?: string;
  endDate?: string;
  onRangeSelect?: (start: string, end: string | null) => void;

  // Allow weekend selection (e.g., for time tracker)
  allowWeekendSelection?: boolean;
  size?: 'default' | 'compact';
}

const Calendar: React.FC<CalendarProps> = ({
  selectedDate,
  onDateSelect,
  entries = [],
  startOfWeek = 'Monday',
  treatSaturdayAsHoliday = false,
  dailyGoal = 0,
  selectionMode = 'single',
  startDate,
  endDate,
  onRangeSelect,
  allowWeekendSelection = false,
  size = 'default',
}) => {
  const { t } = useTranslation('timesheets');
  const isCompact = size === 'compact';
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDate) return dateOnlyStringToLocalDate(selectedDate);
    if (startDate) return dateOnlyStringToLocalDate(startDate);
    return new Date();
  });
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMonthPickerOpen(false);
        setIsYearPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const today = getLocalDateString(currentDate);

  const days = [];
  const totalDays = daysInMonth(year, month);
  let offset = firstDayOfMonth(year, month);

  // Adjust offset based on start of week
  if (startOfWeek === 'Monday') {
    offset = (offset + 6) % 7;
  }

  const entryDates = useMemo(() => new Set(entries.map((e) => e.date)), [entries]);
  const dailyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    entries.forEach((e) => {
      totals[e.date] = (totals[e.date] || 0) + e.duration;
    });
    return totals;
  }, [entries]);

  const monthNames = MONTH_KEYS.map((m) => t(`calendar.months.${m}`));
  const dayHeaderKeys = startOfWeek === 'Monday' ? DAY_KEYS_MONDAY_FIRST : DAY_KEYS_SUNDAY_FIRST;
  const dayHeaders = dayHeaderKeys.map((d) => t(`calendar.daysShort.${d}`));

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const handleDateClick = (dateStr: string) => {
    if (selectionMode === 'range' && onRangeSelect) {
      if (!startDate || (startDate && endDate)) {
        // Start a new range
        onRangeSelect(dateStr, null);
      } else {
        // Complete the range
        // Ensure start is before end
        if (dateStr < startDate) {
          onRangeSelect(dateStr, startDate);
        } else {
          onRangeSelect(startDate, dateStr);
        }
      }
    } else if (onDateSelect) {
      onDateSelect(dateStr);
    }
  };

  for (let i = 0; i < offset; i++) {
    days.push(<div key={`empty-${i}`} className={`${isCompact ? 'h-8' : 'h-9'} w-full`}></div>);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    // Selection Logic
    let isSelected = false;
    let isInRange = false;
    let isRangeStart = false;
    let isRangeEnd = false;

    if (selectionMode === 'single') {
      isSelected = dateStr === selectedDate;
    } else {
      isRangeStart = dateStr === startDate;
      isRangeEnd = dateStr === endDate;
      isSelected = isRangeStart || isRangeEnd; // Highlight endpoints clearly
      if (startDate && endDate) {
        isInRange = dateStr >= startDate && dateStr <= endDate;
      }
    }

    const isToday = dateStr === today;
    const hasActivity = entryDates.has(dateStr);

    const dayOfWeek = dateObj.getDay();
    const holidayName = isItalianHoliday(dateObj);
    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;
    const isWeekendOrHoliday = isSunday || (treatSaturdayAsHoliday && isSaturday) || !!holidayName;
    const isForbidden = !allowWeekendSelection && selectionMode === 'single' && isWeekendOrHoliday;
    const holidayLabel =
      holidayName ||
      (isSunday
        ? t('calendar.sunday')
        : isSaturday && treatSaturdayAsHoliday
          ? t('calendar.saturday')
          : '');

    days.push(
      <Tooltip key={d} disabled={!holidayLabel}>
        <TooltipTrigger asChild>
          <span className="inline-flex w-full">
            <button
              type="button"
              disabled={isForbidden}
              onClick={() => {
                if (!isForbidden) handleDateClick(dateStr);
              }}
              className={`relative ${isCompact ? 'h-8 rounded-md' : 'h-9 rounded-lg'} w-full flex flex-col items-center justify-center transition-all border
              ${
                isSelected
                  ? 'bg-secondary text-secondary-foreground border-secondary shadow-md scale-105 z-10'
                  : isInRange
                    ? 'bg-muted text-foreground border-muted'
                    : isWeekendOrHoliday
                      ? 'bg-red-50 text-red-500 border-red-100 dark:bg-red-500/10 dark:border-red-500/20'
                      : dailyTotals[dateStr] >= dailyGoal - 0.01 && dailyGoal > 0
                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20'
                        : isToday
                          ? 'bg-muted text-secondary-foreground border-border'
                          : 'hover:bg-muted border-transparent text-foreground'
              }`}
            >
              <span
                className={`${isCompact ? 'text-[13px]' : 'text-sm'} font-bold ${
                  isSelected || isInRange
                    ? ''
                    : isWeekendOrHoliday
                      ? 'text-red-600 dark:text-red-400'
                      : dailyTotals[dateStr] >= dailyGoal - 0.01 && dailyGoal > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : ''
                }`}
              >
                {d}
              </span>

              {hasActivity && selectionMode === 'single' && (
                <span
                  className={`absolute bottom-1 size-1 rounded-full ${isSelected ? 'bg-secondary-foreground' : isWeekendOrHoliday ? 'bg-red-300' : dailyTotals[dateStr] >= dailyGoal - 0.01 && dailyGoal > 0 ? 'bg-emerald-400' : 'bg-praetor'}`}
                ></span>
              )}
              {holidayName && selectionMode === 'single' && (
                <span className="absolute top-0.5 right-0.5 size-1 bg-red-400 rounded-full animate-pulse"></span>
              )}
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{holidayLabel}</TooltipContent>
      </Tooltip>,
    );
  }

  const handleTodayClick = () => {
    const now = new Date();
    setViewDate(now);
    const todayStr = getLocalDateString(now);
    if (selectionMode === 'single' && onDateSelect) {
      onDateSelect(todayStr);
    }
  };

  return (
    <div
      className={`w-full relative ${
        isCompact
          ? 'p-0 h-full flex flex-col'
          : 'bg-card rounded-lg border border-border shadow-sm p-4'
      }`}
      ref={containerRef}
    >
      <div className={`flex items-center justify-between ${isCompact ? 'mb-3' : 'mb-4'}`}>
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIsMonthPickerOpen(!isMonthPickerOpen);
              setIsYearPickerOpen(false);
            }}
            className={`font-bold text-foreground hover:bg-muted rounded-md transition-colors flex items-center gap-1 ${
              isCompact ? 'px-1.5 py-1 text-[13px]' : 'px-2 py-1 text-sm'
            }`}
          >
            {monthNames[month]}
            <ChevronDown
              aria-hidden="true"
              className={`size-2.5 text-muted-foreground transition-transform ${isMonthPickerOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <button
            type="button"
            onClick={() => {
              setIsYearPickerOpen(!isYearPickerOpen);
              setIsMonthPickerOpen(false);
            }}
            className={`text-muted-foreground font-medium hover:bg-muted rounded-md transition-colors flex items-center gap-1 ${
              isCompact ? 'px-1.5 py-1 text-[13px]' : 'px-2 py-1 text-sm'
            }`}
          >
            {year}
            <ChevronDown
              aria-hidden="true"
              className={`size-2.5 text-muted-foreground transition-transform ${isYearPickerOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Month Picker Overlay */}
          {isMonthPickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover text-popover-foreground border border-border shadow-xl rounded-lg p-2 grid grid-cols-3 gap-1 min-w-[200px] animate-in fade-in zoom-in-95 duration-150 origin-top-left">
              {monthNames.map((mName, idx) => (
                <button
                  key={MONTH_KEYS[idx]}
                  type="button"
                  onClick={() => {
                    setViewDate(new Date(year, idx, 1));
                    setIsMonthPickerOpen(false);
                  }}
                  className={`text-[11px] font-bold py-2 rounded-lg transition-colors ${
                    idx === month
                      ? 'bg-secondary text-secondary-foreground'
                      : idx === currentMonth
                        ? 'bg-muted text-secondary-foreground ring-1 ring-inset ring-border'
                        : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {mName.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {/* Year Picker Overlay */}
          {isYearPickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover text-popover-foreground border border-border shadow-xl rounded-lg p-2 grid grid-cols-3 gap-1 min-w-[180px] max-h-[200px] overflow-y-auto animate-in fade-in zoom-in-95 duration-150 origin-top-left">
              {Array.from({ length: 9 }, (_, i) => currentYear - 4 + i).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setViewDate(new Date(y, month, 1));
                    setIsYearPickerOpen(false);
                  }}
                  className={`text-[11px] font-bold py-2 rounded-lg transition-colors ${
                    y === year
                      ? 'bg-secondary text-secondary-foreground'
                      : y === currentYear
                        ? 'bg-muted text-secondary-foreground ring-1 ring-inset ring-border'
                        : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={prevMonth}
            className={`hover:bg-muted rounded-lg text-muted-foreground transition-colors ${
              isCompact ? 'p-1' : 'p-1.5'
            }`}
          >
            <ChevronLeft aria-hidden="true" className="size-3" />
          </button>
          <button
            type="button"
            onClick={handleTodayClick}
            className={`font-bold uppercase tracking-wider text-secondary hover:bg-muted rounded-lg transition-colors ${
              isCompact ? 'px-1.5 text-[9px]' : 'px-2 text-[10px]'
            }`}
          >
            {t('calendar.today')}
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className={`hover:bg-muted rounded-lg text-muted-foreground transition-colors ${
              isCompact ? 'p-1' : 'p-1.5'
            }`}
          >
            <ChevronRight aria-hidden="true" className="size-3" />
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-7 gap-0.5 ${isCompact ? 'mb-0.5' : 'mb-1'}`}>
        {dayHeaders.map((day, idx) => {
          const isSundayHeader =
            (startOfWeek === 'Monday' && idx === 6) || (startOfWeek === 'Sunday' && idx === 0);
          const isSaturdayHeader =
            (startOfWeek === 'Monday' && idx === 5) || (startOfWeek === 'Sunday' && idx === 6);
          const isHolidayHeader = isSundayHeader || (treatSaturdayAsHoliday && isSaturdayHeader);
          return (
            <div
              key={dayHeaderKeys[idx]}
              className={`text-center font-bold uppercase tracking-widest ${
                isCompact ? 'py-0.5 text-[9px]' : 'py-1 text-[10px]'
              } ${isHolidayHeader ? 'text-red-400' : 'text-muted-foreground'}`}
            >
              {day}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-7 gap-0.5">{days}</div>

      {selectionMode === 'single' && (
        <div
          className={`border-t border-border flex items-center gap-2 ${
            isCompact ? 'mt-auto pt-2' : 'mt-4 pt-3'
          }`}
        >
          <div className="size-2 rounded-full bg-red-500"></div>
          <span
            className={`${isCompact ? 'text-[9px]' : 'text-[10px]'} font-bold text-muted-foreground uppercase`}
          >
            {t('calendar.holidayWeekend')}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <div className="size-2 rounded-full bg-emerald-400"></div>
            <span
              className={`${isCompact ? 'text-[9px]' : 'text-[10px]'} font-bold text-muted-foreground uppercase`}
            >
              {t('calendar.goalReached')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
