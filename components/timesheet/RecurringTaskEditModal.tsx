import type React from 'react';
import { useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import type { ProjectTask } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { formatRecurrencePattern } from '../../utils/recurrence';
import CustomRepeatModal from '../shared/CustomRepeatModal';
import DateField from '../shared/DateField';
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

type RecurringTaskEditState = {
  pattern: string;
  startDate: string;
  endDate: string;
  duration: string;
  isCustomRepeatOpen: boolean;
};

type RecurringTaskEditAction =
  | { type: 'setPattern'; pattern: string }
  | { type: 'setStartDate'; startDate: string }
  | { type: 'setEndDate'; endDate: string }
  | { type: 'setDuration'; duration: string }
  | { type: 'setCustomRepeatOpen'; isOpen: boolean }
  | { type: 'saveCustomPattern'; pattern: string };

const recurringTaskEditReducer = (
  state: RecurringTaskEditState,
  action: RecurringTaskEditAction,
): RecurringTaskEditState => {
  switch (action.type) {
    case 'setPattern':
      return { ...state, pattern: action.pattern };
    case 'setStartDate':
      return { ...state, startDate: action.startDate };
    case 'setEndDate':
      return { ...state, endDate: action.endDate };
    case 'setDuration':
      return { ...state, duration: action.duration };
    case 'setCustomRepeatOpen':
      return { ...state, isCustomRepeatOpen: action.isOpen };
    case 'saveCustomPattern':
      return { ...state, pattern: action.pattern, isCustomRepeatOpen: false };
  }
};

const getInitialRecurringTaskEditState = (task: ProjectTask | null): RecurringTaskEditState => ({
  pattern: task?.recurrencePattern || 'weekly',
  startDate: task?.recurrenceStart || getLocalDateString(),
  endDate: task?.recurrenceEnd || '',
  duration: task?.recurrenceDuration != null ? String(task.recurrenceDuration) : '0',
  isCustomRepeatOpen: false,
});

// Caller is expected to pass `key={task?.id}` so this component remounts
// (and re-initializes form state) whenever a different task is opened.
const RecurringTaskEditModal: React.FC<RecurringTaskEditModalProps> = ({
  isOpen,
  task,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation('timesheets');

  const [state, dispatch] = useReducer(
    recurringTaskEditReducer,
    task,
    getInitialRecurringTaskEditState,
  );
  const { pattern, startDate, endDate, duration, isCustomRepeatOpen } = state;

  const isCustomPattern = pattern.startsWith('monthly:');
  const customLabel = isCustomPattern ? formatRecurrencePattern(pattern, t) : null;

  const dateError =
    endDate && startDate && endDate < startDate ? t('recurring.endDateBeforeStart') : '';
  const canSave = pattern.length > 0 && !!startDate && !dateError;

  const handlePatternChange = (val: string) => {
    if (val === 'custom') {
      dispatch({ type: 'setCustomRepeatOpen', isOpen: true });
    } else {
      dispatch({ type: 'setPattern', pattern: val });
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
      {() => (
        <>
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
                  required
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
                  <FieldLabel htmlFor="recurring-start-date" required>
                    {t('recurring.startDate')}
                  </FieldLabel>
                  <DateField
                    id="recurring-start-date"
                    value={startDate}
                    onChange={(value) => dispatch({ type: 'setStartDate', startDate: value })}
                  />
                </Field>
                <Field data-invalid={Boolean(dateError)}>
                  <FieldLabel htmlFor="recurring-end-date">{t('recurring.endDate')}</FieldLabel>
                  <DateField
                    id="recurring-end-date"
                    value={endDate}
                    aria-invalid={Boolean(dateError)}
                    onChange={(value) => dispatch({ type: 'setEndDate', endDate: value })}
                  />
                </Field>
              </FieldGroup>
              {dateError && <FieldError>{dateError}</FieldError>}

              <Field>
                <FieldLabel htmlFor="recurring-duration">{t('recurring.duration')}</FieldLabel>
                <ValidatedNumberInput
                  id="recurring-duration"
                  value={duration}
                  onValueChange={(nextDuration) =>
                    dispatch({ type: 'setDuration', duration: nextDuration })
                  }
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
            onClose={() => dispatch({ type: 'setCustomRepeatOpen', isOpen: false })}
            onSave={(p) => {
              dispatch({ type: 'saveCustomPattern', pattern: p });
            }}
          />
        </>
      )}
    </Modal>
  );
};

export default RecurringTaskEditModal;
