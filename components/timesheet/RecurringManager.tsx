import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, Project, ProjectTask } from '../../types';
import { formatDateOnlyForLocale } from '../../utils/date';
import { formatRecurrencePattern } from '../../utils/recurrence';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import RecurringTaskEditModal from './RecurringTaskEditModal';

export interface RecurringManagerProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  onAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
  onUpdate: (
    taskId: string,
    pattern: string,
    startDate?: string,
    endDate?: string,
    duration?: number,
  ) => void | Promise<void>;
}

const RecurringManager: React.FC<RecurringManagerProps> = ({
  tasks,
  projects,
  clients,
  onAction,
  onUpdate,
}) => {
  const { t } = useTranslation('timesheets');
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<ProjectTask | null>(null);

  const recurringTasks = useMemo(() => tasks.filter((task) => task.isRecurring), [tasks]);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const columns: Column<ProjectTask>[] = useMemo(
    () => [
      {
        header: t('common:labels.client'),
        id: 'client',
        accessorFn: (task) => {
          const project = projectsById.get(task.projectId);
          return project ? clientsById.get(project.clientId)?.name || '' : '';
        },
        cell: ({ value }) => (
          <span className="text-sm font-bold text-slate-800">
            {(value as string) || t('recurring.unknown')}
          </span>
        ),
      },
      {
        header: t('common:labels.project'),
        id: 'project',
        accessorFn: (task) => projectsById.get(task.projectId)?.name || '',
        cell: ({ row: task }) => {
          const project = projectsById.get(task.projectId);
          return (
            <span className="text-sm text-slate-600 inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: project?.color || '#ccc' }}
              ></span>
              {project?.name || t('recurring.unknown')}
            </span>
          );
        },
      },
      {
        header: t('common:labels.task'),
        id: 'task',
        accessorFn: (task) => task.name,
        cell: ({ value }) => <span className="text-sm text-slate-700">{value as string}</span>,
      },
      {
        header: t('recurring.pattern'),
        id: 'pattern',
        accessorFn: (task) => formatRecurrencePattern(task.recurrencePattern, t),
        cell: ({ value }) => <StatusBadge type="recurrence" label={value as string} />,
      },
      {
        header: t('recurring.startDate'),
        id: 'startDate',
        accessorFn: (task) => task.recurrenceStart || '',
        cell: ({ row: task }) =>
          task.recurrenceStart ? (
            <span className="text-sm text-slate-600">
              {formatDateOnlyForLocale(task.recurrenceStart)}
            </span>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          ),
      },
      {
        header: t('recurring.endDate'),
        id: 'endDate',
        accessorFn: (task) => task.recurrenceEnd || '',
        cell: ({ row: task }) =>
          task.recurrenceEnd ? (
            <span className="text-sm text-slate-600">
              {formatDateOnlyForLocale(task.recurrenceEnd)}
            </span>
          ) : (
            <span className="text-sm text-slate-400 italic">{t('recurring.noExpiration')}</span>
          ),
      },
      {
        header: t('recurring.duration'),
        id: 'duration',
        accessorFn: (task) => task.recurrenceDuration ?? 0,
        align: 'right',
        cell: ({ row: task }) =>
          task.recurrenceDuration ? (
            <span className="text-sm font-bold text-slate-700">
              {task.recurrenceDuration}
              {t('recurring.hoursSuffix')}
            </span>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          ),
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        align: 'right',
        sticky: 'right',
        disableSorting: true,
        disableFiltering: true,
        // Override StandardTable's inline `width: auto` for sticky-right via
        // Tailwind's important suffix (generates `width: 1px !important`)
        // so the column shrinks to fit just the two icon buttons.
        headerClassName: 'w-px!',
        className: 'w-px!',
        cell: ({ row: task }) => (
          <div className="flex items-center justify-end gap-1">
            <Tooltip label={t('common:buttons.edit')}>
              {() => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTask(task);
                  }}
                  className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                >
                  <i className="fa-solid fa-pen"></i>
                </button>
              )}
            </Tooltip>
            <Tooltip label={t('common:buttons.delete')}>
              {() => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingTask(task);
                  }}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              )}
            </Tooltip>
          </div>
        ),
      },
    ],
    [t, projectsById, clientsById],
  );

  const emptyState = (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
        <i className="fa-solid fa-repeat text-slate-300 text-2xl"></i>
      </div>
      <p className="text-slate-500 font-medium">{t('recurring.noRecurringTasksConfigured')}</p>
      <p className="text-xs text-slate-400">{t('recurring.setFromTracker')}</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <StandardTable<ProjectTask>
        title={t('recurring.recurringTaskSchedule')}
        totalLabel={t('recurring.active').toLowerCase()}
        data={recurringTasks}
        columns={columns}
        emptyState={emptyState}
      />

      <RecurringTaskEditModal
        key={editingTask?.id ?? 'closed'}
        isOpen={editingTask !== null}
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={(pattern, startDate, endDate, duration) => {
          if (!editingTask) return;
          void onUpdate(editingTask.id, pattern, startDate, endDate, duration);
          setEditingTask(null);
        }}
      />

      <DeleteConfirmModal
        isOpen={deletingTask !== null}
        onClose={() => setDeletingTask(null)}
        onConfirm={() => {
          if (!deletingTask) return;
          onAction(deletingTask.id, 'stop');
          setDeletingTask(null);
        }}
        title={t('recurring.deleteConfirmTitle')}
        description={t('recurring.deleteConfirmDescription', {
          name: deletingTask?.name ?? '',
        })}
      />
    </div>
  );
};

export default RecurringManager;
