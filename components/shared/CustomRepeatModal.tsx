import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
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
  onClose: () => void;
  onSave: (pattern: string) => void;
}

const CustomRepeatModal: React.FC<CustomRepeatModalProps> = ({ isOpen, onClose, onSave }) => {
  const { t } = useTranslation('timesheets');
  const [type, setType] = useState<'first' | 'second' | 'third' | 'fourth' | 'last'>('first');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1); // 1 = Monday, 7 = Sunday (standard JS getDay is 0=Sun, but usually we map 1-7 for UI)

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
    onSave(`monthly:${type}:${dayOfWeek}`);
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
                value={type}
                onChange={(val) => setType(val as typeof type)}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-2">
            <SelectControl
              label={t('recurring.dayOfWeek')}
              options={days}
              value={dayOfWeek.toString()}
              onChange={(val) => setDayOfWeek(parseInt(val as string, 10))}
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
    </Modal>
  );
};

export default CustomRepeatModal;
