import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTask } from '../types';
import { getLocalDateString } from '../utils/date';
import { formatRecurrencePattern } from '../utils/recurrence';
import CustomRepeatModal from './shared/CustomRepeatModal';
import CustomSelect from './shared/CustomSelect';
import Modal from './shared/Modal';
import ValidatedNumberInput from './shared/ValidatedNumberInput';

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
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
              <i className="fa-solid fa-pen-to-square"></i>
            </div>
            <div>
              <div>{t('recurring.editRecurring')}</div>
              {task && (
                <div className="text-xs font-semibold text-slate-500 mt-0.5 truncate max-w-[18rem]">
                  {task.name}
                </div>
              )}
            </div>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          <p className="text-xs text-slate-500">{t('recurring.editSubtitle')}</p>

          <div>
            <CustomSelect
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="recurring-start-date"
                className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider"
              >
                {t('recurring.startDate')}
              </label>
              <input
                id="recurring-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-semibold focus:ring-2 focus:ring-praetor focus:border-praetor outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="recurring-end-date"
                className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider"
              >
                {t('recurring.endDate')}
              </label>
              <input
                id="recurring-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`w-full px-3 py-2.5 bg-slate-50 border rounded-xl text-sm text-slate-700 font-semibold focus:ring-2 outline-none ${
                  dateError
                    ? 'border-red-500 focus:ring-red-200 bg-red-50'
                    : 'border-slate-200 focus:ring-praetor focus:border-praetor'
                }`}
              />
            </div>
          </div>
          {dateError && <p className="text-red-500 text-[11px] font-bold -mt-2">{dateError}</p>}

          <div>
            <label
              htmlFor="recurring-duration"
              className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider"
            >
              {t('recurring.duration')}
            </label>
            <ValidatedNumberInput
              id="recurring-duration"
              value={duration}
              onValueChange={setDuration}
              placeholder="0.0"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-semibold focus:ring-2 focus:ring-praetor focus:border-praetor outline-none"
            />
          </div>
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            className={`px-8 py-2.5 text-white text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
              canSave
                ? 'bg-praetor shadow-slate-200 hover:bg-slate-700'
                : 'bg-slate-300 shadow-none cursor-not-allowed'
            }`}
          >
            {t('common:buttons.update')}
          </button>
        </div>
      </div>

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
