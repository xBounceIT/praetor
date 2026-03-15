import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { getLocalDateString } from '../../utils/date';
import Calendar from './Calendar';

export interface DatePickerButtonProps {
  value: Date | null;
  onChange: (date: Date) => void;
  onClear?: () => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const DatePickerButton: React.FC<DatePickerButtonProps> = ({
  value,
  onChange,
  onClear,
  label,
  placeholder,
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    value ? getLocalDateString(value) : null,
  );
  const [hours, setHours] = useState(() => (value ? value.getHours() : 0));
  const [minutes, setMinutes] = useState(() => (value ? value.getMinutes() : 0));

  useEffect(() => {
    if (value) {
      setSelectedDate(getLocalDateString(value));
      setHours(value.getHours());
      setMinutes(value.getMinutes());
    } else {
      setSelectedDate(null);
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const calculatePosition = useCallback(() => {
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    if (!buttonRect) return null;

    const dropdownHeight = 400;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const shouldOpenUp = spaceBelow < dropdownHeight && buttonRect.top > dropdownHeight;

    return {
      position: 'fixed' as const,
      top: shouldOpenUp ? Math.max(8, buttonRect.top - dropdownHeight - 4) : buttonRect.bottom + 4,
      left: Math.max(8, Math.min(buttonRect.left, window.innerWidth - 320)),
      zIndex: 1000,
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const newStyles = calculatePosition();
      if (newStyles) {
        setDropdownStyles(newStyles);
      }
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, calculatePosition]);

  const formatDisplayValue = () => {
    if (!value) return placeholder || label;
    const dateStr = value.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    return `${dateStr} ${timeStr}`;
  };

  const handleDateSelect = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const handleApply = () => {
    if (selectedDate) {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const newDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      onChange(newDate);
    }
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDate(null);
    setHours(0);
    setMinutes(0);
    onClear?.();
  };

  const handleOpen = () => {
    if (disabled) return;
    const initialPosition = calculatePosition();
    if (initialPosition) {
      setDropdownStyles(initialPosition);
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={`h-10 px-4 inline-flex items-center gap-2 rounded-xl border text-sm font-semibold transition-colors
  ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}
  ${isOpen ? 'border-praetor ring-1 ring-praetor bg-white' : 'border-slate-200 bg-white text-slate-600'}`}
      >
        {value ? (
          <>
            <i className="fa-solid fa-calendar-days text-slate-400" />
            <span className="text-slate-800">{formatDisplayValue()}</span>
          </>
        ) : (
          <>
            <i className="fa-solid fa-calendar-days text-slate-400" />
            <span className="text-slate-500">{label}</span>
          </>
        )}
      </button>

      {isOpen &&
        !disabled &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyles}
            className="bg-white border border-slate-200 rounded-2xl shadow-xl animate-in fade-in zoom-in-95 duration-100 origin-top-left w-80"
          >
            <div className="p-3">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>{label}</span>
                {value && onClear && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <i className="fa-solid fa-circle-xmark" />
                  </button>
                )}
              </div>

              <Calendar
                selectedDate={selectedDate ?? undefined}
                onDateSelect={handleDateSelect}
                allowWeekendSelection
                startOfWeek="Monday"
              />

              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Time
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={String(hours).padStart(2, '0')}
                      onChange={(e) =>
                        setHours(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))
                      }
                      className="w-12 px-2 py-1.5 text-sm text-center bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-praetor"
                    />
                    <span className="text-slate-400 font-bold">:</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={String(minutes).padStart(2, '0')}
                      onChange={(e) =>
                        setMinutes(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))
                      }
                      className="w-12 px-2 py-1.5 text-sm text-center bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-praetor"
                    />
                  </div>
                  <div className="ml-auto">
                    <button
                      type="button"
                      onClick={handleApply}
                      className="px-4 py-1.5 text-sm font-bold bg-praetor text-white rounded-lg hover:opacity-90 transition-opacity"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default DatePickerButton;
