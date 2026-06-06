import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { CustomView } from './customViewHelpers';
import Modal from './Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from './ModalLayout';

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

// Initial state is computed once when the modal mounts. The parent passes a
// `key` that changes on each open, so a fresh mount initializes name and
// hiddenColIds from `editingView` / `initialHiddenColIds` exactly once. This
// avoids resetting the user's in-progress edits when the parent re-renders
// (which produces fresh `columns` / `initialHiddenColIds` references).
const CustomViewModal: React.FC<CustomViewModalProps> = ({
  isOpen,
  onClose,
  onSave,
  columns,
  initialHiddenColIds,
  editingView,
}) => {
  const { t } = useTranslation('common');
  const [name, setName] = useState(() => editingView?.name ?? '');
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(() => {
    if (editingView) {
      // Drop hidden IDs that no longer match a current column; otherwise stale
      // IDs inflate hiddenColIds.size and can wrongly disable Save.
      const validIds = new Set(columns.map((c) => c.id));
      return new Set(editingView.hiddenColIds.filter((id) => validIds.has(id)));
    }
    return new Set(initialHiddenColIds);
  });

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
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>
              <i className="fa-solid fa-table-columns text-praetor"></i>
              {editingView ? t('table.editView') : t('table.addCustomView')}
            </ModalTitle>
            <ModalCloseButton onClick={onClose} />
          </ModalHeader>

          <ModalBody className="space-y-4">
            <Field>
              <FieldLabel htmlFor="custom-view-name" required>
                {t('table.viewName')}
              </FieldLabel>
              <Input
                id="custom-view-name"
                type="text"
                data-autofocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('table.viewNamePlaceholder')}
              />
            </Field>

            <FieldSet>
              <div className="flex items-center justify-between">
                <FieldLegend variant="label">{t('table.columns')}</FieldLegend>
                <div className="flex items-center gap-3 text-[11px] font-semibold">
                  <Button type="button" variant="link" size="xs" onClick={selectAll}>
                    {t('table.selectAllCols')}
                  </Button>
                  <span className="text-zinc-300">|</span>
                  <Button type="button" variant="link" size="xs" onClick={deselectAll}>
                    {t('table.deselectAllCols')}
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border p-1.5 space-y-0.5">
                {columns.map((col) => {
                  const isVisible = !hiddenColIds.has(col.id);
                  return (
                    <button
                      type="button"
                      key={col.id}
                      aria-pressed={isVisible}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                      onClick={() => toggleCol(col.id)}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex size-3.5 items-center justify-center rounded border-2 transition-colors ${
                          isVisible ? 'border-praetor bg-praetor text-white' : 'border-zinc-300'
                        }`}
                      >
                        <i
                          className={`fa-solid fa-check text-[8px] transition-transform ${
                            isVisible ? 'scale-100' : 'scale-0'
                          }`}
                        ></i>
                      </span>
                      <span className="text-xs text-muted-foreground select-none">
                        {col.header}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FieldSet>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('table.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave}>
              {t('table.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default CustomViewModal;
