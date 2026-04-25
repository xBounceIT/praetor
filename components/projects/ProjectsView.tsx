import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../constants';
import { projectsApi, tasksApi } from '../../services/api';
import type { Client, ClientsOrder, Project, ProjectTask, Role, User } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Toggle from '../shared/Toggle';
import Tooltip from '../shared/Tooltip';
import UserAssignmentModal from '../shared/UserAssignmentModal';
import type { RecurringConfig } from './TasksView';

const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

type DraftTask = {
  _id: string;
  name: string;
  expectedEffort: string;
  revenue: string;
  notes: string;
};

export type DraftTaskInput = {
  name: string;
  expectedEffort?: number;
  revenue?: number;
  notes?: string;
};

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
  ) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
  onAddTask: (
    name: string,
    projectId: string,
    recurringConfig?: RecurringConfig,
    description?: string,
  ) => void | Promise<void>;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onDeleteTask: (id: string) => void | Promise<void>;
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
}) => {
  const { t } = useTranslation(['projects', 'common', 'form']);
  const canCreateProjects = hasPermission(
    permissions,
    buildPermission('projects.manage', 'create'),
  );
  const canUpdateProjects = hasPermission(
    permissions,
    buildPermission('projects.manage', 'update'),
  );
  const canDeleteProjects = hasPermission(
    permissions,
    buildPermission('projects.manage', 'delete'),
  );
  const canManageAssignments = hasPermission(
    permissions,
    buildPermission('projects.assignments', 'update'),
  );
  const canCreateTasks = hasPermission(permissions, buildPermission('projects.tasks', 'create'));
  const canUpdateTasks = hasPermission(permissions, buildPermission('projects.tasks', 'update'));
  const canDeleteTasks = hasPermission(permissions, buildPermission('projects.tasks', 'delete'));

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

  const commitHexInput = () => {
    if (isValidHex(hexInput)) {
      setColor(hexInput);
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
    setDraftTasks([]);
    setErrors({});
    setTaskEdits({});
    setProjectTaskHours({});
    setHoursLoadState('loading');
    setIsModalOpen(true);
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
      onUpdateProject(editingProject.id, {
        name,
        clientId,
        description,
        color,
        isDisabled: tempIsDisabled,
      });
    } else {
      const taskInputs: DraftTaskInput[] = draftTasks
        .filter((t) => t.name.trim())
        .map((t) => ({
          name: t.name.trim(),
          expectedEffort: t.expectedEffort ? parseFloat(t.expectedEffort) : undefined,
          revenue: t.revenue ? parseFloat(t.revenue) : undefined,
          notes: t.notes.trim() || undefined,
        }));
      onAddProject(name, orderId, description, taskInputs.length > 0 ? taskInputs : undefined);
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
        expectedEffort: '',
        revenue: '',
        notes: '',
      },
    ]);
  };

  const updateDraftTask = (id: string, field: keyof Omit<DraftTask, '_id'>, value: string) => {
    setDraftTasks((prev) => prev.map((t) => (t._id === id ? { ...t, [field]: value } : t)));
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

  const existingTaskColumns: Column<ProjectTask>[] = [
    {
      header: t('projects:projects.taskName'),
      id: 'name',
      accessorKey: 'name',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
          value={getTaskFieldValue(row.id, 'name', row.name)}
          disabled={!canUpdateTasks}
          placeholder={t('projects:projects.taskName')}
          onChange={(e) => setTaskFieldValue(row.id, 'name', e.target.value)}
          onBlur={() => commitTaskField(row, 'name', (v) => v.trim() || row.name)}
          className="w-full min-w-[120px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none disabled:bg-slate-50 disabled:text-slate-400"
        />
      ),
    },
    {
      header: t('projects:projects.expectedEffort'),
      id: 'expectedEffort',
      accessorKey: 'expectedEffort',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
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
          className="w-full min-w-[80px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none disabled:bg-slate-50 disabled:text-slate-400"
        />
      ),
    },
    {
      header: `${t('projects:projects.taskRevenue')} (${currency})`,
      id: 'revenue',
      accessorKey: 'revenue',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
          type="number"
          min="0"
          step="0.01"
          disabled={!canUpdateTasks}
          value={getTaskFieldValue(row.id, 'revenue', String(row.revenue ?? ''))}
          placeholder="0.00"
          onChange={(e) => setTaskFieldValue(row.id, 'revenue', e.target.value)}
          onBlur={() => commitTaskField(row, 'revenue', (v) => (v ? parseFloat(v) : 0))}
          className="w-full min-w-[80px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none disabled:bg-slate-50 disabled:text-slate-400"
        />
      ),
    },
    {
      header: t('projects:projects.taskNotes'),
      id: 'notes',
      accessorKey: 'notes',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
          disabled={!canUpdateTasks}
          value={getTaskFieldValue(row.id, 'notes', row.notes ?? '')}
          placeholder="—"
          onChange={(e) => setTaskFieldValue(row.id, 'notes', e.target.value)}
          onBlur={() => commitTaskField(row, 'notes', (v) => v.trim())}
          className="w-full min-w-[120px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none disabled:bg-slate-50 disabled:text-slate-400"
        />
      ),
    },
    {
      header: t('projects:projects.progress'),
      id: 'progress',
      disableFiltering: true,
      cell: ({ row }) => {
        if (hoursLoadState === 'loading') return <span className="text-slate-400 text-xs">…</span>;
        if (hoursLoadState === 'error') return <span className="text-red-500 text-xs">—</span>;
        const logged = projectTaskHours[row.name] ?? 0;
        const expected = row.expectedEffort ?? 0;
        const pct = expected > 0 ? Math.round((logged / expected) * 100) : 0;
        const overBudget = expected > 0 && logged > expected;
        return (
          <span
            className={`text-xs font-bold tabular-nums ${overBudget ? 'text-red-600' : 'text-slate-600'}`}
          >
            {expected > 0 ? `${pct}%` : '—'}
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
            <Tooltip label={t('common:buttons.delete')}>
              {() => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    promptDeleteTask(row);
                  }}
                  className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <i className="fa-solid fa-trash-can text-xs"></i>
                </button>
              )}
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
      name: `${o.clientName} — #${o.id.replace('co-', '')}`,
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
        <input
          value={row.name}
          required
          placeholder={t('projects:projects.taskName')}
          onChange={(e) => updateDraftTask(row._id, 'name', e.target.value)}
          className="w-full min-w-[120px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none"
        />
      ),
    },
    {
      header: t('projects:projects.expectedEffort'),
      id: 'expectedEffort',
      accessorKey: 'expectedEffort',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
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
          className="w-full min-w-[80px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none"
        />
      ),
    },
    {
      header: `${t('projects:projects.taskRevenue')} (${currency})`,
      id: 'revenue',
      accessorKey: 'revenue',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
          type="number"
          min="0"
          step="0.01"
          required
          value={row.revenue}
          placeholder="0.00"
          onChange={(e) => updateDraftTask(row._id, 'revenue', e.target.value)}
          className="w-full min-w-[80px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none"
        />
      ),
    },
    {
      header: t('projects:projects.taskNotes'),
      id: 'notes',
      accessorKey: 'notes',
      disableFiltering: true,
      cell: ({ row }) => (
        <input
          value={row.notes}
          placeholder="—"
          onChange={(e) => updateDraftTask(row._id, 'notes', e.target.value)}
          className="w-full min-w-[120px] text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none"
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
          <button
            type="button"
            onClick={() => removeDraftTask(row._id)}
            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
          >
            <i className="fa-solid fa-trash-can text-xs"></i>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl animate-in zoom-in duration-300 flex flex-col max-h-[90vh] overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i
                  className={`fa-solid ${editingProject ? 'fa-pen-to-square' : 'fa-briefcase'}`}
                ></i>
              </div>
              {editingProject
                ? t('projects:projects.editProject')
                : t('projects:projects.createNewProject')}
            </h3>
            <button
              onClick={closeModal}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
            <div className="space-y-4">
              {/* Order selector (create only) / Client selector (edit only) */}
              {editingProject ? (
                <div className="flex gap-4">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('projects:projects.client')}
                    </label>
                    <CustomSelect
                      options={clientOptions}
                      value={clientId}
                      onChange={(val) => {
                        setClientId(val as string);
                        if (errors.clientId) setErrors({ ...errors, clientId: '' });
                      }}
                      placeholder={t('projects:projects.selectClient')}
                      searchable={true}
                      className={errors.clientId ? 'border-red-300' : ''}
                      buttonClassName={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.clientId ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                    />
                    {errors.clientId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('projects:projects.name')}
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder={t('projects:projects.projectNamePlaceholder')}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('projects:projects.order')}
                    </label>
                    <CustomSelect
                      options={orderOptions}
                      value={orderId}
                      onChange={(val) => {
                        setOrderId(val as string);
                        if (errors.orderId) setErrors({ ...errors, orderId: '' });
                      }}
                      placeholder={t('projects:projects.selectOrder')}
                      searchable={true}
                      className={errors.orderId ? 'border-red-300' : ''}
                      buttonClassName={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.orderId ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                    />
                    {errors.orderId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.orderId}</p>
                    )}
                    {selectedOrder && (
                      <div className="flex items-center gap-2 mt-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                        <i className="fa-solid fa-building text-slate-400 text-xs"></i>
                        <span className="text-xs text-slate-500">
                          {t('projects:projects.inheritedClientLabel')}:
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          {selectedOrder.clientName}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('projects:projects.name')}
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder={t('projects:projects.projectNamePlaceholder')}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('projects:projects.description')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('projects:projects.descriptionPlaceholder')}
                  rows={3}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
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
                      <span className="text-slate-400 text-xs italic">
                        {t('projects:projects.noTasksAdded')}
                      </span>
                    }
                    headerAction={
                      <button
                        type="button"
                        onClick={addDraftTask}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-praetor text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-colors"
                      >
                        <i className="fa-solid fa-plus text-[10px]"></i>
                        {t('projects:projects.addTaskRow')}
                      </button>
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
                      <span className="text-slate-400 text-xs italic">
                        {t('projects:projects.noTasksAdded')}
                      </span>
                    }
                    headerAction={
                      canCreateTasks ? (
                        <button
                          type="button"
                          onClick={handleAddExistingTask}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-praetor text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-colors"
                        >
                          <i className="fa-solid fa-plus text-[10px]"></i>
                          {t('projects:projects.addTaskRow')}
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('projects:projects.color')}
                </label>
                <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  {COLORS.map((c) => (
                    <Tooltip key={c} label={c}>
                      {() => (
                        <button
                          type="button"
                          onClick={() => {
                            setColor(c);
                            setHexInput(c);
                          }}
                          className={`w-8 h-8 rounded-full border-2 transition-all transform active:scale-90 ${color === c ? 'border-praetor scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
                          style={{ backgroundColor: c }}
                        />
                      )}
                    </Tooltip>
                  ))}
                  <div className="flex items-center gap-2 ml-1 pl-3 border-l border-slate-300">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => {
                        setColor(e.target.value);
                        setHexInput(e.target.value);
                      }}
                      className="w-8 h-8 rounded-lg cursor-pointer border-2 border-slate-200 p-0.5 bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-none"
                    />
                    <input
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
                      className="w-[90px] text-xs px-2 py-1.5 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none font-mono tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {editingProject && (
                <div className="space-y-1.5">
                  {(() => {
                    const client = clients.find((c: Client) => c.id === clientId);
                    const isClientDisabled = client?.isDisabled || false;
                    const isCurrentlyDisabled = tempIsDisabled || isClientDisabled;

                    return (
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div>
                          <p
                            className={`text-sm font-bold ${isClientDisabled ? 'text-slate-400' : 'text-slate-700'}`}
                          >
                            {t('projects:projects.projectDisabled')}
                          </p>
                          {isClientDisabled && (
                            <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 mt-1">
                              <i className="fa-solid fa-circle-info"></i>
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
                          color="red"
                          disabled={isClientDisabled}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-slate-100 gap-4">
              <button
                type="button"
                onClick={closeModal}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className={`px-8 py-2.5 text-white text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
                  canSubmit
                    ? 'bg-praetor shadow-slate-200 hover:bg-slate-700'
                    : 'bg-slate-300 shadow-none cursor-not-allowed'
                }`}
              >
                {editingProject ? t('common:buttons.update') : t('projects:projects.addProject')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={closeModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('common:messages.deleteConfirmNamed', { name: projectToDelete?.name })}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('common:messages.deleteConfirmNamed', { name: projectToDelete?.name })}
                {t('projects:projects.deleteConfirm')}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={closeModal}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Task Delete Confirmation Modal */}
      <Modal isOpen={isTaskDeleteConfirmOpen} onClose={() => setIsTaskDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('common:messages.deleteConfirmNamed', { name: taskToDelete?.name })}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('projects:projects.deleteTaskConfirm')}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsTaskDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDeleteTask}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

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
            <h2 className="text-2xl font-black text-slate-800">{t('projects:projects.title')}</h2>
            <p className="text-slate-500 text-sm">{t('projects:projects.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {canCreateProjects && (
              <button
                onClick={openAddModal}
                className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> {t('projects:projects.addProject')}
              </button>
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
                return (
                  <span
                    className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${
                      isClientDisabled
                        ? 'text-amber-600 bg-amber-50 border-amber-100'
                        : row.isDisabled
                          ? 'text-slate-400'
                          : 'text-praetor'
                    }`}
                  >
                    {client?.name || t('projects:projects.unknown')}
                    {isClientDisabled && (
                      <span className="ml-1 text-[8px]">
                        {t('projects:projects.disabledLabel')}
                      </span>
                    )}
                  </span>
                );
              },
            },
            {
              header: t('projects:projects.tableHeaders.projectName'),
              accessorKey: 'name',
              cell: ({ row }) => (
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  <span
                    className={`text-sm font-bold ${
                      row.isDisabled
                        ? 'text-slate-600 line-through decoration-slate-300'
                        : 'text-slate-800'
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
                    row.isDisabled ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {row.description || t('projects:projects.noDescriptionProvided')}
                </p>
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
                    <span className="text-slate-400 text-xs">
                      <i className="fa-solid fa-spinner fa-spin"></i>
                    </span>
                  );
                }
                const median = projectMedianProgress[row.id];
                if (median === null) return <span className="text-slate-400 text-xs">—</span>;
                const pct = Math.round(median);
                const overBudget = median > 100;
                return (
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs font-bold tabular-nums ${overBudget ? 'text-red-600' : 'text-slate-600'}`}
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
                      <Tooltip label={t('projects:projects.manageMembers')}>
                        {() => (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssignments(row.id);
                            }}
                            className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                          >
                            <i className="fa-solid fa-users"></i>
                          </button>
                        )}
                      </Tooltip>
                    )}
                    {canUpdateProjects && (
                      <>
                        <Tooltip label={t('projects:projects.editProject')}>
                          {() => (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(row);
                              }}
                              className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                            >
                              <i className="fa-solid fa-pen-to-square"></i>
                            </button>
                          )}
                        </Tooltip>
                        {row.isDisabled ? (
                          <Tooltip label={t('projects:projects.enableProject')}>
                            {() => (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateProject(row.id, { isDisabled: false });
                                }}
                                className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <i className="fa-solid fa-rotate-left"></i>
                              </button>
                            )}
                          </Tooltip>
                        ) : (
                          <Tooltip label={t('projects:projects.disableProject')}>
                            {() => (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateProject(row.id, { isDisabled: true });
                                }}
                                className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                              >
                                <i className="fa-solid fa-ban"></i>
                              </button>
                            )}
                          </Tooltip>
                        )}
                      </>
                    )}
                    {canDeleteProjects && (
                      <Tooltip label={t('common:buttons.delete')}>
                        {() => (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              promptDelete(row);
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        )}
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
