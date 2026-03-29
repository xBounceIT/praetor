import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DashboardWidget,
  DashboardWidgetFilterRowsTransformation,
  DashboardWidgetMergeSeriesTransformation,
  DashboardWidgetOrganizeSeriesTransformation,
  DashboardWidgetQuery,
  DashboardWidgetSortRowsTransformation,
  DashboardWidgetTransformation,
} from '../../services/api/reports';
import CustomSelect from '../shared/CustomSelect';
import {
  createDashboardWidgetTransformation,
  getDashboardWidgetTransformationQueryOptions,
} from './dashboardWidgetTransformations';

type TransformationOption = {
  type: DashboardWidgetTransformation['type'];
  disabled: boolean;
};

interface WidgetTransformationEditorProps {
  chartType: DashboardWidget['chartType'];
  queries: DashboardWidgetQuery[];
  transformations: DashboardWidgetTransformation[];
  onChange: (value: DashboardWidgetTransformation[]) => void;
  disabled?: boolean;
}

interface TransformationCardProps {
  disabled: boolean;
  isOver: boolean;
  isDragging: boolean;
  title: string;
  children: React.ReactNode;
  dragHandleProps: React.HTMLAttributes<HTMLElement>;
  setNodeRef: (node: HTMLElement | null) => void;
  onRemove: () => void;
  removeLabel: string;
  dragLabel: string;
}

const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex) return items;
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
};

const TransformationCard: React.FC<TransformationCardProps> = ({
  disabled,
  isOver,
  isDragging,
  title,
  children,
  dragHandleProps,
  setNodeRef,
  onRemove,
  removeLabel,
  dragLabel,
}) => (
  <div
    ref={setNodeRef}
    className={`rounded-2xl border bg-slate-50 p-4 transition ${
      isOver ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
    } ${isDragging ? 'opacity-50' : ''}`}
  >
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...dragHandleProps}
          disabled={disabled}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={dragLabel}
          title={dragLabel}
        >
          <i className="fa-solid fa-grip-vertical text-xs" />
        </button>
        <p className="text-sm font-bold text-slate-700">{title}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-60"
      >
        {removeLabel}
      </button>
    </div>
    {children}
  </div>
);

const DraggableTransformationCard: React.FC<
  Omit<TransformationCardProps, 'isOver' | 'isDragging' | 'dragHandleProps' | 'setNodeRef'> & {
    id: string;
    dragDisabled: boolean;
  }
> = ({ id, dragDisabled, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef: setDragNodeRef,
    isDragging,
  } = useDraggable({
    id,
    disabled: dragDisabled,
  });
  const { isOver, setNodeRef: setDropNodeRef } = useDroppable({
    id,
    disabled: dragDisabled,
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setDragNodeRef(node);
    setDropNodeRef(node);
  };

  return (
    <TransformationCard
      {...props}
      setNodeRef={setNodeRef}
      isOver={isOver}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
};

const WidgetTransformationEditor: React.FC<WidgetTransformationEditorProps> = ({
  chartType,
  queries,
  transformations,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation('reports');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const queryOptions = useMemo(
    () => getDashboardWidgetTransformationQueryOptions(queries),
    [queries],
  );
  const queryOptionMap = useMemo(
    () => new Map(queryOptions.map((item) => [item.id, item.name] as const)),
    [queryOptions],
  );
  const hasMultipleQueries = queries.length > 1;

  const transformationOptions = useMemo<TransformationOption[]>(
    () => [
      { type: 'sortRows', disabled: false },
      { type: 'filterRows', disabled: false },
      { type: 'organizeSeries', disabled: !hasMultipleQueries || chartType === 'pie' },
      { type: 'mergeSeries', disabled: !hasMultipleQueries || chartType === 'pie' },
      { type: 'reduceQueries', disabled: !hasMultipleQueries || chartType === 'pie' },
    ],
    [chartType, hasMultipleQueries],
  );

  useEffect(() => {
    if (!isAddMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isAddMenuOpen]);

  const updateTransformation = (
    transformationId: string,
    updater: (value: DashboardWidgetTransformation) => DashboardWidgetTransformation,
  ) => {
    onChange(transformations.map((item) => (item.id === transformationId ? updater(item) : item)));
  };

  const removeTransformation = (transformationId: string) => {
    onChange(transformations.filter((item) => item.id !== transformationId));
  };

  const addTransformation = (type: DashboardWidgetTransformation['type']) => {
    onChange([...transformations, createDashboardWidgetTransformation(type, queries)]);
    setIsAddMenuOpen(false);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const draggedId = activeDragId;
    setActiveDragId(null);

    if (!draggedId || !event.over || draggedId === String(event.over.id)) return;

    const fromIndex = transformations.findIndex((item) => item.id === draggedId);
    const toIndex = transformations.findIndex((item) => item.id === String(event.over?.id));
    if (fromIndex === -1 || toIndex === -1) return;
    onChange(moveArrayItem(transformations, fromIndex, toIndex));
  };

  const activeTransformation = activeDragId
    ? transformations.find((item) => item.id === activeDragId) || null
    : null;

  const reducerOptions = [
    { id: 'sum', name: t('dashboard.widgetEditor.transformations.reducers.sum') },
    { id: 'avg', name: t('dashboard.widgetEditor.transformations.reducers.avg') },
    { id: 'min', name: t('dashboard.widgetEditor.transformations.reducers.min') },
    { id: 'max', name: t('dashboard.widgetEditor.transformations.reducers.max') },
  ];

  const getTransformationTitle = (transformation: DashboardWidgetTransformation) =>
    t(`dashboard.widgetEditor.transformations.types.${transformation.type}`);

  const moveOrganizeSeriesItem = (
    transformation: DashboardWidgetOrganizeSeriesTransformation,
    queryId: string,
    offset: -1 | 1,
  ) => {
    const orderedQueryIds = Array.from(
      new Set([
        ...transformation.queryOrder.filter((id) => queryOptionMap.has(id)),
        ...queries.map((query) => query.id).filter((id) => !transformation.queryOrder.includes(id)),
      ]),
    );
    const currentIndex = orderedQueryIds.indexOf(queryId);
    const targetIndex = currentIndex + offset;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= orderedQueryIds.length) return;

    updateTransformation(transformation.id, (current) => {
      if (current.type !== 'organizeSeries') return current;
      return {
        ...current,
        queryOrder: moveArrayItem(orderedQueryIds, currentIndex, targetIndex),
      };
    });
  };

  const renderFilterRowsFields = (transformation: DashboardWidgetFilterRowsTransformation) => {
    const fieldOptions = [
      { id: 'label', name: t('dashboard.widgetEditor.transformations.fields.label') },
      { id: 'total', name: t('dashboard.widgetEditor.transformations.fields.total') },
    ];
    const labelOperatorOptions = [
      { id: 'contains', name: t('dashboard.widgetEditor.transformations.operators.contains') },
      { id: 'equals', name: t('dashboard.widgetEditor.transformations.operators.equals') },
      { id: 'startsWith', name: t('dashboard.widgetEditor.transformations.operators.startsWith') },
    ];
    const totalOperatorOptions = [
      { id: 'gt', name: t('dashboard.widgetEditor.transformations.operators.gt') },
      { id: 'gte', name: t('dashboard.widgetEditor.transformations.operators.gte') },
      { id: 'lt', name: t('dashboard.widgetEditor.transformations.operators.lt') },
      { id: 'lte', name: t('dashboard.widgetEditor.transformations.operators.lte') },
      { id: 'between', name: t('dashboard.widgetEditor.transformations.operators.between') },
    ];

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CustomSelect
          label={t('dashboard.widgetEditor.transformations.fieldLabel')}
          options={fieldOptions}
          value={transformation.field}
          onChange={(value) =>
            updateTransformation(transformation.id, (current) => {
              if (current.type !== 'filterRows') return current;
              const nextField = value as 'label' | 'total';
              return nextField === 'label'
                ? {
                    ...current,
                    field: nextField,
                    operator: 'contains',
                    value:
                      typeof current.value === 'string'
                        ? current.value
                        : String(current.value ?? ''),
                    secondaryValue: undefined,
                  }
                : {
                    ...current,
                    field: nextField,
                    operator: 'gte',
                    value:
                      typeof current.value === 'number' && Number.isFinite(current.value)
                        ? current.value
                        : 0,
                    secondaryValue:
                      typeof current.secondaryValue === 'number' &&
                      Number.isFinite(current.secondaryValue)
                        ? current.secondaryValue
                        : 0,
                  };
            })
          }
          disabled={disabled}
        />
        <CustomSelect
          label={t('dashboard.widgetEditor.transformations.operatorLabel')}
          options={transformation.field === 'label' ? labelOperatorOptions : totalOperatorOptions}
          value={transformation.operator}
          onChange={(value) =>
            updateTransformation(transformation.id, (current) => {
              if (current.type !== 'filterRows') return current;
              return {
                ...current,
                operator: value as DashboardWidgetFilterRowsTransformation['operator'],
              };
            })
          }
          disabled={disabled}
        />

        {transformation.field === 'label' ? (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.widgetEditor.transformations.valueLabel')}
            </label>
            <input
              value={String(transformation.value ?? '')}
              onChange={(event) =>
                updateTransformation(transformation.id, (current) => {
                  if (current.type !== 'filterRows') return current;
                  return {
                    ...current,
                    value: event.target.value,
                  };
                })
              }
              disabled={disabled}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                {t('dashboard.widgetEditor.transformations.valueLabel')}
              </label>
              <input
                type="number"
                value={Number(transformation.value ?? 0)}
                onChange={(event) =>
                  updateTransformation(transformation.id, (current) => {
                    if (current.type !== 'filterRows') return current;
                    return {
                      ...current,
                      value: Number(event.target.value),
                    };
                  })
                }
                disabled={disabled}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
              />
            </div>
            {transformation.operator === 'between' && (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t('dashboard.widgetEditor.transformations.secondaryValueLabel')}
                </label>
                <input
                  type="number"
                  value={Number(transformation.secondaryValue ?? transformation.value ?? 0)}
                  onChange={(event) =>
                    updateTransformation(transformation.id, (current) => {
                      if (current.type !== 'filterRows') return current;
                      return {
                        ...current,
                        secondaryValue: Number(event.target.value),
                      };
                    })
                  }
                  disabled={disabled}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('dashboard.widgetEditor.tabs.transformation')}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {t('dashboard.widgetEditor.transformations.executionHint')}
          </p>
        </div>

        <div className="relative" ref={addMenuRef}>
          <button
            type="button"
            onClick={() => setIsAddMenuOpen((prev) => !prev)}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <i className="fa-solid fa-plus text-[10px]" />
            {t('dashboard.widgetEditor.addTransformation')}
          </button>

          {isAddMenuOpen && (
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-slate-200 bg-white py-2 shadow-xl">
              {transformationOptions.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => addTransformation(option.type)}
                  disabled={option.disabled}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {t(`dashboard.widgetEditor.transformations.types.${option.type}`)}
                    </p>
                    {option.disabled && (
                      <p className="mt-1 text-xs text-slate-400">
                        {t('dashboard.widgetEditor.transformations.multiQueryOnly')}
                      </p>
                    )}
                  </div>
                  <i className="fa-solid fa-plus text-[10px] text-slate-300" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {transformations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          {t('dashboard.widgetEditor.transformations.empty')}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="space-y-3">
            {transformations.map((transformation) => {
              const title = getTransformationTitle(transformation);

              return (
                <DraggableTransformationCard
                  key={transformation.id}
                  id={transformation.id}
                  title={title}
                  disabled={disabled}
                  dragDisabled={disabled}
                  onRemove={() => removeTransformation(transformation.id)}
                  removeLabel={t('dashboard.widgetEditor.removeTransformation')}
                  dragLabel={t('dashboard.widgetEditor.transformations.dragLabel')}
                >
                  {transformation.type === 'sortRows' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <CustomSelect
                        label={t('dashboard.widgetEditor.transformations.sortByLabel')}
                        options={[
                          {
                            id: 'label',
                            name: t('dashboard.widgetEditor.transformations.fields.label'),
                          },
                          {
                            id: 'total',
                            name: t('dashboard.widgetEditor.transformations.fields.total'),
                          },
                        ]}
                        value={transformation.sortBy}
                        onChange={(value) =>
                          updateTransformation(transformation.id, (current) => {
                            if (current.type !== 'sortRows') return current;
                            return {
                              ...current,
                              sortBy: value as DashboardWidgetSortRowsTransformation['sortBy'],
                            };
                          })
                        }
                        disabled={disabled}
                      />
                      <CustomSelect
                        label={t('dashboard.widgetEditor.transformations.directionLabel')}
                        options={[
                          {
                            id: 'asc',
                            name: t('dashboard.widgetEditor.transformations.directions.asc'),
                          },
                          {
                            id: 'desc',
                            name: t('dashboard.widgetEditor.transformations.directions.desc'),
                          },
                        ]}
                        value={transformation.direction}
                        onChange={(value) =>
                          updateTransformation(transformation.id, (current) => {
                            if (current.type !== 'sortRows') return current;
                            return {
                              ...current,
                              direction:
                                value as DashboardWidgetSortRowsTransformation['direction'],
                            };
                          })
                        }
                        disabled={disabled}
                      />
                    </div>
                  )}

                  {transformation.type === 'filterRows' && renderFilterRowsFields(transformation)}

                  {transformation.type === 'organizeSeries' && (
                    <div className="space-y-2">
                      {Array.from(
                        new Set([
                          ...transformation.queryOrder.filter((id) => queryOptionMap.has(id)),
                          ...queries
                            .map((query) => query.id)
                            .filter((id) => !transformation.queryOrder.includes(id)),
                        ]),
                      ).map((queryId, index, orderedIds) => {
                        const isHidden = transformation.hiddenQueryIds.includes(queryId);
                        return (
                          <div
                            key={queryId}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-700">
                                {queryOptionMap.get(queryId) || queryId}
                              </p>
                              <p className="text-xs text-slate-400">
                                {isHidden
                                  ? t('dashboard.widgetEditor.transformations.hidden')
                                  : t('dashboard.widgetEditor.transformations.visible')}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => moveOrganizeSeriesItem(transformation, queryId, -1)}
                                disabled={disabled || index === 0}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 disabled:opacity-50"
                                aria-label={t('dashboard.widgetEditor.transformations.moveUp')}
                                title={t('dashboard.widgetEditor.transformations.moveUp')}
                              >
                                <i className="fa-solid fa-arrow-up text-[10px]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveOrganizeSeriesItem(transformation, queryId, 1)}
                                disabled={disabled || index === orderedIds.length - 1}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 disabled:opacity-50"
                                aria-label={t('dashboard.widgetEditor.transformations.moveDown')}
                                title={t('dashboard.widgetEditor.transformations.moveDown')}
                              >
                                <i className="fa-solid fa-arrow-down text-[10px]" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateTransformation(transformation.id, (current) => {
                                    if (current.type !== 'organizeSeries') return current;
                                    return {
                                      ...current,
                                      hiddenQueryIds: current.hiddenQueryIds.includes(queryId)
                                        ? current.hiddenQueryIds.filter((item) => item !== queryId)
                                        : [...current.hiddenQueryIds, queryId],
                                    };
                                  })
                                }
                                disabled={disabled}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                                  isHidden
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-600'
                                } disabled:opacity-60`}
                              >
                                {isHidden
                                  ? t('dashboard.widgetEditor.transformations.showSeries')
                                  : t('dashboard.widgetEditor.transformations.hideSeries')}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {transformation.type === 'mergeSeries' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <CustomSelect
                        label={t('dashboard.widgetEditor.transformations.seriesLabel')}
                        options={queryOptions}
                        value={transformation.queryIds}
                        onChange={(value) =>
                          updateTransformation(transformation.id, (current) => {
                            if (current.type !== 'mergeSeries') return current;
                            return {
                              ...current,
                              queryIds: value as string[],
                            };
                          })
                        }
                        disabled={disabled}
                        isMulti
                      />
                      <CustomSelect
                        label={t('dashboard.widgetEditor.transformations.reducerLabel')}
                        options={reducerOptions}
                        value={transformation.reducer}
                        onChange={(value) =>
                          updateTransformation(transformation.id, (current) => {
                            if (current.type !== 'mergeSeries') return current;
                            return {
                              ...current,
                              reducer: value as DashboardWidgetMergeSeriesTransformation['reducer'],
                            };
                          })
                        }
                        disabled={disabled}
                      />
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('dashboard.widgetEditor.transformations.outputLabel')}
                        </label>
                        <input
                          value={transformation.label || ''}
                          onChange={(event) =>
                            updateTransformation(transformation.id, (current) => {
                              if (current.type !== 'mergeSeries') return current;
                              return {
                                ...current,
                                label: event.target.value,
                              };
                            })
                          }
                          placeholder={t(
                            'dashboard.widgetEditor.transformations.outputPlaceholder',
                          )}
                          maxLength={120}
                          disabled={disabled}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                        />
                      </div>
                    </div>
                  )}

                  {transformation.type === 'reduceQueries' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <CustomSelect
                        label={t('dashboard.widgetEditor.transformations.seriesLabel')}
                        options={queryOptions}
                        value={transformation.queryIds}
                        onChange={(value) =>
                          updateTransformation(transformation.id, (current) => {
                            if (current.type !== 'reduceQueries') return current;
                            return {
                              ...current,
                              queryIds: value as string[],
                            };
                          })
                        }
                        disabled={disabled}
                        isMulti
                      />
                      <CustomSelect
                        label={t('dashboard.widgetEditor.transformations.reducerLabel')}
                        options={reducerOptions}
                        value={transformation.reducer}
                        onChange={(value) =>
                          updateTransformation(transformation.id, (current) => {
                            if (current.type !== 'reduceQueries') return current;
                            return {
                              ...current,
                              reducer: value as DashboardWidgetMergeSeriesTransformation['reducer'],
                            };
                          })
                        }
                        disabled={disabled}
                      />
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('dashboard.widgetEditor.transformations.outputLabel')}
                        </label>
                        <input
                          value={transformation.label || ''}
                          onChange={(event) =>
                            updateTransformation(transformation.id, (current) => {
                              if (current.type !== 'reduceQueries') return current;
                              return {
                                ...current,
                                label: event.target.value,
                              };
                            })
                          }
                          placeholder={t(
                            'dashboard.widgetEditor.transformations.outputPlaceholder',
                          )}
                          maxLength={120}
                          disabled={disabled}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                        />
                      </div>
                    </div>
                  )}
                </DraggableTransformationCard>
              );
            })}
          </div>

          <DragOverlay>
            {activeTransformation ? (
              <div className="rounded-xl border border-blue-200 bg-white px-4 py-2 shadow-lg">
                <span className="text-sm font-semibold text-slate-700">
                  {getTransformationTitle(activeTransformation)}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
};

export default WidgetTransformationEditor;
