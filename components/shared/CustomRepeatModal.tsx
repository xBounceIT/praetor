import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../shared/Modal';
import CustomSelect from './CustomSelect';

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
    <Modal isOpen={isOpen} onClose={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-calendar-days text-praetor"></i>
            {t('recurring.customRepeatTitle')}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{t('recurring.customRepeatSubtitle')}</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {t('recurring.every')}
            </span>
            <div className="flex-1">
              <CustomSelect
                options={occurrenceOptions}
                value={type}
                onChange={(val) => setType(val as typeof type)}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-2">
            <CustomSelect
              label={t('recurring.dayOfWeek')}
              options={days}
              value={dayOfWeek.toString()}
              onChange={(val) => setDayOfWeek(parseInt(val as string, 10))}
              className="w-full"
            />
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3 rounded-b-2xl">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 rounded-xl transition-colors"
          >
            {t('recurring.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
          >
            {t('recurring.setPattern')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default CustomRepeatModal;
