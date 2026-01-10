
import React, { useState } from 'react';
import { TimeEntry } from '../types';

interface CalendarProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  entries: TimeEntry[];
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
}

const Calendar: React.FC<CalendarProps> = ({ selectedDate, onDateSelect, entries, startOfWeek, treatSaturdayAsHoliday }) => {
  const [viewDate, setViewDate] = useState(new Date(selectedDate || new Date()));

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date().toISOString().split('T')[0];

  // Italian Holiday Logic (Anonymous Algorithm for Easter)
  const getEaster = (y: number) => {
    const f = Math.floor;
    const G = y % 19;
    const C = f(y / 100);
    const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
    const J = (y + f(y / 4) + I + 2 - C + f(C / 4)) % 7;
    const L = I - J;
    const m = 3 + f((L + 40) / 44);
    const d = L + 28 - 31 * f(m / 4);
    return new Date(y, m - 1, d);
  };

  const isItalianHoliday = (date: Date) => {
    const d = date.getDate();
    const m = date.getMonth() + 1; // 1-based
    const y = date.getFullYear();

    // Fixed holidays (Month-Day)
    const fixedHolidays: Record<string, string> = {
      "1-1": "Capodanno",
      "1-6": "Epifania",
      "4-25": "Liberazione",
      "5-1": "Lavoro",
      "6-2": "Repubblica",
      "8-15": "Ferragosto",
      "11-1": "Ognissanti",
      "12-8": "Immacolata",
      "12-25": "Natale",
      "12-26": "S. Stefano",
    };

    const key = `${m}-${d}`;
    if (fixedHolidays[key]) return fixedHolidays[key];

    // Dynamic holidays
    const easter = getEaster(y);
    const isSameDay = (d1: Date, d2: Date) => 
      d1.getFullYear() === d2.getFullYear() && 
      d1.getMonth() === d2.getMonth() && 
      d1.getDate() === d2.getDate();

    if (isSameDay(date, easter)) return "Pasqua";
    
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    if (isSameDay(date, easterMonday)) return "Lunedì dell'Angelo";

    return null;
  };

  const days = [];
  const totalDays = daysInMonth(year, month);
  let offset = firstDayOfMonth(year, month);
  
  // Adjust offset based on start of week
  if (startOfWeek === 'Monday') {
    offset = (offset + 6) % 7;
  }

  const entryDates = new Set(entries.map(e => e.date));

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
        className={`relative h-9 w-full flex flex-col items-center justify-center rounded-lg transition-all border ${
          isSelected 
            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105 z-10' 
            : isForbidden
              ? 'bg-red-50 text-red-500 border-red-100 cursor-not-allowed'
              : isToday 
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                : 'hover:bg-slate-50 border-transparent text-slate-700'
        }`}
      >
        <span className={`text-sm font-bold ${isForbidden && !isSelected ? 'text-red-600' : ''}`}>{d}</span>
        {hasActivity && (
          <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : isForbidden ? 'bg-red-300' : 'bg-indigo-400'}`}></span>
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 text-sm">
          {monthNames[month]} <span className="text-slate-400 font-medium">{year}</span>
        </h3>
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
      </div>
    </div>
  );
};

export default Calendar;
