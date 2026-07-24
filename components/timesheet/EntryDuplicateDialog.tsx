import { Copy, X } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TimeEntry } from '../../types';
import { formatDateOnlyForLocale } from '../../utils/date';
import { formatDecimal } from '../../utils/numbers';
import { filterDuplicateTargetDates } from '../../utils/timeEntryDuplicate';
import Calendar from '../shared/Calendar';

export interface EntryDuplicateDialogProps {
  entry: TimeEntry | null;
  onClose: () => void;
  onDuplicate: (dates: string[]) => Promise<void>;
  /** Dates that already have the same project+task (plus source day). */
  existingConflictDates?: string[];
  startOfWeek?: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday?: boolean;
}

const EntryDuplicateDialog: React.FC<EntryDuplicateDialogProps> = ({
  entry,
  onClose,
  onDuplicate,
  existingConflictDates = [],
  startOfWeek = 'Monday',
  treatSaturdayAsHoliday = false,
}) =>
  entry ? (
    <EntryDuplicateDialogContent
      key={entry.id}
      entry={entry}
      onClose={onClose}
      onDuplicate={onDuplicate}
      existingConflictDates={existingConflictDates}
      startOfWeek={startOfWeek}
      treatSaturdayAsHoliday={treatSaturdayAsHoliday}
    />
  ) : null;

type ContentProps = {
  entry: TimeEntry;
  onClose: () => void;
  onDuplicate: (dates: string[]) => Promise<void>;
  existingConflictDates: string[];
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
};

const EntryDuplicateDialogContent: React.FC<ContentProps> = ({
  entry,
  onClose,
  onDuplicate,
  existingConflictDates,
  startOfWeek,
  treatSaturdayAsHoliday,
}) => {
  const { t, i18n } = useTranslation('timesheets');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const targetDates = useMemo(
    () => filterDuplicateTargetDates(selectedDates, existingConflictDates),
    [selectedDates, existingConflictDates],
  );

  const summary = `${entry.clientName} · ${entry.projectName} · ${entry.task} · ${formatDecimal(entry.duration)} h`;

  const handleRemoveDate = (date: string) => {
    setSelectedDates((prev) => prev.filter((d) => d !== date));
  };

  const handleSubmit = async () => {
    if (targetDates.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onDuplicate(targetDates);
      onClose();
    } catch {
      // Caller handles toasts; keep dialog open for retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  const ctaLabel =
    targetDates.length > 0
      ? t('entry.duplicateToDays', { count: targetDates.length })
      : t('entry.duplicate');

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md gap-5" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-4 text-praetor" aria-hidden="true" />
            {t('entry.duplicateEntry')}
          </DialogTitle>
          <DialogDescription>{t('entry.selectTargetDates')}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground truncate" title={summary}>
          {summary}
        </p>

        <div className="rounded-lg border border-border bg-muted/30 p-2">
          <Calendar
            selectionMode="multiple"
            selectedDates={selectedDates}
            onDatesChange={setSelectedDates}
            disabledDates={existingConflictDates}
            selectedDate={entry.date}
            startOfWeek={startOfWeek}
            treatSaturdayAsHoliday={treatSaturdayAsHoliday}
            allowWeekendSelection
            size="compact"
            bare
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('entry.selectedDays')}
          </p>
          {targetDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('entry.selectTargetDates')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {targetDates.map((date) => (
                <Badge
                  key={date}
                  variant="secondary"
                  className="gap-1 pr-1 animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
                >
                  <span>
                    {formatDateOnlyForLocale(date, i18n.language, {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('entry.removeSelectedDay', { date })}
                    disabled={isSubmitting}
                    onClick={() => handleRemoveDate(date)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('entry.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={targetDates.length === 0 || isSubmitting}
          >
            {ctaLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EntryDuplicateDialog;
