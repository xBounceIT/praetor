import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { tasksApi } from '../../services/api/tasks';
import type {
  BillingFrequency,
  Client,
  Project,
  ProjectTask,
  Role,
  StoredBillingType,
  User,
} from '../../types';
import { formatInsertDate } from '../../utils/date';
import { hasScopedActionPermission } from '../../utils/permissions';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Toggle from '../shared/Toggle';
import UserAssignmentModal from '../shared/UserAssignmentModal';

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;

export type RecurringConfig = { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' };

const billingTypeOptions = [
  { id: 'time_and_materials', name: 'projects:projects.billingTypes.timeAndMaterials' },
  { id: 'retainer', name: 'projects:projects.billingTypes.retainer' },
];

const billingFrequencyOptions = [
  { id: 'monthly', name: 'projects:projects.billingFrequencies.monthly' },
  { id: 'one_time', name: 'projects:projects.billingFrequencies.oneTime' },
];

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
      'expectedEffort' | 'monthlyEffort' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => void | Promise<void>;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onDeleteTask: (id: string) => void | Promise<void>;
  onViewOrder?: (orderId: string) => void;
}

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
  const { t, i18n } = useTranslation(['projects', 'common']);
  const canCreateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'create');
  const canUpdateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'update');
  const canDeleteTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'delete');
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [billingType, setBillingType] = useState<StoredBillingType>('time_and_materials');
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('monthly');
  const [monthlyEffort, setMonthlyEffort] = useState('');
  const [expectedEffort, setExpectedEffort] = useState('');
  const [revenue, setRevenue] = useState('');
  const [notes, setNotes] = useState('');
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [managingTaskId, setManagingTaskId] = useState<string | null>(null);

  const [taskHours, setTaskHours] = useState<Record<string, Record<string, number>> | null>(null);
  const [hoursLoadState, setHoursLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const fetchHoursGenRef = useRef(0);

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const translatedBillingTypeOptions = useMemo(
    () => billingTypeOptions.map((option) => ({ id: option.id, name: t(option.name) })),
    [t],
  );
  const translatedBillingFrequencyOptions = useMemo(
    () => billingFrequencyOptions.map((option) => ({ id: option.id, name: t(option.name) })),
    [t],
  );
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
    if (projectIds.length === 0) {
      setTaskHours({});
      setHoursLoadState('idle');
      return;
    }
    const gen = ++fetchHoursGenRef.current;
    const abortController = new AbortController();
    setTaskHours(null);
    setHoursLoadState('loading');
    (async () => {
      try {
        const map = await tasksApi.getHoursForProjects(projectIds, abortController.signal);
        if (fetchHoursGenRef.current !== gen) return;
        setTaskHours(map);
        setHoursLoadState('idle');
      } catch (e) {
        if (abortController.signal.aborted) return;
        console.error('Failed to load task hours', e);
        if (fetchHoursGenRef.current !== gen) return;
        setTaskHours({});
        setHoursLoadState('error');
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [projectIds]);

  const checkInheritedDisabled = useCallback(
    (task: ProjectTask) => {
      const project = projects.find((p) => p.id === task.projectId);
      const client = clients.find((c) => c.id === project?.clientId);
      return project?.isDisabled || false || client?.isDisabled || false;
    },
    [projects, clients],
  );

  const openAddModal = useCallback(() => {
    if (!canCreateTasks) return;
    setEditingTask(null);
    setName('');
    setProjectId('');
    setDescription('');
    setBillingType('time_and_materials');
    setBillingFrequency('monthly');
    setMonthlyEffort('');
    setExpectedEffort('');
    setRevenue('');
    setNotes('');
    setTempIsDisabled(false);
    setIsModalOpen(true);
  }, [canCreateTasks]);

  const openEditModal = useCallback(
    (task: ProjectTask) => {
      if (!canUpdateTasks) return;
      setEditingTask(task);
      setName(task.name);
      setProjectId(task.projectId);
      setDescription(task.description || '');
      setBillingType(task.billingType ?? 'time_and_materials');
      setBillingFrequency(
        task.billingType === 'time_and_materials'
          ? 'monthly'
          : (task.billingFrequency ?? 'monthly'),
      );
      setMonthlyEffort(task.monthlyEffort !== undefined ? String(task.monthlyEffort) : '');
      setExpectedEffort(task.expectedEffort !== undefined ? String(task.expectedEffort) : '');
      setRevenue(task.revenue !== undefined ? String(task.revenue) : '');
      setNotes(task.notes ?? '');
      setTempIsDisabled(task.isDisabled || false);
      setIsModalOpen(true);
    },
    [canUpdateTasks],
  );

  const confirmDelete = useCallback(() => {
    if (!canDeleteTasks) return;
    setIsDeleteConfirmOpen(true);
  }, [canDeleteTasks]);

  const openAssignments = useCallback(
    (taskId: string) => {
      if (!canUpdateTasks) return;
      setManagingTaskId(taskId);
    },
    [canUpdateTasks],
  );

  // Column definitions for StandardTable
  const columns: Column<ProjectTask>[] = useMemo(
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
            <div className="flex items-center gap-2">
              <div
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project?.color || '#ccc' }}
              ></div>
              <span
                className={`text-sm font-bold ${
                  isProjectDisabled
                    ? 'text-zinc-600 line-through decoration-zinc-300'
                    : 'text-zinc-800'
                }`}
              >
                {project?.name || t('projects.unknown')}
              </span>
            </div>
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
          return <span className="text-xs font-bold text-zinc-600 tabular-nums">{effort}h</span>;
        },
      },
      {
        header: t('projects:projects.expectedEffort'),
        id: 'expectedEffort',
        accessorFn: (task) => task.expectedEffort ?? 0,
        cell: ({ row }) => {
          const effort = row.expectedEffort;
          if (!effort) return <span className="text-xs text-zinc-400">-</span>;
          return <span className="text-xs font-bold text-zinc-600 tabular-nums">{effort}h</span>;
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
              {rev.toLocaleString(undefined, {
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openAssignments(row.id);
                          }}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(row);
                          }}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateTask(row.id, { isDisabled: !isTaskDisabled });
                            }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTask(row);
                          confirmDelete();
                        }}
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
      confirmDelete,
      openAssignments,
      openEditModal,
      currency,
      taskHours,
      hoursLoadState,
      i18n.language,
      formatBillingType,
      formatBillingFrequency,
    ],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (editingTask && !canUpdateTasks) return;
    if (!editingTask && !canCreateTasks) return;
    if (!name || !projectId) return;
    const details = {
      billingType,
      billingFrequency: billingType === 'time_and_materials' ? 'monthly' : billingFrequency,
      monthlyEffort: monthlyEffort ? parseFloat(monthlyEffort) : undefined,
      expectedEffort: expectedEffort ? parseFloat(expectedEffort) : undefined,
      revenue: revenue ? parseFloat(revenue) : undefined,
      notes: notes.trim() || undefined,
    };
    setIsSubmitting(true);
    try {
      if (editingTask) {
        await onUpdateTask(editingTask.id, {
          name,
          projectId,
          description,
          isDisabled: tempIsDisabled,
          ...details,
        });
      } else {
        await onAddTask(name, projectId, undefined, description, details);
      }
      closeModal();
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsDeleteConfirmOpen(false);
    setEditingTask(null);
    setName('');
    setProjectId('');
    setDescription('');
    setBillingType('time_and_materials');
    setBillingFrequency('monthly');
    setMonthlyEffort('');
    setExpectedEffort('');
    setRevenue('');
    setNotes('');
  };

  const requestCloseModal = () => {
    if (isSubmitting || isDeleting) return;
    closeModal();
  };

  const cancelDelete = () => {
    if (isDeleting) return;
    setIsDeleteConfirmOpen(false);
  };

  const handleDelete = async () => {
    if (!canDeleteTasks) return;
    if (isDeleting) return;
    if (!editingTask) return;
    setIsDeleting(true);
    try {
      await onDeleteTask(editingTask.id);
      closeModal();
    } finally {
      setIsDeleting(false);
    }
  };

  const canSubmit = editingTask ? canUpdateTasks : canCreateTasks;

  const closeAssignments = () => {
    setManagingTaskId(null);
  };

  const managingTask = tasks.find((t) => t.id === managingTaskId);

  const projectSelectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
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
        users={users}
        roles={roles}
        loadAssignedUserIds={(signal) => tasksApi.getUsers(managingTaskId as string, signal)}
        saveAssignedUserIds={(ids) => tasksApi.updateUsers(managingTaskId as string, ids)}
        entityLabel={t('common:labels.task')}
        entityName={managingTask?.name || ''}
        disabled={!canUpdateTasks}
      />

      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={requestCloseModal}>
        <ModalContent size="2xl">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
            <ModalHeader>
              <ModalTitle className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                  <i
                    className={`fa-solid ${editingTask ? 'fa-pen-to-square' : 'fa-list-check'}`}
                    aria-hidden="true"
                  ></i>
                </span>
                {editingTask ? t('tasks.editTask') : t('tasks.createNewTask')}
              </ModalTitle>
              <ModalCloseButton onClick={requestCloseModal} disabled={isSubmitting || isDeleting} />
            </ModalHeader>

            <ModalBody className="space-y-6">
              {(() => {
                const project = projects.find((p) => p.id === projectId);
                const orderId = project?.orderId;
                return editingTask && orderId ? (
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                        <i className="fa-solid fa-link" aria-hidden="true"></i>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {t('projects:projects.linkedOrder')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatOrderId(orderId)}
                        </div>
                      </div>
                    </div>
                    {onViewOrder && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => onViewOrder(orderId)}
                        className="px-0"
                      >
                        {t('projects:projects.viewOrder')}
                      </Button>
                    )}
                  </div>
                ) : null;
              })()}

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectControl
                    id="task-project"
                    options={projectSelectOptions}
                    value={projectId}
                    onChange={(val) => {
                      const nextProjectId = val as string;
                      setProjectId(nextProjectId);
                      if (!editingTask) {
                        const project = projects.find((item) => item.id === nextProjectId);
                        const nextBillingType =
                          project?.billingType === 'retainer' ? 'retainer' : 'time_and_materials';
                        setBillingType(nextBillingType);
                        setBillingFrequency(
                          nextBillingType === 'time_and_materials'
                            ? 'monthly'
                            : (project?.billingFrequency ?? 'monthly'),
                        );
                      }
                    }}
                    label={t('tasks.project')}
                    placeholder={t('common:labels.selectOption')}
                    searchable={true}
                    buttonClassName="h-9"
                  />

                  <Field>
                    <FieldLabel htmlFor="task-name">{t('tasks.name')}</FieldLabel>
                    <Input
                      id="task-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('tasks.taskNamePlaceholder')}
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="task-description">{t('tasks.description')}</FieldLabel>
                  <Textarea
                    id="task-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('tasks.taskDescriptionPlaceholder')}
                    rows={3}
                    className="min-h-20 resize-none"
                  />
                </Field>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <SelectControl
                    id="task-billing-type"
                    options={translatedBillingTypeOptions}
                    value={billingType}
                    onChange={(val) => {
                      const nextBillingType = val as StoredBillingType;
                      setBillingType(nextBillingType);
                      if (nextBillingType === 'time_and_materials') setBillingFrequency('monthly');
                    }}
                    label={t('projects:projects.billingType')}
                    searchable={false}
                    buttonClassName="h-9"
                  />
                  <SelectControl
                    id="task-billing-frequency"
                    options={
                      billingType === 'retainer'
                        ? translatedBillingFrequencyOptions
                        : translatedBillingFrequencyOptions.filter(
                            (option) => option.id === 'monthly',
                          )
                    }
                    value={billingType === 'time_and_materials' ? 'monthly' : billingFrequency}
                    onChange={(val) => setBillingFrequency(val as BillingFrequency)}
                    label={t('projects:projects.billingFrequency')}
                    disabled={billingType === 'time_and_materials'}
                    searchable={false}
                    buttonClassName="h-9"
                  />
                  <Field>
                    <FieldLabel htmlFor="task-monthly-effort">
                      {t('projects:projects.monthlyEffort')}
                    </FieldLabel>
                    <Input
                      id="task-monthly-effort"
                      type="number"
                      min="0"
                      step="1"
                      value={monthlyEffort}
                      onChange={(e) => setMonthlyEffort(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="task-expected-effort">
                      {t('projects:projects.expectedEffort')}
                    </FieldLabel>
                    <Input
                      id="task-expected-effort"
                      type="number"
                      min="0"
                      step="1"
                      value={expectedEffort}
                      onChange={(e) => setExpectedEffort(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="task-revenue">
                      {`${t('projects:projects.taskRevenue')} (${currency})`}
                    </FieldLabel>
                    <Input
                      id="task-revenue"
                      type="number"
                      min="0"
                      step="0.01"
                      value={revenue}
                      onChange={(e) => setRevenue(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="task-notes">{t('projects:projects.taskNotes')}</FieldLabel>
                  <Textarea
                    id="task-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('common:form.placeholderNotes')}
                    rows={3}
                    className="min-h-20 resize-none"
                  />
                </Field>

                {(() => {
                  const project = projects.find((p) => p.id === projectId);
                  const client = clients.find((c) => c.id === project?.clientId);
                  const isProjectDisabled = project?.isDisabled || false;
                  const isClientDisabled = client?.isDisabled || false;
                  const isInheritedDisabled = isProjectDisabled || isClientDisabled;
                  const isCurrentlyDisabled = tempIsDisabled || isInheritedDisabled;

                  return (
                    <Field>
                      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
                        <div>
                          <p
                            className={`text-sm font-medium ${
                              isInheritedDisabled ? 'text-muted-foreground' : 'text-foreground'
                            }`}
                          >
                            {t('tasks.isDisabled')}
                          </p>
                          {isInheritedDisabled && (
                            <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-600">
                              <i
                                className="fa-solid fa-triangle-exclamation"
                                aria-hidden="true"
                              ></i>
                              {isClientDisabled
                                ? t('projects.inheritedFromDisabledClient', {
                                    clientName: client?.name,
                                  })
                                : t('tasks.inheritedFromDisabledProject', {
                                    projectName: project?.name,
                                  })}
                            </p>
                          )}
                        </div>
                        <Toggle
                          checked={isCurrentlyDisabled}
                          onChange={() => {
                            if (!isInheritedDisabled) {
                              setTempIsDisabled(!tempIsDisabled);
                            }
                          }}
                          disabled={isInheritedDisabled}
                        />
                      </div>
                    </Field>
                  );
                })()}
              </div>
            </ModalBody>

            <ModalFooter className="sm:justify-between">
              {editingTask && canDeleteTasks ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={confirmDelete}
                  disabled={isSubmitting || isDeleting}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                  {t('common:buttons.delete')}
                </Button>
              ) : (
                <span />
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestCloseModal}
                  disabled={isSubmitting || isDeleting}
                >
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting
                    ? t('common:buttons.saving')
                    : editingTask
                      ? t('projects.saveChanges')
                      : t('tasks.addTask')}
                </Button>
              </div>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

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
