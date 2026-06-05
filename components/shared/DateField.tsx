import { CalendarDays } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDateOnlyForLocale, normalizeDateOnlyString } from '../../utils/date';
import Calendar from './Calendar';

export interface DateFieldProps {
  /** Selected date as a `YYYY-MM-DD` string (empty/undefined/null when unset). */
  value: string | null | undefined;
  /** Called with the newly selected date as a `YYYY-MM-DD` string ('' when cleared). */
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  /** When true, the clear affordance is hidden (the field must always hold a date). */
  required?: boolean;
  placeholder?: string;
  /** Extra classes for the trigger control. */
  className?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  startOfWeek?: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday?: boolean;
}

/**
 * Date-only picker built on the shared {@link Calendar} (the same calendar used by the
 * audit-log time filters), minus the time input and apply row. Drop-in replacement for a
 * native `<input type="date">`: it speaks `YYYY-MM-DD` strings in and out. Selecting a day
 * commits immediately and closes the popover.
 */
const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  id,
  name,
  disabled = false,
  required = false,
  placeholder,
  className = '',
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  startOfWeek = 'Monday',
  treatSaturdayAsHoliday = false,
}) => {
  const { t, i18n } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);

  const normalized = value ? normalizeDateOnlyString(value) : '';
  const displayValue = normalized
    ? formatDateOnlyForLocale(normalized, i18n.language, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '';

  const handleDateSelect = (dateStr: string) => {
    onChange(dateStr);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const canClear = !required && !disabled && Boolean(normalized);

  return (
    <Popover open={isOpen} onOpenChange={disabled ? undefined : setIsOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          name={name}
          type="button"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          className={cn(
            'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-left text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className={cn(
              'flex-1 truncate',
              displayValue ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {displayValue || placeholder || t('labels.selectDate', { defaultValue: 'Select date' })}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2.5 p-3">
        <Calendar
          selectedDate={normalized || undefined}
          onDateSelect={handleDateSelect}
          allowWeekendSelection
          startOfWeek={startOfWeek}
          treatSaturdayAsHoliday={treatSaturdayAsHoliday}
          size="compact"
          bare
        />
        {canClear && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="w-full rounded-lg bg-transparent text-foreground dark:bg-transparent"
          >
            {t('buttons.clear')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default DateField;
