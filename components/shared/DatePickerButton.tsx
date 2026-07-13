import { ArrowUp, CalendarDays } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [loadedValueKey, setLoadedValueKey] = useState<string | null>(null);
  const valueKey = value
    ? `${getLocalDateString(value)}T${value.getHours()}:${value.getMinutes()}`
    : '';

  if (loadedValueKey !== valueKey) {
    setLoadedValueKey(valueKey);
    if (value) {
      setSelectedDate(getLocalDateString(value));
      setHours(value.getHours());
      setMinutes(value.getMinutes());
    } else {
      setSelectedDate(null);
    }
  }

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
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is a selection event handler, not a functional state updater.
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

  return (
    <div className={`relative ${className}`}>
      <Popover open={isOpen} onOpenChange={disabled ? undefined : setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn('h-10 gap-2 rounded-xl px-4 text-sm font-semibold', buttonClassName)}
          >
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
              {value ? formatDisplayValue() : label}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-2.5 p-3">
          <Calendar
            selectedDate={selectedDate ?? undefined}
            onDateSelect={handleDateSelect}
            allowWeekendSelection
            startOfWeek={startOfWeek}
            treatSaturdayAsHoliday={treatSaturdayAsHoliday}
            size="compact"
            bare
          />
          <div className="flex items-center gap-2">
            <Input
              type="time"
              aria-label={t('labels.time')}
              value={formatTimeValue(hours, minutes)}
              onChange={handleTimeChange}
              className="h-9 flex-1 rounded-full bg-transparent px-4 text-sm font-semibold tabular-nums text-foreground dark:bg-transparent"
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
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DatePickerButton;
