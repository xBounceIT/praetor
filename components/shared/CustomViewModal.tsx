import { GripVertical } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  type CustomView,
  type DropPosition,
  getDirectionalDropPosition,
  moveByDelta,
  normalizeColumnOrder,
  reorderRelative,
} from './customViewHelpers';
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
  reorderable: boolean;
}

export interface CustomViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (view: Pick<CustomView, 'name' | 'hiddenColIds' | 'columnOrder'>) => void;
  columns: CustomViewModalColumn[];
  initialHiddenColIds: Set<string>;
  initialColumnOrder: string[];
  editingView?: CustomView;
  allowColumnHiding?: boolean;
}

type ColumnDragState = {
  draggingColumnId: string | null;
  dropTarget: { columnId: string; position: DropPosition } | null;
};

const EMPTY_COLUMN_DRAG_STATE: ColumnDragState = {
  draggingColumnId: null,
  dropTarget: null,
};

const getReorderableColumnIdSet = (columns: CustomViewModalColumn[]) => {
  const columnIds = new Set<string>();
  for (const column of columns) {
    if (column.reorderable) columnIds.add(column.id);
  }
  return columnIds;
};

// Initial state is computed once when the modal mounts. The parent passes a
// `key` that changes on each open, so a fresh mount initializes name and
// hiddenColIds and columnOrder from the editing/current layout exactly once. This
// avoids resetting the user's in-progress edits when the parent re-renders
// (which produces fresh `columns` / `initialHiddenColIds` references).
const CustomViewModal: React.FC<CustomViewModalProps> = ({
  isOpen,
  onClose,
  onSave,
  columns,
  initialHiddenColIds,
  initialColumnOrder,
  editingView,
  allowColumnHiding = true,
}) => {
  const { t } = useTranslation('common');
  const [name, setName] = useState(() => editingView?.name ?? '');
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(() => {
    if (!allowColumnHiding) return new Set();
    if (editingView) {
      // Drop hidden IDs that no longer match a current column; otherwise stale
      // IDs inflate hiddenColIds.size and can wrongly disable Save.
      const validIds = new Set(columns.map((c) => c.id));
      return new Set(editingView.hiddenColIds.filter((id) => validIds.has(id)));
    }
    return new Set(initialHiddenColIds);
  });
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeColumnOrder(
      editingView?.columnOrder ?? initialColumnOrder,
      getReorderableColumnIdSet(columns),
    ),
  );
  const [columnDragState, setColumnDragState] = useState<ColumnDragState>(EMPTY_COLUMN_DRAG_STATE);
  const orderedColumns = useMemo(() => {
    const columnsById = new Map(columns.map((column) => [column.id, column]));
    const reorderedColumns = columnOrder
      .map((columnId) => columnsById.get(columnId))
      .filter((column): column is CustomViewModalColumn => column !== undefined);
    return [...reorderedColumns, ...columns.filter((column) => !column.reorderable)];
  }, [columnOrder, columns]);

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

  const moveColumn = (columnId: string, delta: number) => {
    setColumnOrder((current) => moveByDelta(current, current.indexOf(columnId), delta));
  };

  const reorderColumn = (fromId: string, toId: string, position: DropPosition) => {
    if (fromId === toId) return;
    setColumnOrder((current) =>
      reorderRelative(current, current.indexOf(fromId), current.indexOf(toId), position),
    );
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: trimmedName,
      hiddenColIds: allowColumnHiding ? Array.from(hiddenColIds) : [],
      columnOrder,
    });
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
                {allowColumnHiding && (
                  <div className="flex items-center gap-3 text-[11px] font-semibold">
                    <Button type="button" variant="link" size="xs" onClick={selectAll}>
                      {t('table.selectAllCols')}
                    </Button>
                    <span className="text-zinc-300">|</span>
                    <Button type="button" variant="link" size="xs" onClick={deselectAll}>
                      {t('table.deselectAllCols')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border p-1.5 space-y-0.5">
                {orderedColumns.map((col) => {
                  const isVisible = !hiddenColIds.has(col.id);
                  const dropPosition =
                    columnDragState.dropTarget?.columnId === col.id &&
                    columnDragState.draggingColumnId !== col.id
                      ? columnDragState.dropTarget.position
                      : null;
                  return (
                    <div
                      key={col.id}
                      data-custom-view-column-id={col.id}
                      onDragOver={(event) => {
                        if (
                          !col.reorderable ||
                          !columnDragState.draggingColumnId ||
                          columnDragState.draggingColumnId === col.id
                        ) {
                          return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        const position = getDirectionalDropPosition(
                          columnOrder,
                          columnDragState.draggingColumnId,
                          col.id,
                        );
                        setColumnDragState((current) =>
                          current.dropTarget?.columnId === col.id &&
                          current.dropTarget.position === position
                            ? current
                            : { ...current, dropTarget: { columnId: col.id, position } },
                        );
                      }}
                      onDragLeave={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (
                          nextTarget instanceof Node &&
                          event.currentTarget.contains(nextTarget)
                        ) {
                          return;
                        }
                        setColumnDragState((current) =>
                          current.dropTarget?.columnId === col.id
                            ? { ...current, dropTarget: null }
                            : current,
                        );
                      }}
                      onDrop={(event) => {
                        const { draggingColumnId } = columnDragState;
                        if (!col.reorderable || !draggingColumnId || draggingColumnId === col.id) {
                          return;
                        }
                        event.preventDefault();
                        const position = getDirectionalDropPosition(
                          columnOrder,
                          draggingColumnId,
                          col.id,
                        );
                        reorderColumn(draggingColumnId, col.id, position);
                        setColumnDragState(EMPTY_COLUMN_DRAG_STATE);
                      }}
                      className={`relative flex w-full items-center rounded hover:bg-accent ${
                        dropPosition === 'before'
                          ? 'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary'
                          : ''
                      } ${
                        dropPosition === 'after'
                          ? 'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary'
                          : ''
                      }`}
                    >
                      {col.reorderable ? (
                        <button
                          type="button"
                          draggable
                          data-custom-view-column-drag-handle={col.id}
                          title={`${t('table.reorderColumnHandle')}: ${col.header}`}
                          aria-label={`${t('table.reorderColumnHandle')}: ${col.header}`}
                          aria-keyshortcuts="ArrowUp ArrowDown"
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowUp') {
                              event.preventDefault();
                              moveColumn(col.id, -1);
                            } else if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              moveColumn(col.id, 1);
                            }
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', col.id);
                            setColumnDragState({ draggingColumnId: col.id, dropTarget: null });
                          }}
                          onDragEnd={() => setColumnDragState(EMPTY_COLUMN_DRAG_STATE)}
                          className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
                        >
                          <GripVertical className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="size-7 shrink-0" aria-hidden="true" />
                      )}
                      {allowColumnHiding ? (
                        <button
                          type="button"
                          aria-pressed={isVisible}
                          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                      ) : (
                        <span className="min-w-0 flex-1 px-1 py-1.5 text-xs text-muted-foreground">
                          {col.header}
                        </span>
                      )}
                    </div>
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
