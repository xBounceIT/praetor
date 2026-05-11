import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { COLORS } from '../../constants';
import { projectsApi, tasksApi } from '../../services/api';
import type {
  BillingFrequency,
  BillingType,
  Client,
  ClientsOrder,
  Project,
  ProjectTask,
  Role,
  StoredBillingType,
  User,
} from '../../types';
import { formatInsertDate } from '../../utils/date';
import { buildPermission, hasPermission, hasScopedActionPermission } from '../../utils/permissions';
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
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import UserAssignmentModal from '../shared/UserAssignmentModal';
import type { RecurringConfig } from './TasksView';

const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

const normalizeHex = (v: string): string => {
  let h = v.trim();
  if (h && !h.startsWith('#')) h = '#' + h;
  const m = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(h);
  if (m) h = `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  return h;
};

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;

type DraftTask = {
  _id: string;
  name: string;
  billingType: StoredBillingType;
  billingFrequency: BillingFrequency;
  monthlyEffort: string;
  expectedEffort: string;
  revenue: string;
  notes: string;
};

export type DraftTaskInput = {
  name: string;
  billingType?: StoredBillingType;
  billingFrequency?: BillingFrequency;
  monthlyEffort?: number;
  expectedEffort?: number;
  revenue?: number;
  notes?: string;
};

const billingTypeOptions = [
  { id: 'time_and_materials', name: 'projects:projects.billingTypes.timeAndMaterials' },
  { id: 'retainer', name: 'projects:projects.billingTypes.retainer' },
];

const billingFrequencyOptions = [
  { id: 'monthly', name: 'projects:projects.billingFrequencies.monthly' },
  { id: 'one_time', name: 'projects:projects.billingFrequencies.oneTime' },
];

const toStoredBillingType = (value: BillingType | undefined): StoredBillingType =>
  value === 'retainer' ? 'retainer' : 'time_and_materials';

export interface ProjectsViewProps {
  projects: Project[];
  clients: Client[];
  orders: ClientsOrder[];
  permissions: string[];
  users: User[];
  roles: Role[];
  currency: string;
  tasks: ProjectTask[];
  onAddProject: (
    name: string,
    orderId: string,
    description?: string,
    tasks?: DraftTaskInput[],
    billingType?: StoredBillingType,
    billingFrequency?: BillingFrequency,
  ) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
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

const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  clients,
  orders,
  permissions,
  users,
  roles,
  currency,
  tasks,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onViewOrder,
}) => {
  const { t } = useTranslation(['projects', 'common', 'form']);
  const canCreateProjects = hasScopedActionPermission(permissions, 'projects.manage', 'create');
  const canUpdateProjects = hasScopedActionPermission(permissions, 'projects.manage', 'update');
  const canDeleteProjects = hasScopedActionPermission(permissions, 'projects.manage', 'delete');
  const canManageAssignments = hasPermission(
    permissions,
    buildPermission('projects.assignments', 'update'),
  );
  const canCreateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'create');
  const canUpdateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'update');
  const canDeleteTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'delete');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const [managingProjectId, setManagingProjectId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [orderId, setOrderId] = useState(''); // used for create
  const [clientId, setClientId] = useState(''); // used for edit
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [billingType, setBillingType] = useState<StoredBillingType>('time_and_materials');
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('monthly');
  const [projectBillingChanged, setProjectBillingChanged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Draft tasks state (create modal only)
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);

  // Task management state (edit modal only)
  const [projectTaskHours, setProjectTaskHours] = useState<Record<string, number>>({});
  const [hoursLoadState, setHoursLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [taskEdits, setTaskEdits] = useState<Record<string, Record<string, string>>>({});
  const [taskToDelete, setTaskToDelete] = useState<ProjectTask | null>(null);
  const [isTaskDeleteConfirmOpen, setIsTaskDeleteConfirmOpen] = useState(false);
  const fetchHoursAbortRef = useRef<AbortController | null>(null);
  const fetchAllHoursGenRef = useRef(0);
  const [allProjectHours, setAllProjectHours] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const [hexInput, setHexInput] = useState('');
  const skipPickerRef = useRef(false);

  const commitHexInput = () => {
    skipPickerRef.current = true;
    const norm = normalizeHex(hexInput);
    if (isValidHex(norm)) {
      setColor(norm);
      setHexInput(norm);
    } else {
      setHexInput(color);
    }
  };

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  useEffect(() => {
    if (projectIds.length === 0) {
      setAllProjectHours({});
      return;
    }
    const gen = ++fetchAllHoursGenRef.current;
    const abortController = new AbortController();
    setAllProjectHours(null);
    (async () => {
      try {
        const map = await tasksApi.getHoursForProjects(projectIds, abortController.signal);
        if (fetchAllHoursGenRef.current !== gen) return;
        setAllProjectHours(map);
      } catch (e) {
        if (abortController.signal.aborted) return;
        console.error('Failed to load project hours', e);
        if (fetchAllHoursGenRef.current !== gen) return;
        setAllProjectHours({});
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [projectIds]);

  const projectMedianProgress = useMemo(() => {
    if (!allProjectHours) return {};
    const tasksByProject = new Map<string, ProjectTask[]>();
    for (const t of tasks) {
      const arr = tasksByProject.get(t.projectId);
      if (arr) arr.push(t);
      else tasksByProject.set(t.projectId, [t]);
    }
    const map: Record<string, number | null> = {};
    for (const project of projects) {
      const projectTasks = tasksByProject.get(project.id);
      const hours = allProjectHours[project.id];
      if (!hours || !projectTasks || projectTasks.length === 0) {
        map[project.id] = null;
        continue;
      }
      const progressValues = projectTasks
        .filter((t) => (t.expectedEffort ?? 0) > 0)
        .map((t) => {
          const logged = hours[t.name] ?? 0;
          const effort = t.expectedEffort as number;
          return (logged / effort) * 100;
        });
      if (progressValues.length === 0) {
        map[project.id] = null;
        continue;
      }
      progressValues.sort((a, b) => a - b);
      const mid = Math.floor(progressValues.length / 2);
      const median =
        progressValues.length % 2 !== 0
          ? progressValues[mid]
          : (progressValues[mid - 1] + progressValues[mid]) / 2;
      map[project.id] = median;
    }
    return map;
  }, [projects, tasks, allProjectHours]);

  // Modal Handlers
  const openAddModal = () => {
    if (!canCreateProjects) return;
    setEditingProject(null);
    setName('');
    setOrderId('');
    setClientId('');
    setDescription('');
    setColor(COLORS[0]);
    setHexInput(COLORS[0]);
    setTempIsDisabled(false);
    setBillingType('time_and_materials');
    setBillingFrequency('monthly');
    setProjectBillingChanged(false);
    setDraftTasks([]);
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (project: Project) => {
    if (!canUpdateProjects) return;
    setEditingProject(project);
    setName(project.name);
    setClientId(project.clientId);
    setOrderId('');
    setDescription(project.description || '');
    setColor(project.color);
    setHexInput(project.color);
    setTempIsDisabled(project.isDisabled || false);
    const storedBillingType =
      project.billingType === 'retainer' ? 'retainer' : 'time_and_materials';
    setBillingType(storedBillingType);
    setBillingFrequency(
      storedBillingType === 'time_and_materials'
        ? 'monthly'
        : (project.billingFrequency ?? 'monthly'),
    );
    setProjectBillingChanged(false);
    setDraftTasks([]);
    setErrors({});
    setTaskEdits({});
    setIsModalOpen(true);
    // Reuse the bulk-fetched hours for this project when available to avoid a
    // redundant single-project request on every edit-modal open.
    const cachedHours = allProjectHours?.[project.id];
    if (cachedHours) {
      fetchHoursAbortRef.current?.abort();
      fetchHoursAbortRef.current = null;
      setProjectTaskHours(cachedHours);
      setHoursLoadState('idle');
      return;
    }
    setProjectTaskHours({});
    setHoursLoadState('loading');
    fetchHoursAbortRef.current?.abort();
    const ac = new AbortController();
    fetchHoursAbortRef.current = ac;
    tasksApi
      .getHours(project.id, ac.signal)
      .then((h) => {
        if (ac.signal.aborted) return;
        setProjectTaskHours(h);
        setHoursLoadState('idle');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setHoursLoadState('error');
      });
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsDeleteConfirmOpen(false);
    setIsTaskDeleteConfirmOpen(false);
    setEditingProject(null);
    setProjectToDelete(null);
    setTaskToDelete(null);
    setDraftTasks([]);
    setErrors({});
    setTaskEdits({});
    setProjectTaskHours({});
    setHoursLoadState('idle');
    setProjectBillingChanged(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (editingProject && !canUpdateProjects) return;
    if (!editingProject && !canCreateProjects) return;

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.projectNameRequired');

    if (editingProject) {
      if (!clientId) newErrors.clientId = t('projects:projects.clientRequired');
    } else {
      if (!orderId) newErrors.orderId = t('projects:projects.orderRequired');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (editingProject) {
      const updates: Partial<Project> = {
        name,
        clientId,
        description,
        color,
        isDisabled: tempIsDisabled,
      };
      if (displayProjectBillingType !== 'mixed' || projectBillingChanged) {
        updates.billingType = billingType;
        updates.billingFrequency =
          billingType === 'time_and_materials' ? 'monthly' : billingFrequency;
      }
      onUpdateProject(editingProject.id, updates);
    } else {
      const taskInputs: DraftTaskInput[] = draftTasks
        .filter((t) => t.name.trim())
        .map((t) => ({
          name: t.name.trim(),
          billingType: t.billingType,
          billingFrequency: t.billingType === 'time_and_materials' ? 'monthly' : t.billingFrequency,
          monthlyEffort: t.monthlyEffort ? parseFloat(t.monthlyEffort) : undefined,
          expectedEffort: t.expectedEffort ? parseFloat(t.expectedEffort) : undefined,
          revenue: t.revenue ? parseFloat(t.revenue) : undefined,
          notes: t.notes.trim() || undefined,
        }));
      onAddProject(
        name,
        orderId,
        description,
        taskInputs.length > 0 ? taskInputs : undefined,
        billingType,
        billingType === 'time_and_materials' ? 'monthly' : billingFrequency,
      );
    }
    closeModal();
  };

  const promptDelete = (project: Project) => {
    setProjectToDelete(project);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (!canDeleteProjects) return;
    if (projectToDelete) {
      onDeleteProject(projectToDelete.id);
      closeModal();
    }
  };

  const openAssignments = (projectId: string) => {
    if (!canManageAssignments) return;
    setManagingProjectId(projectId);
  };

  const closeAssignments = () => {
    setManagingProjectId(null);
  };

  // Draft task helpers
  const addDraftTask = () => {
    setDraftTasks((prev) => [
      ...prev,
      {
        _id: String(Date.now() + Math.random()),
        name: '',
        billingType,
        billingFrequency: billingType === 'time_and_materials' ? 'monthly' : billingFrequency,
        monthlyEffort: '',
        expectedEffort: '',
        revenue: '',
        notes: '',
      },
    ]);
  };

  const updateDraftTask = (id: string, field: keyof Omit<DraftTask, '_id'>, value: string) => {
    setDraftTasks((prev) =>
      prev.map((t) => {
        if (t._id !== id) return t;
        if (field === 'billingType') {
          const nextBillingType = value as StoredBillingType;
          return {
            ...t,
            billingType: nextBillingType,
            billingFrequency:
              nextBillingType === 'time_and_materials' ? 'monthly' : t.billingFrequency,
          };
        }
        return { ...t, [field]: value };
      }),
    );
  };

  const removeDraftTask = (id: string) => {
    setDraftTasks((prev) => prev.filter((t) => t._id !== id));
  };

  // Existing task inline-edit helpers
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

  const handleAddExistingTask = async () => {
    if (!editingProject || !canCreateTasks) return;
    await onAddTask('New Task', editingProject.id);
  };

  const promptDeleteTask = (task: ProjectTask) => {
    setTaskToDelete(task);
    setIsTaskDeleteConfirmOpen(true);
  };

  const handleDeleteTask = () => {
    if (!canDeleteTasks || !taskToDelete) return;
    onDeleteTask(taskToDelete.id);
    setIsTaskDeleteConfirmOpen(false);
    setTaskToDelete(null);
  };

  const canSubmit = editingProject ? canUpdateProjects : canCreateProjects;

  const editingProjectTasks = useMemo(
    () => (editingProject ? tasks.filter((t) => t.projectId === editingProject.id) : []),
    [tasks, editingProject],
  );
  const getDerivedProjectBillingType = (project: Project): BillingType => {
    if (project.billingType === 'mixed') return 'mixed';
    const storedProjectBillingType = toStoredBillingType(project.billingType);
    const taskBillingTypes = new Set(
      tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => task.billingType ?? 'time_and_materials'),
    );
    if (taskBillingTypes.size === 0) return storedProjectBillingType;
    if (taskBillingTypes.size > 1) return 'mixed';
    return taskBillingTypes.has(storedProjectBillingType) ? storedProjectBillingType : 'mixed';
  };
  const displayProjectBillingType: BillingType = editingProject
    ? getDerivedProjectBillingType(editingProject)
    : billingType;

  const translatedBillingTypeOptions = billingTypeOptions.map((option) => ({
    id: option.id,
    name: t(option.name),
  }));
  const projectBillingTypeOptions =
    displayProjectBillingType === 'mixed'
      ? [
          ...translatedBillingTypeOptions,
          { id: 'mixed', name: t('projects:projects.billingTypes.mixed') },
        ]
      : translatedBillingTypeOptions;
  const translatedBillingFrequencyOptions = billingFrequencyOptions.map((option) => ({
    id: option.id,
    name: t(option.name),
  }));
  const formatBillingType = (value: Project['billingType'] | ProjectTask['billingType']) =>
    value === 'mixed'
      ? t('projects:projects.billingTypes.mixed')
      : (translatedBillingTypeOptions.find((option) => option.id === value)?.name ?? '-');
  const formatBillingFrequency = (value: BillingFrequency | undefined) =>
    translatedBillingFrequencyOptions.find((option) => option.id === value)?.name ?? '-';

  const existingTaskColumns: Column<ProjectTask>[] = [
    {
      header: t('projects:projects.taskName'),
      id: 'name',
      accessorKey: 'name',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          value={getTaskFieldValue(row.id, 'name', row.name)}
          disabled={!canUpdateTasks}
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
          value={row.billingType ?? 'time_and_materials'}
          onChange={(val) => {
            const nextBillingType = val as StoredBillingType;
            onUpdateTask(row.id, {
              billingType: nextBillingType,
              billingFrequency:
                nextBillingType === 'time_and_materials' ? 'monthly' : row.billingFrequency,
            });
          }}
          disabled={!canUpdateTasks}
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
          options={
            row.billingType === 'retainer'
              ? translatedBillingFrequencyOptions
              : translatedBillingFrequencyOptions.filter((option) => option.id === 'monthly')
          }
          value={
            row.billingType === 'time_and_materials'
              ? 'monthly'
              : (row.billingFrequency ?? 'monthly')
          }
          onChange={(val) => onUpdateTask(row.id, { billingFrequency: val as BillingFrequency })}
          disabled={!canUpdateTasks || row.billingType === 'time_and_materials'}
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
          disabled={!canUpdateTasks}
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
      header: t('projects:projects.expectedEffort'),
      id: 'expectedEffort',
      accessorKey: 'expectedEffort',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="1"
          disabled={!canUpdateTasks}
          value={getTaskFieldValue(row.id, 'expectedEffort', String(row.expectedEffort ?? ''))}
          placeholder="0"
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault();
          }}
          onChange={(e) => setTaskFieldValue(row.id, 'expectedEffort', e.target.value)}
          onBlur={() => commitTaskField(row, 'expectedEffort', (v) => (v ? parseFloat(v) : 0))}
          className="h-8 min-w-[80px] text-xs"
        />
      ),
    },
    {
      header: `${t('projects:projects.taskRevenue')} (${currency})`,
      id: 'revenue',
      accessorKey: 'revenue',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="0.01"
          disabled={!canUpdateTasks}
          value={getTaskFieldValue(row.id, 'revenue', String(row.revenue ?? ''))}
          placeholder="0.00"
          onChange={(e) => setTaskFieldValue(row.id, 'revenue', e.target.value)}
          onBlur={() => commitTaskField(row, 'revenue', (v) => (v ? parseFloat(v) : 0))}
          className="h-8 min-w-[80px] text-xs"
        />
      ),
    },
    {
      header: t('projects:projects.taskNotes'),
      id: 'notes',
      accessorKey: 'notes',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          disabled={!canUpdateTasks}
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
        if (hoursLoadState === 'loading')
          return <span className="text-xs text-muted-foreground">...</span>;
        if (hoursLoadState === 'error') return <span className="text-xs text-destructive">-</span>;
        const logged = projectTaskHours[row.name] ?? 0;
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
      cell: ({ row }) => (
        <div className="flex justify-end">
          {canDeleteTasks && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      promptDeleteTask(row);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <i className="fa-solid fa-trash-can text-xs"></i>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
  ];

  const clientOptions = clients.map((c: Client) => ({ id: c.id, name: c.name }));

  const orderOptions = orders
    .filter((o) => o.status === 'confirmed')
    .map((o) => ({
      id: o.id,
      name: `${o.clientName} - ${formatOrderId(o.id)}`,
    }));

  const selectedOrder = orders.find((o) => o.id === orderId);

  const managingProject = projects.find((p) => p.id === managingProjectId);
  const assignableUsers = users.filter(
    (u) => !u.hasTopManagerRole && !u.isAdminOnly && !u.isDisabled,
  );

  const draftTaskColumns: Column<DraftTask>[] = [
    {
      header: t('projects:projects.taskName'),
      id: 'name',
      accessorKey: 'name',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          value={row.name}
          required
          placeholder={t('projects:projects.taskName')}
          onChange={(e) => updateDraftTask(row._id, 'name', e.target.value)}
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
          value={row.billingType}
          onChange={(val) => updateDraftTask(row._id, 'billingType', val as string)}
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
          options={
            row.billingType === 'retainer'
              ? translatedBillingFrequencyOptions
              : translatedBillingFrequencyOptions.filter((option) => option.id === 'monthly')
          }
          value={row.billingType === 'time_and_materials' ? 'monthly' : row.billingFrequency}
          onChange={(val) => updateDraftTask(row._id, 'billingFrequency', val as string)}
          disabled={row.billingType === 'time_and_materials'}
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
          required
          value={row.monthlyEffort}
          placeholder="0"
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault();
          }}
          onChange={(e) => updateDraftTask(row._id, 'monthlyEffort', e.target.value)}
          className="h-8 min-w-[80px] text-xs"
        />
      ),
    },
    {
      header: t('projects:projects.expectedEffort'),
      id: 'expectedEffort',
      accessorKey: 'expectedEffort',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="1"
          required
          value={row.expectedEffort}
          placeholder="0"
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault();
          }}
          onChange={(e) => updateDraftTask(row._id, 'expectedEffort', e.target.value)}
          className="h-8 min-w-[80px] text-xs"
        />
      ),
    },
    {
      header: `${t('projects:projects.taskRevenue')} (${currency})`,
      id: 'revenue',
      accessorKey: 'revenue',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="0.01"
          required
          value={row.revenue}
          placeholder="0.00"
          onChange={(e) => updateDraftTask(row._id, 'revenue', e.target.value)}
          className="h-8 min-w-[80px] text-xs"
        />
      ),
    },
    {
      header: t('projects:projects.taskNotes'),
      id: 'notes',
      accessorKey: 'notes',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          value={row.notes}
          placeholder="-"
          onChange={(e) => updateDraftTask(row._id, 'notes', e.target.value)}
          className="h-8 min-w-[120px] text-xs"
        />
      ),
    },
    {
      header: t('projects:projects.tableHeaders.actions'),
      id: 'actions',
      disableFiltering: true,
      align: 'right',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => removeDraftTask(row._id)}
            className="text-muted-foreground hover:text-destructive"
          >
            <i className="fa-solid fa-trash-can text-xs"></i>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        {() => (
          <ModalContent size="2xl">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i
                      className={`fa-solid ${editingProject ? 'fa-pen-to-square' : 'fa-briefcase'}`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  {editingProject
                    ? t('projects:projects.editProject')
                    : t('projects:projects.createNewProject')}
                </ModalTitle>
                <ModalCloseButton onClick={closeModal} />
              </ModalHeader>

              <ModalBody className="space-y-6">
                {editingProject?.orderId && (
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
                          {formatOrderId(editingProject.orderId)}
                        </div>
                      </div>
                    </div>
                    {onViewOrder && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => onViewOrder(editingProject?.orderId ?? '')}
                        className="px-0"
                      >
                        {t('projects:projects.viewOrder')}
                      </Button>
                    )}
                  </div>
                )}
                <div className="space-y-4">
                  {/* Order selector (create only) / Client selector (edit only) */}
                  {editingProject ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <SelectControl
                          id="project-client"
                          options={clientOptions}
                          value={clientId}
                          onChange={(val) => {
                            setClientId(val as string);
                            if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
                          }}
                          label={t('projects:projects.client')}
                          placeholder={t('projects:projects.selectClient')}
                          searchable={true}
                          buttonClassName="h-9"
                        />
                        <FieldError className="text-xs">{errors.clientId}</FieldError>
                      </div>
                      <Field data-invalid={Boolean(errors.name)}>
                        <FieldLabel htmlFor="project-name">
                          {t('projects:projects.name')}
                        </FieldLabel>
                        <Input
                          id="project-name"
                          type="text"
                          value={name}
                          aria-invalid={Boolean(errors.name)}
                          onChange={(e) => {
                            setName(e.target.value);
                            if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                          }}
                          placeholder={t('projects:projects.projectNamePlaceholder')}
                        />
                        <FieldError className="text-xs">{errors.name}</FieldError>
                      </Field>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <SelectControl
                          id="project-order"
                          options={orderOptions}
                          value={orderId}
                          onChange={(val) => {
                            setOrderId(val as string);
                            if (errors.orderId) setErrors((prev) => ({ ...prev, orderId: '' }));
                          }}
                          label={t('projects:projects.order')}
                          placeholder={t('projects:projects.selectOrder')}
                          searchable={true}
                          buttonClassName="h-9"
                        />
                        <FieldError className="text-xs">{errors.orderId}</FieldError>
                        {selectedOrder && (
                          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                            <i
                              className="fa-solid fa-building text-xs text-muted-foreground"
                              aria-hidden="true"
                            ></i>
                            <span className="text-xs text-muted-foreground">
                              {t('projects:projects.inheritedClientLabel')}:
                            </span>
                            <span className="text-xs font-medium text-foreground">
                              {selectedOrder.clientName}
                            </span>
                          </div>
                        )}
                      </div>
                      <Field data-invalid={Boolean(errors.name)}>
                        <FieldLabel htmlFor="project-name">
                          {t('projects:projects.name')}
                        </FieldLabel>
                        <Input
                          id="project-name"
                          type="text"
                          value={name}
                          aria-invalid={Boolean(errors.name)}
                          onChange={(e) => {
                            setName(e.target.value);
                            if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                          }}
                          placeholder={t('projects:projects.projectNamePlaceholder')}
                        />
                        <FieldError className="text-xs">{errors.name}</FieldError>
                      </Field>
                    </div>
                  )}

                  <Field>
                    <FieldLabel htmlFor="project-description">
                      {t('projects:projects.description')}
                    </FieldLabel>
                    <Textarea
                      id="project-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('projects:projects.descriptionPlaceholder')}
                      rows={3}
                      className="min-h-20 resize-none"
                    />
                  </Field>

                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectControl
                      id="project-billing-type"
                      options={projectBillingTypeOptions}
                      value={displayProjectBillingType}
                      onChange={(val) => {
                        const nextBillingType = val as StoredBillingType;
                        setProjectBillingChanged(true);
                        setBillingType(nextBillingType);
                        if (nextBillingType === 'time_and_materials')
                          setBillingFrequency('monthly');
                      }}
                      label={t('projects:projects.billingType')}
                      disabled={displayProjectBillingType === 'mixed'}
                      searchable={false}
                      buttonClassName="h-9"
                    />
                    <SelectControl
                      id="project-billing-frequency"
                      options={
                        billingType === 'retainer'
                          ? translatedBillingFrequencyOptions
                          : translatedBillingFrequencyOptions.filter(
                              (option) => option.id === 'monthly',
                            )
                      }
                      value={
                        displayProjectBillingType === 'mixed'
                          ? 'monthly'
                          : billingType === 'time_and_materials'
                            ? 'monthly'
                            : billingFrequency
                      }
                      onChange={(val) => {
                        setProjectBillingChanged(true);
                        setBillingFrequency(val as BillingFrequency);
                      }}
                      label={t('projects:projects.billingFrequency')}
                      disabled={
                        displayProjectBillingType === 'mixed' ||
                        billingType === 'time_and_materials'
                      }
                      searchable={false}
                      buttonClassName="h-9"
                    />
                  </div>

                  {/* Tasks section (create only) */}
                  {!editingProject && (
                    <div className="space-y-2">
                      <StandardTable<DraftTask>
                        title={t('projects:projects.projectTasks')}
                        data={draftTasks}
                        columns={draftTaskColumns}
                        defaultRowsPerPage={5}
                        emptyState={
                          <span className="text-xs italic text-muted-foreground">
                            {t('projects:projects.noTasksAdded')}
                          </span>
                        }
                        headerAction={
                          <Button
                            type="button"
                            onClick={addDraftTask}
                            size="sm"
                            className={TABLE_CONTROL_BUTTON_CLASSNAME}
                          >
                            <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                            {t('projects:projects.addTaskRow')}
                          </Button>
                        }
                      />
                    </div>
                  )}

                  {/* Tasks section (edit only) */}
                  {editingProject && (
                    <div className="space-y-2">
                      <StandardTable<ProjectTask>
                        title={t('projects:projects.projectTasks')}
                        data={editingProjectTasks}
                        columns={existingTaskColumns}
                        defaultRowsPerPage={5}
                        emptyState={
                          <span className="text-xs italic text-muted-foreground">
                            {t('projects:projects.noTasksAdded')}
                          </span>
                        }
                        headerAction={
                          canCreateTasks ? (
                            <Button
                              type="button"
                              onClick={handleAddExistingTask}
                              size="sm"
                              className={TABLE_CONTROL_BUTTON_CLASSNAME}
                            >
                              <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                              {t('projects:projects.addTaskRow')}
                            </Button>
                          ) : undefined
                        }
                      />
                    </div>
                  )}

                  <Field>
                    <FieldLabel>{t('projects:projects.color')}</FieldLabel>
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
                      {COLORS.map((c) => (
                        <Tooltip key={c}>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => {
                                  setColor(c);
                                  setHexInput(c);
                                }}
                                className={`rounded-full border-2 p-0 transition-transform active:scale-95 ${color === c ? 'border-background ring-2 ring-ring ring-offset-2 ring-offset-background' : 'border-transparent hover:scale-105'}`}
                                style={{ backgroundColor: c }}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{c}</TooltipContent>
                        </Tooltip>
                      ))}
                      <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
                        <Input
                          type="color"
                          value={color}
                          onFocus={() => {
                            skipPickerRef.current = false;
                          }}
                          onChange={(e) => {
                            if (skipPickerRef.current) return;
                            setColor(e.target.value);
                            setHexInput(e.target.value);
                          }}
                          className="size-8 cursor-pointer rounded-md bg-transparent p-1 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm"
                        />
                        <Input
                          type="text"
                          value={hexInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setHexInput(val);
                            if (isValidHex(val)) {
                              setColor(val);
                            }
                          }}
                          onBlur={commitHexInput}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitHexInput();
                            }
                          }}
                          placeholder="#000000"
                          className="h-8 w-[90px] font-mono text-xs tabular-nums"
                        />
                      </div>
                    </div>
                  </Field>

                  {editingProject && (
                    <Field>
                      {(() => {
                        const client = clients.find((c: Client) => c.id === clientId);
                        const isClientDisabled = client?.isDisabled || false;
                        const isCurrentlyDisabled = tempIsDisabled || isClientDisabled;

                        return (
                          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
                            <div>
                              <p
                                className={`text-sm font-medium ${isClientDisabled ? 'text-muted-foreground' : 'text-foreground'}`}
                              >
                                {t('projects:projects.projectDisabled')}
                              </p>
                              {isClientDisabled && (
                                <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-600">
                                  <i className="fa-solid fa-circle-info" aria-hidden="true"></i>
                                  {t('projects:projects.inheritedFromDisabledClient', {
                                    clientName: client?.name,
                                  })}
                                </p>
                              )}
                            </div>
                            <Toggle
                              checked={isCurrentlyDisabled}
                              onChange={() => {
                                if (!isClientDisabled) {
                                  setTempIsDisabled(!tempIsDisabled);
                                }
                              }}
                              disabled={isClientDisabled}
                            />
                          </div>
                        );
                      })()}
                    </Field>
                  )}
                </div>
              </ModalBody>

              <ModalFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={closeModal}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {editingProject ? t('common:buttons.update') : t('projects:projects.addProject')}
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        )}
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={closeModal}
        onConfirm={handleDelete}
        title={t('projects:projects.deleteProjectTitle', { name: projectToDelete?.name })}
        description={t('projects:projects.deleteConfirm')}
      />

      <DeleteConfirmModal
        isOpen={isTaskDeleteConfirmOpen}
        onClose={() => setIsTaskDeleteConfirmOpen(false)}
        onConfirm={handleDeleteTask}
        title={t('projects:projects.deleteTaskTitle', { name: taskToDelete?.name })}
        description={t('projects:projects.deleteTaskConfirm')}
      />

      {/* User Assignment Modal */}
      <UserAssignmentModal
        isOpen={!!managingProjectId}
        onClose={closeAssignments}
        users={assignableUsers}
        roles={roles}
        loadAssignedUserIds={(signal) => projectsApi.getUsers(managingProjectId as string, signal)}
        saveAssignedUserIds={(ids) => projectsApi.updateUsers(managingProjectId as string, ids)}
        entityLabel={t('common:labels.project')}
        entityName={managingProject?.name || ''}
        disabled={!canManageAssignments}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">{t('projects:projects.title')}</h2>
            <p className="text-zinc-500 text-sm">{t('projects:projects.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {canCreateProjects && (
              <HeaderAddButton onClick={openAddModal}>
                {t('projects:projects.addProject')}
              </HeaderAddButton>
            )}
          </div>
        </div>
      </div>

      <StandardTable<Project>
        title={t('projects:projects.projectsDirectory')}
        defaultRowsPerPage={5}
        data={projects}
        onRowClick={canUpdateProjects ? openEditModal : undefined}
        rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
        columns={
          [
            {
              header: t('projects:projects.tableHeaders.client'),
              id: 'client',
              accessorFn: (row) =>
                clients.find((c) => c.id === row.clientId)?.name || t('projects:projects.unknown'),
              cell: ({ row }) => {
                const client = clients.find((c: Client) => c.id === row.clientId);
                const isClientDisabled = client?.isDisabled || false;
                return client ? (
                  <span
                    className={`text-sm font-bold ${
                      isClientDisabled
                        ? 'text-amber-500'
                        : row.isDisabled
                          ? 'text-zinc-400'
                          : 'text-zinc-700'
                    }`}
                  >
                    {client.name}
                    {isClientDisabled && ` ${t('projects:projects.disabledLabel')}`}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-400 italic">-</span>
                );
              },
            },
            {
              header: t('projects:projects.tableHeaders.insertDate'),
              id: 'createdAt',
              accessorFn: (row) => row.createdAt ?? 0,
              cell: ({ row }) => (
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  {row.createdAt ? formatInsertDate(row.createdAt) : '-'}
                </span>
              ),
            },
            {
              header: t('projects:projects.tableHeaders.projectName'),
              accessorKey: 'name',
              cell: ({ row }) => (
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                  <span
                    className={`text-sm font-bold ${
                      row.isDisabled
                        ? 'text-zinc-600 line-through decoration-zinc-300'
                        : 'text-zinc-800'
                    }`}
                  >
                    {row.name}
                  </span>
                </div>
              ),
            },
            {
              header: t('projects:projects.tableHeaders.description'),
              accessorKey: 'description',
              cell: ({ row }) => (
                <p
                  className={`text-xs max-w-md italic line-clamp-1 ${
                    row.isDisabled ? 'text-zinc-400' : 'text-zinc-500'
                  }`}
                >
                  {row.description || t('projects:projects.noDescriptionProvided')}
                </p>
              ),
            },
            {
              header: t('projects:projects.billingType'),
              id: 'billingType',
              accessorFn: (row) => formatBillingType(getDerivedProjectBillingType(row)),
              cell: ({ row }) => (
                <span className="text-xs font-bold text-zinc-600">
                  {formatBillingType(getDerivedProjectBillingType(row))}
                </span>
              ),
            },
            {
              header: t('projects:projects.billingFrequency'),
              id: 'billingFrequency',
              accessorFn: (row) => formatBillingFrequency(row.billingFrequency),
              cell: ({ row }) => (
                <span className="text-xs text-zinc-500">
                  {getDerivedProjectBillingType(row) === 'mixed'
                    ? '-'
                    : formatBillingFrequency(row.billingFrequency)}
                </span>
              ),
            },
            {
              header: t('projects:projects.tableHeaders.progress'),
              id: 'progress',
              disableFiltering: true,
              disableSorting: true,
              cell: ({ row }) => {
                if (allProjectHours === null) {
                  return (
                    <span className="text-zinc-400 text-xs">
                      <i className="fa-solid fa-spinner fa-spin"></i>
                    </span>
                  );
                }
                const median = projectMedianProgress[row.id];
                if (median === null) return <span className="text-zinc-400 text-xs">-</span>;
                const pct = Math.round(median);
                const overBudget = median > 100;
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
              header: t('projects:projects.tableHeaders.status'),
              id: 'status',
              accessorFn: (row) => {
                const client = clients.find((c: Client) => c.id === row.clientId);
                if (row.isDisabled) return t('projects:projects.statusDisabled');
                if (client?.isDisabled) return t('projects:projects.statusInheritedDisable');
                return t('projects:projects.statusActive');
              },
              cell: ({ row }) => {
                const client = clients.find((c: Client) => c.id === row.clientId);
                const isClientDisabled = client?.isDisabled || false;
                if (row.isDisabled) {
                  return (
                    <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />
                  );
                }
                if (isClientDisabled) {
                  return (
                    <StatusBadge
                      type="inherited"
                      label={t('projects:projects.statusInheritedDisable')}
                    />
                  );
                }
                return <StatusBadge type="active" label={t('projects:projects.statusActive')} />;
              },
            },
            {
              header: t('projects:projects.tableHeaders.actions'),
              id: 'actions',
              align: 'right',
              disableSorting: true,
              disableFiltering: true,
              cell: ({ row }) => {
                if (!canUpdateProjects && !canDeleteProjects && !canManageAssignments) return null;
                return (
                  <div className="flex items-center justify-end gap-2">
                    {canManageAssignments && (
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
                        <TooltipContent>{t('projects:projects.manageMembers')}</TooltipContent>
                      </Tooltip>
                    )}
                    {canUpdateProjects && (
                      <>
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
                          <TooltipContent>{t('projects:projects.editProject')}</TooltipContent>
                        </Tooltip>
                        {row.isDisabled ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUpdateProject(row.id, { isDisabled: false });
                                  }}
                                  className="p-2 text-praetor hover:bg-zinc-100 rounded-lg transition-colors"
                                >
                                  <i className="fa-solid fa-rotate-left"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('projects:projects.enableProject')}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUpdateProject(row.id, { isDisabled: true });
                                  }}
                                  className="p-2 text-amber-700 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                >
                                  <i className="fa-solid fa-ban"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('projects:projects.disableProject')}</TooltipContent>
                          </Tooltip>
                        )}
                      </>
                    )}
                    {canDeleteProjects && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                promptDelete(row);
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
          ] as Column<Project>[]
        }
      />
    </div>
  );
};

export default ProjectsView;
