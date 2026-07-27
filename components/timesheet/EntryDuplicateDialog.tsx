import { AlertTriangle, Copy, X } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Field, FieldLabel } from '@/components/ui/field';
import type { TimeEntry } from '../../types';
import { formatDateOnlyForLocale } from '../../utils/date';
import { formatDecimal } from '../../utils/numbers';
import Calendar from '../shared/Calendar';

export interface EntryDuplicateDialogProps {
  entry: TimeEntry | null;
  onClose: () => void;
  onDuplicate: (dates: string[]) => Promise<void>;
  /** Dates that already have the same project+task (warning only; still selectable). */
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
}) => (
  <Dialog
    open={entry !== null}
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    {entry ? (
      <EntryDuplicateDialogContent
        key={entry.id}
        entry={entry}
        onClose={onClose}
        onDuplicate={onDuplicate}
        existingConflictDates={existingConflictDates}
        startOfWeek={startOfWeek}
        treatSaturdayAsHoliday={treatSaturdayAsHoliday}
      />
    ) : null}
  </Dialog>
);

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

  const summary = useMemo(
    () =>
      `${entry.clientName} · ${entry.projectName} · ${entry.task} · ${formatDecimal(entry.duration)} h`,
    [entry.clientName, entry.projectName, entry.task, entry.duration],
  );

  const conflictDateSet = useMemo(() => new Set(existingConflictDates), [existingConflictDates]);

  const overwriteCount = useMemo(
    () => selectedDates.filter((date) => conflictDateSet.has(date)).length,
    [selectedDates, conflictDateSet],
  );

  const handleRemoveDate = (date: string) => {
    setSelectedDates((prev) => prev.filter((d) => d !== date));
  };

  const handleSubmit = async () => {
    if (selectedDates.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onDuplicate(selectedDates);
      onClose();
    } catch {
      // Caller handles toasts; keep dialog open for retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  const ctaLabel =
    selectedDates.length > 0
      ? t('entry.duplicateToDays', { count: selectedDates.length })
      : t('entry.duplicate');

  return (
    <DialogContent
      className="sm:max-w-md"
      showCloseButton={!isSubmitting}
      onEscapeKeyDown={(event) => {
        if (isSubmitting) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (isSubmitting) event.preventDefault();
      }}
    >
      <DialogHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Copy className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle>{t('entry.duplicateEntry')}</DialogTitle>
            <DialogDescription>{t('entry.selectTargetDates')}</DialogDescription>
            <p className="text-sm text-muted-foreground truncate" title={summary}>
              {summary}
            </p>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-md border border-border p-2">
          <Calendar
            selectionMode="multiple"
            selectedDates={selectedDates}
            onDatesChange={setSelectedDates}
            disabledDates={[entry.date]}
            selectedDate={entry.date}
            startOfWeek={startOfWeek}
            treatSaturdayAsHoliday={treatSaturdayAsHoliday}
            allowWeekendSelection
            size="compact"
            bare
          />
        </div>

        {overwriteCount > 0 ? (
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              {t('entry.duplicateOverwriteWarning', { count: overwriteCount })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel>{t('entry.selectedDays')}</FieldLabel>
          {selectedDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('entry.selectTargetDates')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedDates.map((date) => (
                <Badge key={date} variant="secondary" className="gap-1 pr-1">
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
        </Field>
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
          disabled={selectedDates.length === 0 || isSubmitting}
        >
          {ctaLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

export default EntryDuplicateDialog;
