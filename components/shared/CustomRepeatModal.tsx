import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  type MonthlyRecurrenceOccurrence,
  parseMonthlyRecurrencePattern,
} from '../../utils/recurrence';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from './ModalLayout';
import SelectControl from './SelectControl';

export interface CustomRepeatModalProps {
  isOpen: boolean;
  initialPattern?: string;
  onClose: () => void;
  onSave: (pattern: string) => void;
}

const CustomRepeatModal: React.FC<CustomRepeatModalProps> = ({
  isOpen,
  initialPattern,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation('timesheets');
  const [selection, setSelection] = useState(
    () =>
      parseMonthlyRecurrencePattern(initialPattern) ?? {
        occurrence: 'first' as const,
        dayOfWeek: 1,
      },
  );

  const days = [
    { id: '1', name: t('recurring.dayNames.monday') },
    { id: '2', name: t('recurring.dayNames.tuesday') },
    { id: '3', name: t('recurring.dayNames.wednesday') },
    { id: '4', name: t('recurring.dayNames.thursday') },
    { id: '5', name: t('recurring.dayNames.friday') },
    { id: '6', name: t('recurring.dayNames.saturday') },
    { id: '0', name: t('recurring.dayNames.sunday') },
  ];

  const handleSave = () => {
    // pattern format: monthly:first:1 (First Monday), monthly:last:0 (Last Sunday)
    onSave(`monthly:${selection.occurrence}:${selection.dayOfWeek}`);
    onClose();
  };

  const occurrenceOptions = [
    { id: 'first', name: t('recurring.occurrences.first') },
    { id: 'second', name: t('recurring.occurrences.second') },
    { id: 'third', name: t('recurring.occurrences.third') },
    { id: 'fourth', name: t('recurring.occurrences.fourth') },
    { id: 'last', name: t('recurring.occurrences.last') },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="sm" onClick={(e) => e.stopPropagation()}>
          <ModalHeader>
            <div>
              <ModalTitle>
                <i className="fa-solid fa-calendar-days text-praetor"></i>
                {t('recurring.customRepeatTitle')}
              </ModalTitle>
              <ModalDescription>{t('recurring.customRepeatSubtitle')}</ModalDescription>
            </div>
          </ModalHeader>

          <ModalBody className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {t('recurring.every')}
              </span>
              <div className="flex-1">
                <SelectControl
                  options={occurrenceOptions}
                  value={selection.occurrence}
                  onChange={(val) =>
                    setSelection((current) => ({
                      ...current,
                      occurrence: val as MonthlyRecurrenceOccurrence,
                    }))
                  }
                  className="w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <SelectControl
                label={t('recurring.dayOfWeek')}
                options={days}
                value={selection.dayOfWeek.toString()}
                onChange={(val) =>
                  setSelection((current) => ({
                    ...current,
                    dayOfWeek: Number(val),
                  }))
                }
                className="w-full"
              />
            </div>
          </ModalBody>

          <ModalFooter className="grid grid-cols-2 sm:flex">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('recurring.cancel')}
            </Button>
            <Button type="button" onClick={handleSave}>
              {t('recurring.setPattern')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default CustomRepeatModal;
