import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBillingFrequencyOptions, useBillingTypeOptions } from '@/hooks/useBillingOptions';
import { DEFAULT_BILLING_FREQUENCY, DEFAULT_BILLING_TYPE } from '@/utils/billing';
import { tasksApi } from '../../services/api';
import type { BillingFrequency, ProjectTask, StoredBillingType } from '../../types';
import { formatNumber } from '../../utils/numbers';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface ProjectTasksTableProps {
  projectId: string;
  tasks: ProjectTask[];
  currency: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canManageAssignments: boolean;
  onAddTask: () => void | Promise<void>;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onRequestDeleteTask: (task: ProjectTask) => void;
  onManageMembers: (task: ProjectTask) => void;
}

type ProjectTaskHoursState = {
  projectId: string | null;
  hours: Record<string, number>;
  loadState: 'idle' | 'loading' | 'error';
};

const INITIAL_TASK_HOURS_STATE: ProjectTaskHoursState = {
  projectId: null,
  hours: {},
  loadState: 'idle',
};

const ProjectTaskEmptyState: React.FC<{ label: string }> = ({ label }) => (
  <span className="text-xs italic text-muted-foreground">{label}</span>
);

const ProjectTaskActionButton: React.FC<{
  label: string;
  iconClassName: string;
  onClick: () => void;
  className?: string;
}> = ({ label, iconClassName, onClick, className }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          aria-label={label}
          className={className}
        >
          <i className={`fa-solid ${iconClassName} text-xs`}></i>
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const ProjectTaskAddButton: React.FC<{
  label: string;
  onAddTask: () => void | Promise<void>;
}> = ({ label, onAddTask }) => (
  <Button
    type="button"
    onClick={() => onAddTask()}
    size="sm"
    className={TABLE_CONTROL_BUTTON_CLASSNAME}
  >
    <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
    {label}
  </Button>
);

const formatTaskNumber = (value: number, minimumFractionDigits = 0) =>
  formatNumber(value, {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  });

interface ProjectTaskColumnsParams {
  currency: string;
  canUpdate: boolean;
  canDelete: boolean;
  canManageAssignments: boolean;
  hoursState: ProjectTaskHoursState;
  getTaskFieldValue: (taskId: string, field: string, fallback: string) => string;
  setTaskFieldValue: (taskId: string, field: string, value: string) => void;
  commitTaskField: (
    row: ProjectTask,
    field: keyof ProjectTask,
    parseValue: (v: string) => unknown,
  ) => void;
  parseTaskNumber: (row: ProjectTask, field: keyof ProjectTask, fallback: number) => number;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onRequestDeleteTask: (task: ProjectTask) => void;
  onManageMembers: (task: ProjectTask) => void;
}

const useProjectTaskColumns = ({
  currency,
  canUpdate,
  canDelete,
  canManageAssignments,
  hoursState,
  getTaskFieldValue,
  setTaskFieldValue,
  commitTaskField,
  parseTaskNumber,
  onUpdateTask,
  onRequestDeleteTask,
  onManageMembers,
}: ProjectTaskColumnsParams): Column<ProjectTask>[] => {
  const { t } = useTranslation(['projects', 'common']);
  const translatedBillingTypeOptions = useBillingTypeOptions();
  const translatedBillingFrequencyOptions = useBillingFrequencyOptions();

  return useMemo<Column<ProjectTask>[]>(
    () => [
      {
        header: t('projects:projects.taskName'),
        id: 'name',
        accessorKey: 'name',
        disableFiltering: true,
        cell: ({ row }) => (
          <Input
            value={getTaskFieldValue(row.id, 'name', row.name)}
            disabled={!canUpdate}
            placeholder={t('projects:projects.taskName')}
            onChange={(e) => setTaskFieldValue(row.id, 'name', e.target.value)}
            onBlur={() => commitTaskField(row, 'name', (v) => v.trim() || row.name)}
            className="h-8 min-w-[120px] text-xs"
          />
        ),
      },
      {
        header: t('projects:projects.billingType'),
        id: 'billingType',
        accessorKey: 'billingType',
        disableFiltering: true,
        cell: ({ row }) => (
          <SelectControl
            options={translatedBillingTypeOptions}
            value={row.billingType ?? DEFAULT_BILLING_TYPE}
            onChange={(val) => onUpdateTask(row.id, { billingType: val as StoredBillingType })}
            disabled={!canUpdate}
            className="min-w-[140px]"
            buttonClassName="h-8 text-xs"
            searchable={false}
          />
        ),
      },
      {
        header: t('projects:projects.billingFrequency'),
        id: 'billingFrequency',
        accessorKey: 'billingFrequency',
        disableFiltering: true,
        cell: ({ row }) => (
          <SelectControl
            options={translatedBillingFrequencyOptions}
            value={row.billingFrequency ?? DEFAULT_BILLING_FREQUENCY}
            onChange={(val) => onUpdateTask(row.id, { billingFrequency: val as BillingFrequency })}
            disabled={!canUpdate}
            className="min-w-[120px]"
            buttonClassName="h-8 text-xs"
            searchable={false}
          />
        ),
      },
      {
        header: t('projects:projects.monthlyEffort'),
        id: 'monthlyEffort',
        accessorKey: 'monthlyEffort',
        disableFiltering: true,
        cell: ({ row }) => (
          <Input
            type="number"
            min="0"
            step="1"
            disabled={!canUpdate}
            value={getTaskFieldValue(row.id, 'monthlyEffort', String(row.monthlyEffort ?? ''))}
            placeholder="0"
            onKeyDown={(e) => {
              if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault();
            }}
            onChange={(e) => setTaskFieldValue(row.id, 'monthlyEffort', e.target.value)}
            onBlur={() => commitTaskField(row, 'monthlyEffort', (v) => (v ? parseFloat(v) : 0))}
            className="h-8 min-w-[80px] text-xs"
          />
        ),
      },
      {
        header: t('projects:projects.duration'),
        id: 'duration',
        accessorKey: 'duration',
        disableFiltering: true,
        cell: ({ row }) => (
          <ValidatedNumberInput
            min="0"
            disabled={!canUpdate}
            value={getTaskFieldValue(row.id, 'duration', String(row.duration ?? 1))}
            placeholder="1"
            onValueChange={(value) => setTaskFieldValue(row.id, 'duration', value)}
            onBlur={() => commitTaskField(row, 'duration', (v) => (v ? parseFloat(v) : 1))}
            className="h-8 min-w-[80px] text-xs"
          />
        ),
      },
      {
        header: t('projects:projects.expectedEffort'),
        id: 'expectedEffort',
        accessorFn: (row) => (row.monthlyEffort ?? 0) * (row.duration ?? 1),
        disableFiltering: true,
        cell: ({ row }) => {
          const totalEffort =
            parseTaskNumber(row, 'monthlyEffort', 0) * parseTaskNumber(row, 'duration', 1);
          return (
            <output className="flex h-8 min-w-[90px] items-center rounded-md border border-input bg-muted/40 px-3 text-xs text-muted-foreground tabular-nums">
              {formatTaskNumber(totalEffort)}h
            </output>
          );
        },
      },
      {
        header: `${t('projects:projects.taskRevenue')} (${currency})`,
        id: 'revenue',
        accessorKey: 'revenue',
        disableFiltering: true,
        cell: ({ row }) => (
          <ValidatedNumberInput
            min="0"
            disabled={!canUpdate}
            value={getTaskFieldValue(row.id, 'revenue', String(row.revenue ?? ''))}
            placeholder="0,00"
            onValueChange={(value) => setTaskFieldValue(row.id, 'revenue', value)}
            onBlur={() => commitTaskField(row, 'revenue', (v) => (v ? parseFloat(v) : 0))}
            className="h-8 min-w-[80px] text-xs"
          />
        ),
      },
      {
        header: `${t('projects:projects.taskTotalRevenue')} (${currency})`,
        id: 'totalRevenue',
        accessorFn: (row) => row.totalRevenue ?? (row.revenue ?? 0) * (row.duration ?? 1),
        disableFiltering: true,
        cell: ({ row }) => {
          const totalRevenue =
            parseTaskNumber(row, 'revenue', 0) * parseTaskNumber(row, 'duration', 1);
          return (
            <output className="flex h-8 min-w-[110px] items-center rounded-md border border-input bg-muted/40 px-3 text-xs text-muted-foreground tabular-nums">
              {currency}
              {formatTaskNumber(totalRevenue, 2)}
            </output>
          );
        },
      },
      {
        header: t('projects:projects.taskNotes'),
        id: 'notes',
        accessorKey: 'notes',
        disableFiltering: true,
        cell: ({ row }) => (
          <Input
            disabled={!canUpdate}
            value={getTaskFieldValue(row.id, 'notes', row.notes ?? '')}
            placeholder="-"
            onChange={(e) => setTaskFieldValue(row.id, 'notes', e.target.value)}
            onBlur={() => commitTaskField(row, 'notes', (v) => v.trim())}
            className="h-8 min-w-[120px] text-xs"
          />
        ),
      },
      {
        header: t('projects:projects.progress'),
        id: 'progress',
        disableFiltering: true,
        cell: ({ row }) => {
          if (hoursState.loadState === 'loading')
            return <span className="text-xs text-muted-foreground">...</span>;
          if (hoursState.loadState === 'error')
            return <span className="text-xs text-destructive">-</span>;
          const logged = hoursState.hours[row.id] ?? 0;
          const expected = row.expectedEffort ?? 0;
          const pct = expected > 0 ? Math.round((logged / expected) * 100) : 0;
          const overBudget = expected > 0 && logged > expected;
          return (
            <span
              className={`text-xs font-bold tabular-nums ${overBudget ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {expected > 0 ? `${pct}%` : '-'}
            </span>
          );
        },
      },
      {
        header: t('projects:projects.tableHeaders.actions'),
        id: 'actions',
        disableFiltering: true,
        align: 'right',
        cell: ({ row }) => {
          if (!canManageAssignments && !canDelete) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              {canManageAssignments && (
                <ProjectTaskActionButton
                  label={t('tasks.manageMembers')}
                  iconClassName="fa-users"
                  onClick={() => onManageMembers(row)}
                  className="text-muted-foreground hover:text-foreground"
                />
              )}
              {canDelete && (
                <ProjectTaskActionButton
                  label={t('common:buttons.delete')}
                  iconClassName="fa-trash-can"
                  onClick={() => onRequestDeleteTask(row)}
                  className="text-muted-foreground hover:text-destructive"
                />
              )}
            </div>
          );
        },
      },
    ],
    [
      canDelete,
      canManageAssignments,
      canUpdate,
      commitTaskField,
      currency,
      getTaskFieldValue,
      hoursState.hours,
      hoursState.loadState,
      onManageMembers,
      onRequestDeleteTask,
      onUpdateTask,
      parseTaskNumber,
      setTaskFieldValue,
      t,
      translatedBillingFrequencyOptions,
      translatedBillingTypeOptions,
    ],
  );
};

const ProjectTasksTable: React.FC<ProjectTasksTableProps> = ({
  projectId,
  tasks,
  currency,
  canCreate,
  canUpdate,
  canDelete,
  canManageAssignments,
  onAddTask,
  onUpdateTask,
  onRequestDeleteTask,
  onManageMembers,
}) => {
  const { t } = useTranslation(['projects', 'common']);

  const [taskEdits, setTaskEdits] = useState<Record<string, Record<string, string>>>({});
  const [hoursState, setHoursState] = useState<ProjectTaskHoursState>(INITIAL_TASK_HOURS_STATE);
  const fetchHoursAbortRef = useRef<AbortController | null>(null);

  if (hoursState.projectId !== projectId) {
    setHoursState({
      projectId,
      hours: {},
      loadState: projectId ? 'loading' : 'idle',
    });
  }

  useEffect(() => {
    if (!projectId) return;
    fetchHoursAbortRef.current?.abort();
    const ac = new AbortController();
    fetchHoursAbortRef.current = ac;
    tasksApi
      .getHours(projectId, ac.signal)
      .then((h) => {
        if (ac.signal.aborted) return;
        setHoursState({ projectId, hours: h, loadState: 'idle' });
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setHoursState((prev) =>
          prev.projectId === projectId ? { ...prev, loadState: 'error' } : prev,
        );
      });
    return () => {
      ac.abort();
    };
  }, [projectId]);

  const getTaskFieldValue = (taskId: string, field: string, fallback: string): string =>
    taskEdits[taskId]?.[field] ?? fallback;

  const setTaskFieldValue = (taskId: string, field: string, value: string) => {
    setTaskEdits((prev) => ({ ...prev, [taskId]: { ...prev[taskId], [field]: value } }));
  };

  const commitTaskField = (
    row: ProjectTask,
    field: keyof ProjectTask,
    parseValue: (v: string) => unknown,
  ) => {
    const edited = taskEdits[row.id]?.[field];
    if (edited === undefined) return;
    const parsed = parseValue(edited);
    if (parsed === row[field]) return;
    onUpdateTask(row.id, { [field]: parsed });
  };

  const parseTaskNumber = (
    row: ProjectTask,
    field: keyof ProjectTask,
    fallback: number,
  ): number => {
    const edited = taskEdits[row.id]?.[field];
    if (edited === '') return fallback;
    const raw = edited ?? String(row[field] ?? fallback);
    const parsed = Number.parseFloat(String(raw));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const columns = useProjectTaskColumns({
    currency,
    canUpdate,
    canDelete,
    canManageAssignments,
    hoursState,
    getTaskFieldValue,
    setTaskFieldValue,
    commitTaskField,
    parseTaskNumber,
    onUpdateTask,
    onRequestDeleteTask,
    onManageMembers,
  });

  return (
    <StandardTable<ProjectTask>
      title={t('projects:projects.projectTasks')}
      data={tasks}
      columns={columns}
      defaultRowsPerPage={5}
      emptyState={<ProjectTaskEmptyState label={t('projects:projects.noTasksAdded')} />}
      headerAction={
        canCreate ? (
          <ProjectTaskAddButton label={t('projects:projects.addTaskRow')} onAddTask={onAddTask} />
        ) : undefined
      }
    />
  );
};

export default ProjectTasksTable;
