
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { TimeEntry } from '../types';
import { isItalianHoliday } from '../utils/holidays';

interface CalendarProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  entries: TimeEntry[];
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  dailyGoal: number;
}

const Calendar: React.FC<CalendarProps> = ({ selectedDate, onDateSelect, entries, startOfWeek, treatSaturdayAsHoliday, dailyGoal }) => {
  const [viewDate, setViewDate] = useState(new Date(selectedDate || new Date()));
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
  const today = currentDate.toISOString().split('T')[0];


  const days = [];
  const totalDays = daysInMonth(year, month);
  let offset = firstDayOfMonth(year, month);

  // Adjust offset based on start of week
  if (startOfWeek === 'Monday') {
    offset = (offset + 6) % 7;
  }

  const entryDates = new Set(entries.map(e => e.date));
  const dailyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    entries.forEach(e => {
      totals[e.date] = (totals[e.date] || 0) + e.duration;
    });
    return totals;
  }, [entries]);

  const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

  const dayHeaders = startOfWeek === 'Monday'
    ? ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
    : ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  for (let i = 0; i < offset; i++) {
    days.push(<div key={`empty-${i}`} className="h-9 w-full"></div>);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = dateStr === selectedDate;
    const isToday = dateStr === today;
    const hasActivity = entryDates.has(dateStr);

    const dayOfWeek = dateObj.getDay();
    const holidayName = isItalianHoliday(dateObj);
    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;
    const isForbidden = isSunday || (treatSaturdayAsHoliday && isSaturday) || !!holidayName;

    days.push(
      <button
        key={d}
        disabled={isForbidden}
        title={holidayName || (isSunday ? "Domenica" : (isSaturday && treatSaturdayAsHoliday ? "Sabato" : ""))}
        onClick={() => {
          if (!isForbidden) onDateSelect(dateStr);
        }}
        className={`relative h-9 w-full flex flex-col items-center justify-center rounded-lg transition-all border ${isSelected
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105 z-10'
          : isForbidden
            ? 'bg-red-50 text-red-500 border-red-100 cursor-not-allowed'
            : (dailyTotals[dateStr] >= dailyGoal - 0.01 && dailyGoal > 0)
              ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
              : isToday
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : 'hover:bg-slate-50 border-transparent text-slate-700'
          }`}
      >
        <span className={`text-sm font-bold ${isForbidden && !isSelected ? 'text-red-600' : (dailyTotals[dateStr] >= dailyGoal - 0.01 && dailyGoal > 0) && !isSelected ? 'text-emerald-700' : ''}`}>{d}</span>
        {hasActivity && (
          <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : isForbidden ? 'bg-red-300' : (dailyTotals[dateStr] >= dailyGoal - 0.01 && dailyGoal > 0) ? 'bg-emerald-400' : 'bg-indigo-400'}`}></span>
        )}
        {holidayName && (
          <span className="absolute top-0.5 right-0.5 w-1 h-1 bg-red-400 rounded-full animate-pulse"></span>
        )}
      </button>
    );
  }

  const handleTodayClick = () => {
    const now = new Date();
    setViewDate(now);
    onDateSelect(now.toISOString().split('T')[0]);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 w-full relative" ref={containerRef}>
      <div className="flex items-center justify-between mb-4">
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => {
              setIsMonthPickerOpen(!isMonthPickerOpen);
              setIsYearPickerOpen(false);
            }}
            className="font-bold text-slate-800 text-sm hover:bg-slate-50 px-2 py-1 rounded-md transition-colors flex items-center gap-1"
          >
            {monthNames[month]}
            <i className={`fa-solid fa-chevron-down text-[8px] text-slate-400 transition-transform ${isMonthPickerOpen ? 'rotate-180' : ''}`}></i>
          </button>

          <button
            onClick={() => {
              setIsYearPickerOpen(!isYearPickerOpen);
              setIsMonthPickerOpen(false);
            }}
            className="text-slate-400 font-medium text-sm hover:bg-slate-50 px-2 py-1 rounded-md transition-colors flex items-center gap-1"
          >
            {year}
            <i className={`fa-solid fa-chevron-down text-[8px] text-slate-300 transition-transform ${isYearPickerOpen ? 'rotate-180' : ''}`}></i>
          </button>

          {/* Month Picker Overlay */}
          {isMonthPickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 shadow-xl rounded-xl p-2 grid grid-cols-3 gap-1 min-w-[200px] animate-in fade-in zoom-in-95 duration-150 origin-top-left">
              {monthNames.map((mName, idx) => (
                <button
                  key={mName}
                  onClick={() => {
                    setViewDate(new Date(year, idx, 1));
                    setIsMonthPickerOpen(false);
                  }}
                  className={`text-[11px] font-bold py-2 rounded-lg transition-colors ${idx === month
                    ? 'bg-indigo-600 text-white'
                    : idx === currentMonth
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200'
                      : 'text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  {mName.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {/* Year Picker Overlay */}
          {isYearPickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 shadow-xl rounded-xl p-2 grid grid-cols-3 gap-1 min-w-[180px] max-h-[200px] overflow-y-auto animate-in fade-in zoom-in-95 duration-150 origin-top-left">
              {Array.from({ length: 7 }, (_, i) => currentYear - 3 + i).map((y) => (
                <button
                  key={y}
                  onClick={() => {
                    setViewDate(new Date(y, month, 1));
                    setIsYearPickerOpen(false);
                  }}
                  className={`text-[11px] font-bold py-2 rounded-lg transition-colors ${y === year
                    ? 'bg-indigo-600 text-white'
                    : y === currentYear
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200'
                      : 'text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={prevMonth} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
            <i className="fa-solid fa-chevron-left text-xs"></i>
          </button>
          <button onClick={handleTodayClick} className="px-2 text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            Oggi
          </button>
          <button onClick={nextMonth} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
            <i className="fa-solid fa-chevron-right text-xs"></i>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {dayHeaders.map((day, idx) => {
          const isSundayHeader = (startOfWeek === 'Monday' && idx === 6) || (startOfWeek === 'Sunday' && idx === 0);
          const isSaturdayHeader = (startOfWeek === 'Monday' && idx === 5) || (startOfWeek === 'Sunday' && idx === 6);
          const isHolidayHeader = isSundayHeader || (treatSaturdayAsHoliday && isSaturdayHeader);
          return (
            <div key={day} className={`text-center text-[10px] font-bold uppercase tracking-widest py-1 ${isHolidayHeader ? 'text-red-400' : 'text-slate-400'}`}>
              {day}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-red-500"></div>
        <span className="text-[10px] font-bold text-slate-400 uppercase">
          Festivo / {treatSaturdayAsHoliday ? 'Weekend' : 'Domenica'}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
          <span className="text-[10px] font-bold text-slate-400 uppercase">Obiettivo Raggiunto</span>
        </div>
      </div>
    </div>
  );
};

export default Calendar;
