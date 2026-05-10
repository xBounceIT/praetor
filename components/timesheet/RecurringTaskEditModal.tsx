import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ProjectTask } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { formatRecurrencePattern } from '../../utils/recurrence';
import CustomRepeatModal from '../shared/CustomRepeatModal';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface RecurringTaskEditModalProps {
  isOpen: boolean;
  task: ProjectTask | null;
  onClose: () => void;
  onSave: (
    pattern: string,
    startDate: string,
    endDate: string | undefined,
    duration: number | undefined,
  ) => void;
}

// Caller is expected to pass `key={task?.id}` so this component remounts
// (and re-initializes form state) whenever a different task is opened.
const RecurringTaskEditModal: React.FC<RecurringTaskEditModalProps> = ({
  isOpen,
  task,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation('timesheets');

  const [pattern, setPattern] = useState<string>(task?.recurrencePattern || 'weekly');
  const [startDate, setStartDate] = useState<string>(task?.recurrenceStart || getLocalDateString());
  const [endDate, setEndDate] = useState<string>(task?.recurrenceEnd || '');
  const [duration, setDuration] = useState<string>(
    task?.recurrenceDuration != null ? String(task.recurrenceDuration) : '0',
  );
  const [isCustomRepeatOpen, setIsCustomRepeatOpen] = useState(false);

  const isCustomPattern = pattern.startsWith('monthly:');
  const customLabel = isCustomPattern ? formatRecurrencePattern(pattern, t) : null;

  const dateError =
    endDate && startDate && endDate < startDate ? t('recurring.endDateBeforeStart') : '';
  const canSave = pattern.length > 0 && !!startDate && !dateError;

  const handlePatternChange = (val: string) => {
    if (val === 'custom') {
      setIsCustomRepeatOpen(true);
    } else {
      setPattern(val);
    }
  };

  const handleSubmit = () => {
    if (!canSave) return;
    const parsedDuration = duration === '' ? undefined : Number(duration);
    onSave(
      pattern,
      startDate,
      endDate || undefined,
      Number.isFinite(parsedDuration) ? parsedDuration : undefined,
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle className="gap-3">
            <div className="size-10 bg-muted rounded-md flex items-center justify-center text-praetor">
              <i className="fa-solid fa-pen-to-square"></i>
            </div>
            <div>
              <div>{t('recurring.editRecurring')}</div>
              {task && (
                <div className="text-xs font-semibold text-muted-foreground mt-0.5 truncate max-w-[18rem]">
                  {task.name}
                </div>
              )}
            </div>
          </ModalTitle>
          <ModalCloseButton onClick={onClose} />
        </ModalHeader>

        <ModalBody className="space-y-5">
          <ModalDescription>{t('recurring.editSubtitle')}</ModalDescription>

          <Field>
            <SelectControl
              id="recurring-pattern"
              label={t('recurring.pattern')}
              options={[
                { id: 'daily', name: t('entry.recurrencePatterns.daily') },
                { id: 'weekly', name: t('entry.recurrencePatterns.weekly') },
                { id: 'monthly', name: t('entry.recurrencePatterns.monthly') },
                {
                  id: 'custom',
                  name: customLabel ?? t('entry.recurrencePatterns.custom'),
                },
              ]}
              value={isCustomPattern ? 'custom' : pattern}
              onChange={(val) => handlePatternChange(val as string)}
              searchable={false}
            />
          </Field>

          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="recurring-start-date">{t('recurring.startDate')}</FieldLabel>
              <Input
                id="recurring-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field data-invalid={Boolean(dateError)}>
              <FieldLabel htmlFor="recurring-end-date">{t('recurring.endDate')}</FieldLabel>
              <Input
                id="recurring-end-date"
                type="date"
                value={endDate}
                aria-invalid={Boolean(dateError)}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          </FieldGroup>
          {dateError && <FieldError>{dateError}</FieldError>}

          <Field>
            <FieldLabel htmlFor="recurring-duration">{t('recurring.duration')}</FieldLabel>
            <ValidatedNumberInput
              id="recurring-duration"
              value={duration}
              onValueChange={setDuration}
              placeholder="0.0"
            />
          </Field>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSave}>
            {t('common:buttons.update')}
          </Button>
        </ModalFooter>
      </ModalContent>

      <CustomRepeatModal
        isOpen={isCustomRepeatOpen}
        onClose={() => setIsCustomRepeatOpen(false)}
        onSave={(p) => {
          setPattern(p);
          setIsCustomRepeatOpen(false);
        }}
      />
    </Modal>
  );
};

export default RecurringTaskEditModal;
