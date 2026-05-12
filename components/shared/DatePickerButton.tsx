import { ArrowUp, CalendarDays } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getShadcnThemeClassName, useResolvedShadcnTheme } from '@/components/ui/use-shadcn-theme';
import { cn } from '@/lib/utils';
import { getLocalDateString } from '../../utils/date';
import Calendar from './Calendar';

const formatTimeValue = (hours: number, minutes: number) =>
  `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

export interface DatePickerButtonProps {
  value: Date | null;
  onChange: (date: Date) => void;
  onClear?: () => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  startOfWeek?: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday?: boolean;
}

const DatePickerButton: React.FC<DatePickerButtonProps> = ({
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
  className = '',
  buttonClassName = '',
  startOfWeek = 'Monday',
  treatSaturdayAsHoliday = false,
}) => {
  const { t } = useTranslation('common');
  const resolvedTheme = useResolvedShadcnTheme();
  const themeClassName = getShadcnThemeClassName(resolvedTheme);
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
        !dropdownRef.current?.contains(target)
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

    const dropdownHeight = 360;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const shouldOpenUp = spaceBelow < dropdownHeight && buttonRect.top > dropdownHeight;

    return {
      position: 'fixed' as const,
      top: shouldOpenUp ? Math.max(8, buttonRect.top - dropdownHeight - 4) : buttonRect.bottom + 4,
      left: Math.max(8, Math.min(buttonRect.left, window.innerWidth - 288)),
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
    return `${dateStr} ${formatTimeValue(value.getHours(), value.getMinutes())}`;
  };

  const handleDateSelect = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const [nextHours, nextMinutes] = event.target.value.split(':').map(Number);
    if (Number.isFinite(nextHours)) {
      setHours(Math.min(23, Math.max(0, nextHours)));
    }
    if (Number.isFinite(nextMinutes)) {
      setMinutes(Math.min(59, Math.max(0, nextMinutes)));
    }
  };

  const handleApply = () => {
    if (selectedDate) {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const newDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      const hasChanged =
        !value ||
        value.getFullYear() !== newDate.getFullYear() ||
        value.getMonth() !== newDate.getMonth() ||
        value.getDate() !== newDate.getDate() ||
        value.getHours() !== newDate.getHours() ||
        value.getMinutes() !== newDate.getMinutes();
      if (hasChanged) {
        onChange(newDate);
      }
    }
    setIsOpen(false);
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
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={handleOpen}
        className={cn(
          'h-10 gap-2 rounded-xl px-4 text-sm font-semibold',
          isOpen && 'border-praetor ring-1 ring-praetor',
          buttonClassName,
        )}
      >
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value ? formatDisplayValue() : label}
        </span>
      </Button>

      {isOpen &&
        !disabled &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            data-shadcn-theme-scope
            data-shadcn-theme={resolvedTheme}
            style={dropdownStyles}
            className={cn(
              'w-72 origin-top-left animate-in fade-in zoom-in-95 duration-100 space-y-4 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md',
              themeClassName,
            )}
          >
            <div>
              <Calendar
                selectedDate={selectedDate ?? undefined}
                onDateSelect={handleDateSelect}
                allowWeekendSelection
                startOfWeek={startOfWeek}
                treatSaturdayAsHoliday={treatSaturdayAsHoliday}
                size="compact"
                bare
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label={t('labels.time')}
                  value={formatTimeValue(hours, minutes)}
                  onChange={handleTimeChange}
                  className="h-9 flex-1 rounded-full bg-transparent px-4 text-sm font-semibold tabular-nums text-foreground dark:bg-transparent dark:[color-scheme:dark]"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleApply}
                  aria-label={t('buttons.apply')}
                  title={t('buttons.apply')}
                  className="rounded-full bg-transparent text-foreground dark:bg-transparent"
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default DatePickerButton;
