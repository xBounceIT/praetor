import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBillingFrequencyOptions, useBillingTypeOptions } from '../../hooks/useBillingOptions';
import { tasksApi } from '../../services/api/tasks';
import type { BillingFrequency, Client, Project, ProjectTask, Role, User } from '../../types';
import { formatInsertDate } from '../../utils/date';
import { formatNumber } from '../../utils/numbers';
import { hasScopedActionPermission } from '../../utils/permissions';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import UserAssignmentModal from '../shared/UserAssignmentModal';
import TaskFormModal, { type RecurringConfig } from './TaskFormModal';

type TaskHoursLoadState = 'idle' | 'loading' | 'error';

type TasksViewState = {
  editingTask: ProjectTask | null;
  isModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  isDeleting: boolean;
  managingTaskId: string | null;
  taskHours: Record<string, Record<string, number>> | null;
  hoursLoadState: TaskHoursLoadState;
};

type TasksViewAction =
  | { type: 'resetHours'; hasProjects: boolean }
  | { type: 'hoursSuccess'; taskHours: Record<string, Record<string, number>> }
  | { type: 'hoursError' }
  | { type: 'openAdd' }
  | { type: 'openEdit'; task: ProjectTask }
  | { type: 'confirmDelete'; task?: ProjectTask }
  | { type: 'closeAll' }
  | { type: 'closeForm' }
  | { type: 'cancelDelete' }
  | { type: 'deleteStart' }
  | { type: 'deleteDone' }
  | { type: 'manageTask'; taskId: string | null };

const createTasksViewState = (): TasksViewState => ({
  editingTask: null,
  isModalOpen: false,
  isDeleteConfirmOpen: false,
  isDeleting: false,
  managingTaskId: null,
  taskHours: null,
  hoursLoadState: 'idle',
});

const tasksViewReducer = (state: TasksViewState, action: TasksViewAction): TasksViewState => {
  switch (action.type) {
    case 'resetHours':
      return {
        ...state,
        taskHours: action.hasProjects ? null : {},
        hoursLoadState: action.hasProjects ? 'loading' : 'idle',
      };
    case 'hoursSuccess':
      return { ...state, taskHours: action.taskHours, hoursLoadState: 'idle' };
    case 'hoursError':
      return { ...state, taskHours: {}, hoursLoadState: 'error' };
    case 'openAdd':
      return { ...state, editingTask: null, isModalOpen: true };
    case 'openEdit':
      return { ...state, editingTask: action.task, isModalOpen: true };
    case 'confirmDelete':
      return {
        ...state,
        editingTask: action.task ?? state.editingTask,
        isDeleteConfirmOpen: true,
      };
    case 'closeAll':
      return {
        ...state,
        editingTask: null,
        isModalOpen: false,
        isDeleteConfirmOpen: false,
      };
    case 'closeForm':
      return { ...state, editingTask: null, isModalOpen: false };
    case 'cancelDelete':
      return { ...state, isDeleteConfirmOpen: false };
    case 'deleteStart':
      return { ...state, isDeleting: true };
    case 'deleteDone':
      return { ...state, isDeleting: false };
    case 'manageTask':
      return { ...state, managingTaskId: action.taskId };
    default:
      return state;
  }
};

export interface TasksViewProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  permissions: string[];
  users: User[];
  roles: Role[];
  currency: string;
  onAddTask: (
    name: string,
    projectId: string,
    recurringConfig?: RecurringConfig,
    description?: string,
    details?: Pick<
      ProjectTask,
      'monthlyEffort' | 'duration' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => Promise<ProjectTask>;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onDeleteTask: (id: string) => void | Promise<void>;
  onViewOrder?: (orderId: string) => void;
}

type TaskColumnsInput = {
  projects: Project[];
  clients: Client[];
  canUpdateTasks: boolean;
  canDeleteTasks: boolean;
  currency: string;
  taskHours: Record<string, Record<string, number>> | null;
  hoursLoadState: TaskHoursLoadState;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onOpenAssignments: (taskId: string) => void;
  onOpenEdit: (task: ProjectTask) => void;
  onConfirmDelete: (task?: ProjectTask) => void;
  formatBillingType: (value: ProjectTask['billingType']) => string;
  formatBillingFrequency: (value: BillingFrequency | undefined) => string;
};

const useTaskColumns = ({
  projects,
  clients,
  canUpdateTasks,
  canDeleteTasks,
  currency,
  taskHours,
  hoursLoadState,
  onUpdateTask,
  onOpenAssignments,
  onOpenEdit,
  onConfirmDelete,
  formatBillingType,
  formatBillingFrequency,
}: TaskColumnsInput): Column<ProjectTask>[] => {
  const { t, i18n } = useTranslation(['projects', 'common']);
  const checkInheritedDisabled = useCallback(
    (task: ProjectTask) => {
      const project = projects.find((p) => p.id === task.projectId);
      const client = clients.find((c) => c.id === project?.clientId);
      return project?.isDisabled || false || client?.isDisabled || false;
    },
    [projects, clients],
  );

  return useMemo(
    () => [
      {
        header: t('common:labels.client'),
        accessorFn: (task) => {
          const project = projects.find((p) => p.id === task.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          return client?.name || '-';
        },
        cell: ({ row }) => {
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isClientDisabled = client?.isDisabled || false;
          return client ? (
            <span
              className={`text-sm font-bold ${isClientDisabled ? 'text-amber-500' : 'text-zinc-700'}`}
            >
              {client.name} {isClientDisabled && t('projects.disabledLabel')}
            </span>
          ) : (
            <span className="text-xs text-zinc-400 italic">-</span>
          );
        },
      },
      {
        header: t('projects:projects.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (task) => task.createdAt ?? 0,
        cell: ({ row }) => (
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {row.createdAt ? formatInsertDate(row.createdAt, i18n.language) : '—'}
          </span>
        ),
      },
      {
        header: t('tasks.project'),
        accessorFn: (task) => {
          const project = projects.find((p) => p.id === task.projectId);
          return project?.name || t('projects.unknown');
        },
        cell: ({ row }) => {
          const project = projects.find((p) => p.id === row.projectId);
          const isProjectDisabled = project?.isDisabled || false;
          return (
            <span
              className={`text-sm font-bold ${
                isProjectDisabled
                  ? 'text-zinc-600 line-through decoration-zinc-300'
                  : 'text-zinc-800'
              }`}
            >
              {project?.name || t('projects.unknown')}
            </span>
          );
        },
      },
      {
        header: t('tasks.name'),
        accessorKey: 'name',
        cell: ({ value, row }) => {
          const isDisabled = row.isDisabled || checkInheritedDisabled(row);
          return (
            <span
              className={`text-sm font-bold ${isDisabled ? 'text-zinc-600 line-through decoration-zinc-300' : 'text-zinc-800'}`}
            >
              {value}
            </span>
          );
        },
      },
      {
        header: t('tasks.description'),
        accessorFn: (task) => task.description || '',
        cell: ({ value, row }) => {
          const isDisabled = row.isDisabled || checkInheritedDisabled(row);
          return (
            <p
              className={`text-xs truncate max-w-50 ${isDisabled ? 'text-zinc-400 italic' : 'text-zinc-500'}`}
            >
              {value || (
                <span className="italic text-zinc-400">{t('projects.noDescriptionProvided')}</span>
              )}
            </p>
          );
        },
      },
      {
        header: t('projects:projects.billingType'),
        id: 'billingType',
        accessorFn: (task) => formatBillingType(task.billingType),
        cell: ({ row }) => (
          <span className="text-xs font-bold text-zinc-600">
            {formatBillingType(row.billingType)}
          </span>
        ),
      },
      {
        header: t('projects:projects.billingFrequency'),
        id: 'billingFrequency',
        accessorFn: (task) => formatBillingFrequency(task.billingFrequency),
        cell: ({ row }) => (
          <span className="text-xs text-zinc-500">
            {formatBillingFrequency(row.billingFrequency)}
          </span>
        ),
      },
      {
        header: t('projects:projects.monthlyEffort'),
        id: 'monthlyEffort',
        accessorFn: (task) => task.monthlyEffort ?? 0,
        cell: ({ row }) => {
          const effort = row.monthlyEffort;
          if (!effort) return <span className="text-xs text-zinc-400">-</span>;
          return (
            <span className="text-xs font-bold text-zinc-600 tabular-nums">
              {formatNumber(effort, { maximumFractionDigits: 2 })}h
            </span>
          );
        },
      },
      {
        header: t('projects:projects.duration'),
        id: 'duration',
        accessorFn: (task) => task.duration ?? 1,
        cell: ({ row }) => (
          <span className="text-xs font-bold text-zinc-600 tabular-nums">
            {formatNumber(row.duration ?? 1, {
              maximumFractionDigits: 2,
            })}
          </span>
        ),
      },
      {
        header: t('projects:projects.expectedEffort'),
        id: 'expectedEffort',
        accessorFn: (task) => task.expectedEffort ?? 0,
        cell: ({ row }) => {
          const effort = row.expectedEffort;
          if (!effort) return <span className="text-xs text-zinc-400">-</span>;
          return (
            <span className="text-xs font-bold text-zinc-600 tabular-nums">
              {formatNumber(effort, { maximumFractionDigits: 2 })}h
            </span>
          );
        },
      },
      {
        header: `${t('projects:projects.taskRevenue')} (${currency})`,
        id: 'revenue',
        accessorFn: (task) => task.revenue ?? 0,
        cell: ({ row }) => {
          const rev = row.revenue;
          if (!rev) return <span className="text-xs text-zinc-400">-</span>;
          return (
            <span className="text-xs font-bold text-zinc-600 tabular-nums">
              {currency}
              {formatNumber(rev, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          );
        },
      },
      {
        header: `${t('projects:projects.taskTotalRevenue')} (${currency})`,
        id: 'totalRevenue',
        accessorFn: (task) => task.totalRevenue ?? (task.revenue ?? 0) * (task.duration ?? 1),
        cell: ({ row }) => {
          const totalRevenue = row.totalRevenue ?? (row.revenue ?? 0) * (row.duration ?? 1);
          if (!totalRevenue) return <span className="text-xs text-zinc-400">-</span>;
          return (
            <span className="text-xs font-bold text-zinc-600 tabular-nums">
              {currency}
              {formatNumber(totalRevenue, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          );
        },
      },
      {
        header: t('projects:projects.progress'),
        id: 'progress',
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => {
          if (hoursLoadState === 'loading' || taskHours === null) {
            return (
              <span className="text-zinc-400 text-xs">
                <i className="fa-solid fa-spinner fa-spin"></i>
              </span>
            );
          }
          if (hoursLoadState === 'error') return <span className="text-red-500 text-xs">-</span>;
          const projectHours = taskHours[row.projectId] ?? {};
          const logged = projectHours[row.name] ?? 0;
          const expected = row.expectedEffort ?? 0;
          if (!expected) return <span className="text-zinc-400 text-xs">-</span>;
          const pct = Math.round((logged / expected) * 100);
          const overBudget = logged > expected;
          return (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span
                className={`text-xs font-bold tabular-nums ${overBudget ? 'text-red-600' : 'text-zinc-600'}`}
              >
                {pct}%
              </span>
            </div>
          );
        },
      },
      {
        header: t('projects.tableHeaders.status'),
        accessorFn: (task) => {
          const project = projects.find((p) => p.id === task.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isProjectDisabled = project?.isDisabled || false;
          const isClientDisabled = client?.isDisabled || false;
          const isInheritedDisabled = isProjectDisabled || isClientDisabled;
          if (task.isDisabled) return t('projects:projects.statusDisabled');
          if (isInheritedDisabled) return t('projects:projects.statusInheritedDisable');
          return t('projects:projects.statusActive');
        },
        cell: ({ row }) => {
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isProjectDisabled = project?.isDisabled || false;
          const isClientDisabled = client?.isDisabled || false;
          const isInheritedDisabled = isProjectDisabled || isClientDisabled;
          if (row.isDisabled) {
            return <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />;
          }
          if (isInheritedDisabled) {
            return (
              <StatusBadge type="inherited" label={t('projects:projects.statusInheritedDisable')} />
            );
          }
          return <StatusBadge type="active" label={t('projects:projects.statusActive')} />;
        },
      },
      {
        header: t('projects.tableHeaders.actions'),
        id: 'actions',
        className: 'text-right w-[140px]',
        headerClassName: 'text-right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => {
          if (!canUpdateTasks && !canDeleteTasks) return null;
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isInheritedDisabled = project?.isDisabled || client?.isDisabled;
          const isTaskDisabled = row.isDisabled;

          return (
            <div className="flex items-center justify-end gap-2">
              {canUpdateTasks && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAssignments(row.id);
                          }}
                          aria-label={t('tasks.manageMembers')}
                          className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                        >
                          <i className="fa-solid fa-users"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('tasks.manageMembers')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenEdit(row);
                          }}
                          aria-label={t('tasks.editTask')}
                          className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('tasks.editTask')}</TooltipContent>
                  </Tooltip>
                  {!isInheritedDisabled && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateTask(row.id, { isDisabled: !isTaskDisabled });
                            }}
                            aria-label={
                              isTaskDisabled ? t('tasks.enableTask') : t('tasks.disableTask')
                            }
                            className={`p-2 rounded-lg transition-all ${
                              isTaskDisabled
                                ? 'text-praetor hover:bg-zinc-100'
                                : 'text-amber-700 hover:text-amber-600 hover:bg-amber-50'
                            }`}
                          >
                            <i
                              className={`fa-solid ${isTaskDisabled ? 'fa-rotate-left' : 'fa-ban'}`}
                            ></i>
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isTaskDisabled ? t('tasks.enableTask') : t('tasks.disableTask')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
              {canDeleteTasks && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onConfirmDelete(row);
                        }}
                        aria-label={t('common:buttons.delete')}
                        className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ],
    [
      t,
      projects,
      clients,
      canUpdateTasks,
      canDeleteTasks,
      onUpdateTask,
      checkInheritedDisabled,
      onConfirmDelete,
      onOpenAssignments,
      onOpenEdit,
      currency,
      taskHours,
      hoursLoadState,
      i18n.language,
      formatBillingType,
      formatBillingFrequency,
    ],
  );
};

const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  projects,
  clients,
  permissions,
  users,
  roles,
  currency,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onViewOrder,
}) => {
  const { t } = useTranslation(['projects', 'common']);
  const canCreateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'create');
  const canUpdateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'update');
  const canDeleteTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'delete');
  const [state, dispatch] = useReducer(tasksViewReducer, undefined, createTasksViewState);
  const {
    editingTask,
    isModalOpen,
    isDeleteConfirmOpen,
    isDeleting,
    managingTaskId,
    taskHours,
    hoursLoadState,
  } = state;
  const fetchHoursGenRef = useRef(0);

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const projectIdsKey = useMemo(() => projectIds.join('\u0000'), [projectIds]);
  const [loadedProjectIdsKey, setLoadedProjectIdsKey] = useState(projectIdsKey);
  if (loadedProjectIdsKey !== projectIdsKey) {
    setLoadedProjectIdsKey(projectIdsKey);
    dispatch({ type: 'resetHours', hasProjects: projectIds.length > 0 });
  }
  const translatedBillingTypeOptions = useBillingTypeOptions();
  const translatedBillingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingType = useCallback(
    (value: ProjectTask['billingType']) =>
      translatedBillingTypeOptions.find((option) => option.id === value)?.name ?? '-',
    [translatedBillingTypeOptions],
  );
  const formatBillingFrequency = useCallback(
    (value: BillingFrequency | undefined) =>
      translatedBillingFrequencyOptions.find((option) => option.id === value)?.name ?? '-',
    [translatedBillingFrequencyOptions],
  );

  useEffect(() => {
    if (!projectIdsKey) return;
    const requestProjectIds = projectIdsKey.split('\u0000');
    const gen = ++fetchHoursGenRef.current;
    const abortController = new AbortController();
    (async () => {
      try {
        const map = await tasksApi.getHoursForProjects(requestProjectIds, abortController.signal);
        if (fetchHoursGenRef.current === gen) {
          dispatch({ type: 'hoursSuccess', taskHours: map });
        }
      } catch (e) {
        if (!abortController.signal.aborted) {
          console.error('Failed to load task hours', e);
          if (fetchHoursGenRef.current === gen) {
            dispatch({ type: 'hoursError' });
          }
        }
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [projectIdsKey]);

  const openAddModal = useCallback(() => {
    if (!canCreateTasks) return;
    dispatch({ type: 'openAdd' });
  }, [canCreateTasks]);

  const openEditModal = useCallback(
    (task: ProjectTask) => {
      if (!canUpdateTasks) return;
      dispatch({ type: 'openEdit', task });
    },
    [canUpdateTasks],
  );

  const confirmDelete = useCallback(
    (task?: ProjectTask) => {
      if (!canDeleteTasks) return;
      dispatch({ type: 'confirmDelete', task });
    },
    [canDeleteTasks],
  );

  const openAssignments = useCallback(
    (taskId: string) => {
      if (!canUpdateTasks) return;
      dispatch({ type: 'manageTask', taskId });
    },
    [canUpdateTasks],
  );

  const columns = useTaskColumns({
    projects,
    clients,
    canUpdateTasks,
    canDeleteTasks,
    currency,
    taskHours,
    hoursLoadState,
    onUpdateTask,
    onOpenAssignments: openAssignments,
    onOpenEdit: openEditModal,
    onConfirmDelete: confirmDelete,
    formatBillingType,
    formatBillingFrequency,
  });

  const closeModal = () => {
    dispatch({ type: 'closeAll' });
  };

  const requestCloseFormModal = () => {
    if (isDeleting) return;
    dispatch({ type: 'closeForm' });
  };

  const cancelDelete = () => {
    if (isDeleting) return;
    dispatch({ type: 'cancelDelete' });
  };

  const handleDelete = async () => {
    if (!canDeleteTasks) return;
    if (isDeleting) return;
    if (!editingTask) return;
    dispatch({ type: 'deleteStart' });
    try {
      await onDeleteTask(editingTask.id);
      closeModal();
    } finally {
      dispatch({ type: 'deleteDone' });
    }
  };

  const closeAssignments = () => {
    dispatch({ type: 'manageTask', taskId: null });
  };

  const managingTask = tasks.find((t) => t.id === managingTaskId);
  const assignableUsers = users.filter(
    (u) => !u.hasTopManagerRole && !u.isAdminOnly && !u.isDisabled,
  );

  return (
    <div className="space-y-8">
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={cancelDelete}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title={t('tasks.deleteTaskTitle', { name: editingTask?.name })}
        description={
          <Trans
            i18nKey="tasks.deleteConfirmDesc"
            ns="projects"
            values={{ name: editingTask?.name }}
            components={{ span: <span className="font-bold text-zinc-800" /> }}
          />
        }
      />

      {/* User Assignment Modal */}
      <UserAssignmentModal
        isOpen={!!managingTaskId}
        onClose={closeAssignments}
        users={assignableUsers}
        roles={roles}
        loadAssignedUserIds={(signal) => tasksApi.getUsers(managingTaskId as string, signal)}
        saveAssignedUserIds={(ids) => tasksApi.updateUsers(managingTaskId as string, ids)}
        entityLabel={t('common:labels.task')}
        entityName={managingTask?.name || ''}
        disabled={!canUpdateTasks}
      />

      <TaskFormModal
        isOpen={isModalOpen}
        onClose={requestCloseFormModal}
        mode={editingTask ? 'edit' : 'add'}
        editingTask={editingTask}
        projects={projects}
        clients={clients}
        currency={currency}
        permissions={{
          canCreate: canCreateTasks,
          canUpdate: canUpdateTasks,
          canDelete: canDeleteTasks,
        }}
        onAdd={onAddTask}
        onUpdate={onUpdateTask}
        onDelete={() => confirmDelete()}
        onViewOrder={onViewOrder}
      />

      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">{t('tasks.title')}</h2>
            <p className="text-zinc-500 text-sm">{t('tasks.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {canCreateTasks && (
              <HeaderAddButton onClick={openAddModal}>{t('tasks.addTask')}</HeaderAddButton>
            )}
          </div>
        </div>
      </div>

      <StandardTable<ProjectTask>
        title={t('tasks.tasksDirectory')}
        viewKey="tasks.list"
        data={tasks}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={canUpdateTasks ? openEditModal : undefined}
        rowClassName={(row) => {
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          return row.isDisabled || project?.isDisabled || client?.isDisabled
            ? 'opacity-70 grayscale hover:grayscale-0'
            : '';
        }}
      />
    </div>
  );
};

export default TasksView;
