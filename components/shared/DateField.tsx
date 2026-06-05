import { CalendarDays } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { inputBaseClassName } from '@/components/ui/inputStyles';
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
  disabled?: boolean;
  /** When true, the clear affordance is hidden so the field can't be emptied once set. */
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
          type="button"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          className={cn(inputBaseClassName, 'flex items-center gap-2 text-left', className)}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className={cn(
              'flex-1 truncate',
              displayValue ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {displayValue || placeholder || t('labels.selectDate')}
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
