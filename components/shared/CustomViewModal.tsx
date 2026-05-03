import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Checkbox from './Checkbox';
import Modal from './Modal';
import type { CustomView } from './StandardTable';

export interface CustomViewModalColumn {
  id: string;
  header: string;
}

export interface CustomViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (view: Pick<CustomView, 'name' | 'hiddenColIds'>) => void;
  columns: CustomViewModalColumn[];
  initialHiddenColIds: Set<string>;
  editingView?: CustomView;
}

const CustomViewModal: React.FC<CustomViewModalProps> = ({
  isOpen,
  onClose,
  onSave,
  columns,
  initialHiddenColIds,
  editingView,
}) => {
  const { t } = useTranslation('common');
  const [name, setName] = useState('');
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    if (editingView) {
      setName(editingView.name);
      setHiddenColIds(new Set(editingView.hiddenColIds));
    } else {
      setName('');
      setHiddenColIds(new Set(initialHiddenColIds));
    }
  }, [isOpen, editingView, initialHiddenColIds]);

  const visibleCount = columns.length - hiddenColIds.size;
  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && visibleCount > 0;

  const toggleCol = (id: string) => {
    setHiddenColIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setHiddenColIds(new Set());
  const deselectAll = () => setHiddenColIds(new Set(columns.map((c) => c.id)));

  const handleSave = () => {
    if (!canSave) return;
    onSave({ name: trimmedName, hiddenColIds: Array.from(hiddenColIds) });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-table-columns text-praetor"></i>
            {editingView ? t('table.editView') : t('table.addCustomView')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="custom-view-name"
              className="text-[10px] font-black text-slate-400 uppercase tracking-widest"
            >
              {t('table.viewName')}
            </label>
            <input
              id="custom-view-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('table.viewNamePlaceholder')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-praetor/30 focus:border-praetor"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('table.columns')}
              </span>
              <div className="flex items-center gap-3 text-[11px] font-semibold">
                <button type="button" onClick={selectAll} className="text-praetor hover:underline">
                  {t('table.selectAllCols')}
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-slate-500 hover:underline"
                >
                  {t('table.deselectAllCols')}
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-1.5 space-y-0.5">
              {columns.map((col) => {
                const isVisible = !hiddenColIds.has(col.id);
                return (
                  <div
                    key={col.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer"
                    onClick={() => toggleCol(col.id)}
                  >
                    <Checkbox size="sm" checked={isVisible} onChange={() => toggleCol(col.id)} />
                    <span className="text-xs text-slate-600 select-none">{col.header}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            {t('table.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 text-xs font-bold text-white bg-praetor hover:bg-praetor/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {t('table.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default CustomViewModal;
