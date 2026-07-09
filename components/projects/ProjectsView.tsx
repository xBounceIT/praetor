import { Folder, ListChecks } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  RequiredMark,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBillingFrequencyOptions, useBillingTypeOptions } from '@/hooks/useBillingOptions';
import {
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  toStoredBillingType,
} from '@/utils/billing';
import { projectsApi, tasksApi } from '../../services/api';
import type {
  BillingFrequency,
  BillingType,
  Client,
  ClientOffer,
  ClientsOrder,
  Project,
  ProjectStatus,
  ProjectTask,
  ProjectTipo,
  Role,
  StoredBillingType,
  User,
} from '../../types';
import { DEFAULT_PROJECT_STATUS, LEGACY_PROJECT_STATUS } from '../../types';
import { formatDateOnlyForLocale, formatInsertDate } from '../../utils/date';
import { buildPermission, hasPermission, hasScopedActionPermission } from '../../utils/permissions';
import DateField from '../shared/DateField';
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
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import UserAssignmentModal from '../shared/UserAssignmentModal';
import { ProjectStatusInfoTooltip } from './ProjectStatusInfoTooltip';
import { getProjectStatusBadgeType, projectStatusOptions } from './projectStatusUi';
import type { RecurringConfig } from './TaskFormModal';
import TasksView from './TasksView';

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;

type DraftTask = {
  _id: string;
  name: string;
  billingType: StoredBillingType;
  billingFrequency: BillingFrequency;
  monthlyEffort: string;
  duration: string;
  revenue: string;
  notes: string;
};

export type DraftTaskInput = {
  name: string;
  billingType?: StoredBillingType;
  billingFrequency?: BillingFrequency;
  monthlyEffort?: number;
  duration?: number;
  revenue?: number;
  notes?: string;
};

const tipoOptions = [
  { id: 'attivo', name: 'projects:projects.tipoValues.attivo' },
  { id: 'passivo', name: 'projects:projects.tipoValues.passivo' },
];

type RevenueSource = 'activities' | 'manual';
type RevenueLike = {
  revenue?: number | string | null;
  duration?: number | string | null;
  totalRevenue?: number | string | null;
};

const sumActivityRevenue = (tasks: RevenueLike[]): number =>
  tasks.reduce((sum, t) => {
    const totalRevenue =
      t.totalRevenue !== undefined && t.totalRevenue !== null
        ? Number(t.totalRevenue)
        : (Number(t.revenue) || 0) * (t.duration === '' ? 1 : Number(t.duration ?? 1) || 0);
    return sum + (Number.isFinite(totalRevenue) ? totalRevenue : 0);
  }, 0);

const resolveRevenueSource = (activitiesSum: number): RevenueSource => {
  if (activitiesSum > 0) return 'activities';
  return 'manual';
};

const parseDraftNumber = (value: string, fallback = 0) => {
  if (value.trim() === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export type AddProjectFormInput = {
  name: string;
  clientId: string;
  orderId: string;
  offerId?: string | null;
  description?: string;
  draftTasks?: DraftTaskInput[];
  billingType?: StoredBillingType;
  billingFrequency?: BillingFrequency;
  startDate?: string | null;
  endDate?: string | null;
  revenue?: number | null;
  status: ProjectStatus;
  tipo: ProjectTipo;
};

export type ProjectsViewTab = 'commissions' | 'tasks';

export interface ProjectsViewProps {
  projects: Project[];
  clients: Client[];
  orders: ClientsOrder[];
  offers: ClientOffer[];
  permissions: string[];
  users: User[];
  roles: Role[];
  currency: string;
  tasks: ProjectTask[];
  onAddProject: (input: AddProjectFormInput) => Promise<Project | null>;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
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
  onNavigateToProject?: (projectId: string) => void;
  activeTab?: ProjectsViewTab;
  onTabChange?: (tab: ProjectsViewTab) => void;
}

interface ProjectsViewState {
  // Modal state — create only
  isModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  projectToDelete: Project | null;
  managingProjectId: string | null;
  // Form state
  name: string;
  orderId: string;
  clientId: string;
  description: string;
  billingType: StoredBillingType;
  billingFrequency: BillingFrequency;
  offerId: string;
  startDate: string;
  endDate: string;
  revenue: string;
  // '' = no choice yet; the create form requires a deliberate Attivo/Passivo pick (issue #784).
  tipo: ProjectTipo | '';
  status: ProjectStatus;
  errors: Record<string, string>;
  draftTasks: DraftTask[];
}

const INITIAL_PROJECTS_STATE: ProjectsViewState = {
  isModalOpen: false,
  isDeleteConfirmOpen: false,
  projectToDelete: null,
  managingProjectId: null,
  name: '',
  orderId: '',
  clientId: '',
  description: '',
  billingType: DEFAULT_BILLING_TYPE,
  billingFrequency: DEFAULT_BILLING_FREQUENCY,
  offerId: '',
  startDate: '',
  endDate: '',
  revenue: '',
  tipo: '',
  status: DEFAULT_PROJECT_STATUS,
  errors: {},
  draftTasks: [],
};

type ProjectsViewAction =
  | { type: 'setName'; value: string }
  | { type: 'setOrderId'; value: string }
  | { type: 'setClientId'; value: string }
  | { type: 'setDescription'; value: string }
  | { type: 'setBillingType'; value: StoredBillingType }
  | { type: 'setBillingFrequency'; value: BillingFrequency }
  | { type: 'setOfferId'; value: string }
  | { type: 'setStartDate'; value: string }
  | { type: 'setEndDate'; value: string }
  | { type: 'setRevenue'; value: string }
  | { type: 'setTipo'; value: ProjectTipo | '' }
  | { type: 'setStatus'; value: ProjectStatus }
  | { type: 'setErrors'; value: Record<string, string> }
  | { type: 'patchErrors'; value: Record<string, string> }
  | { type: 'setDraftTasks'; value: DraftTask[] }
  | { type: 'openAddModal' }
  | { type: 'closeModal' }
  | { type: 'promptDelete'; project: Project }
  | { type: 'setManagingProjectId'; value: string | null };

const projectsViewReducer = (
  state: ProjectsViewState,
  action: ProjectsViewAction,
): ProjectsViewState => {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.value };
    case 'setOrderId':
      return { ...state, orderId: action.value };
    case 'setClientId':
      return { ...state, clientId: action.value };
    case 'setDescription':
      return { ...state, description: action.value };
    case 'setBillingType':
      return { ...state, billingType: action.value };
    case 'setBillingFrequency':
      return { ...state, billingFrequency: action.value };
    case 'setOfferId':
      return { ...state, offerId: action.value };
    case 'setStartDate':
      return { ...state, startDate: action.value };
    case 'setEndDate':
      return { ...state, endDate: action.value };
    case 'setRevenue':
      return { ...state, revenue: action.value };
    case 'setTipo':
      return { ...state, tipo: action.value };
    case 'setStatus':
      return { ...state, status: action.value };
    case 'setErrors':
      return { ...state, errors: action.value };
    case 'patchErrors':
      return { ...state, errors: { ...state.errors, ...action.value } };
    case 'setDraftTasks':
      return { ...state, draftTasks: action.value };
    case 'openAddModal':
      return {
        ...state,
        name: '',
        orderId: '',
        clientId: '',
        description: '',
        billingType: DEFAULT_BILLING_TYPE,
        billingFrequency: DEFAULT_BILLING_FREQUENCY,
        offerId: '',
        startDate: '',
        endDate: '',
        revenue: '',
        tipo: '',
        status: DEFAULT_PROJECT_STATUS,
        draftTasks: [],
        errors: {},
        isModalOpen: true,
      };
    case 'closeModal':
      return {
        ...state,
        isModalOpen: false,
        isDeleteConfirmOpen: false,
        projectToDelete: null,
        draftTasks: [],
        errors: {},
      };
    case 'promptDelete':
      return { ...state, projectToDelete: action.project, isDeleteConfirmOpen: true };
    case 'setManagingProjectId':
      return { ...state, managingProjectId: action.value };
    default:
      return state;
  }
};

const useProjectsController = ({
  projects,
  clients,
  orders,
  offers,
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
  onNavigateToProject,
  activeTab,
  onTabChange,
}: ProjectsViewProps) => {
  const { t, i18n } = useTranslation(['projects', 'common', 'form']);
  const canViewCommissions = hasScopedActionPermission(permissions, 'projects.manage', 'view');
  const canViewTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'view');
  const canCreateProjects = hasScopedActionPermission(permissions, 'projects.manage', 'create');
  const canUpdateProjects = hasScopedActionPermission(permissions, 'projects.manage', 'update');
  const canDeleteProjects = hasScopedActionPermission(permissions, 'projects.manage', 'delete');
  const canManageAssignments = hasPermission(
    permissions,
    buildPermission('projects.assignments', 'update'),
  );

  const [state, dispatch] = useReducer(projectsViewReducer, INITIAL_PROJECTS_STATE);
  const {
    isModalOpen,
    isDeleteConfirmOpen,
    projectToDelete,
    managingProjectId,
    name,
    orderId,
    clientId,
    description,
    billingType,
    billingFrequency,
    offerId,
    startDate,
    endDate,
    revenue,
    tipo,
    status,
    errors,
    draftTasks,
  } = state;

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const projectIdsKey = useMemo(() => projectIds.join('\u0000'), [projectIds]);
  const fetchAllHoursGenRef = useRef(0);
  const [allProjectHours, setAllProjectHours] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const loadedProjectIdsKeyRef = useRef(projectIdsKey);
  if (loadedProjectIdsKeyRef.current !== projectIdsKey) {
    loadedProjectIdsKeyRef.current = projectIdsKey;
    setAllProjectHours(projectIds.length === 0 ? {} : null);
  }

  const [uncontrolledTab, setUncontrolledTab] = useState<ProjectsViewTab>(
    canViewCommissions ? 'commissions' : 'tasks',
  );
  const canViewTab = (tab: ProjectsViewTab) =>
    tab === 'commissions' ? canViewCommissions : canViewTasks;
  const requestedTab = activeTab ?? uncontrolledTab;
  const selectedTab: ProjectsViewTab = canViewTab(requestedTab)
    ? requestedTab
    : canViewCommissions
      ? 'commissions'
      : 'tasks';
  const shouldLoadProjectHours = selectedTab === 'commissions' && canViewCommissions;

  useEffect(() => {
    if (!shouldLoadProjectHours) return;
    if (!projectIdsKey) return;
    const requestProjectIds = projectIdsKey.split('\u0000');
    const gen = ++fetchAllHoursGenRef.current;
    const abortController = new AbortController();
    (async () => {
      try {
        const map = await tasksApi.getHoursForProjects(requestProjectIds, abortController.signal);
        if (fetchAllHoursGenRef.current === gen) {
          setAllProjectHours(map);
        }
      } catch (e) {
        if (!abortController.signal.aborted) {
          console.error('Failed to load project hours', e);
          if (fetchAllHoursGenRef.current === gen) {
            setAllProjectHours({});
          }
        }
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [projectIdsKey, shouldLoadProjectHours]);

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
      const progressValues = projectTasks.reduce<number[]>((values, task) => {
        const effort = task.expectedEffort ?? 0;
        if (effort <= 0) return values;
        const logged = hours[task.name] ?? 0;
        values.push((logged / effort) * 100);
        return values;
      }, []);
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

  const openAddModal = () => {
    if (!canCreateProjects) return;
    dispatch({ type: 'openAddModal' });
  };

  const closeModal = () => {
    dispatch({ type: 'closeModal' });
  };

  // Reset a currently-bound order/offer if it no longer matches `nextClientId`. The
  // `keep` flag lets the order/offer pickers skip the link they just set themselves.
  const clearStaleClientLinks = (nextClientId: string, keep: 'order' | 'offer' | null) => {
    if (keep !== 'offer' && offerId) {
      const current = offers.find((o) => o.id === offerId);
      if (!current || current.clientId !== nextClientId) {
        dispatch({ type: 'setOfferId', value: '' });
        if (errors.offerId) dispatch({ type: 'patchErrors', value: { offerId: '' } });
      }
    }
    if (keep !== 'order' && orderId) {
      const current = orders.find((o) => o.id === orderId);
      if (!current || current.clientId !== nextClientId) {
        dispatch({ type: 'setOrderId', value: '' });
        if (errors.orderId) dispatch({ type: 'patchErrors', value: { orderId: '' } });
      }
    }
  };

  const applyClientChange = (nextClientId: string) => {
    dispatch({ type: 'setClientId', value: nextClientId });
    if (errors.clientId) dispatch({ type: 'patchErrors', value: { clientId: '' } });
    clearStaleClientLinks(nextClientId, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'setErrors', value: {} });

    if (!canCreateProjects) return;

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.projectNameRequired');
    if (!clientId) newErrors.clientId = t('projects:projects.clientRequired');
    if (!orderId) newErrors.orderId = t('projects:projects.orderRequired');
    if (!startDate) newErrors.startDate = t('projects:projects.startDateRequired');
    if (!endDate) newErrors.endDate = t('projects:projects.endDateRequired');
    if (!tipo) newErrors.tipo = t('projects:projects.tipoRequired');
    if (startDate && endDate && startDate > endDate) {
      newErrors.dateRange = t('projects:projects.dateRangeInvalid');
    }
    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'setErrors', value: newErrors });
      return;
    }

    const taskInputs: DraftTaskInput[] = [];
    for (const task of draftTasks) {
      const taskName = task.name.trim();
      if (!taskName) continue;
      taskInputs.push({
        name: taskName,
        billingType: task.billingType,
        billingFrequency: task.billingFrequency,
        monthlyEffort: task.monthlyEffort ? parseFloat(task.monthlyEffort) : undefined,
        duration: task.duration ? parseFloat(task.duration) : undefined,
        revenue: task.revenue ? parseFloat(task.revenue) : undefined,
        notes: task.notes.trim() || undefined,
      });
    }
    const result = await onAddProject({
      name,
      clientId,
      orderId,
      offerId: offerId || null,
      description,
      draftTasks: taskInputs.length > 0 ? taskInputs : undefined,
      billingType,
      billingFrequency,
      startDate: startDate || null,
      endDate: endDate || null,
      revenue: persistedRevenue,
      // Guaranteed non-empty by the `!tipo` validation guard above.
      tipo: tipo as ProjectTipo,
      status,
    });
    closeModal();
    if (result && onNavigateToProject) {
      onNavigateToProject(result.id);
    }
  };

  const promptDelete = (project: Project) => {
    dispatch({ type: 'promptDelete', project });
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
    dispatch({ type: 'setManagingProjectId', value: projectId });
  };

  const closeAssignments = () => {
    dispatch({ type: 'setManagingProjectId', value: null });
  };

  // Draft task helpers
  const addDraftTask = () => {
    dispatch({
      type: 'setDraftTasks',
      value: [
        ...draftTasks,
        {
          _id: String(Date.now() + Math.random()),
          name: '',
          billingType,
          billingFrequency,
          monthlyEffort: '',
          duration: '1',
          revenue: '',
          notes: '',
        },
      ],
    });
  };

  const updateDraftTask = (id: string, field: keyof Omit<DraftTask, '_id'>, value: string) => {
    dispatch({
      type: 'setDraftTasks',
      value: draftTasks.map((t) => {
        if (t._id !== id) return t;
        return { ...t, [field]: value };
      }),
    });
  };

  const removeDraftTask = (id: string) => {
    dispatch({ type: 'setDraftTasks', value: draftTasks.filter((t) => t._id !== id) });
  };

  const getDerivedProjectBillingType = (project: Project): BillingType => {
    if (project.billingType === 'mixed') return 'mixed';
    const storedProjectBillingType = toStoredBillingType(project.billingType);
    const taskBillingTypes = new Set<StoredBillingType>();
    for (const task of tasks) {
      if (task.projectId === project.id) {
        taskBillingTypes.add(task.billingType ?? DEFAULT_BILLING_TYPE);
      }
    }
    if (taskBillingTypes.size === 0) return storedProjectBillingType;
    if (taskBillingTypes.size > 1) return 'mixed';
    return taskBillingTypes.has(storedProjectBillingType) ? storedProjectBillingType : 'mixed';
  };

  const translatedBillingTypeOptions = useBillingTypeOptions();
  const translatedBillingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingType = (value: Project['billingType'] | ProjectTask['billingType']) =>
    value === 'mixed'
      ? t('projects:projects.billingTypes.mixed')
      : (translatedBillingTypeOptions.find((option) => option.id === value)?.name ?? '-');
  const formatBillingFrequency = (value: BillingFrequency | undefined) =>
    translatedBillingFrequencyOptions.find((option) => option.id === value)?.name ?? '-';

  const translatedTipoOptions = tipoOptions.map((option) => ({
    id: option.id,
    name: t(option.name),
  }));
  const formatTipo = (value: ProjectTipo | undefined) =>
    translatedTipoOptions.find((option) => option.id === value)?.name ?? '-';

  const translatedStatusOptions = projectStatusOptions.map((option) => ({
    id: option.id,
    name: t(option.name),
  }));
  const formatProjectStatus = (value: ProjectStatus | undefined) =>
    translatedStatusOptions.find((option) => option.id === (value ?? LEGACY_PROJECT_STATUS))
      ?.name ?? '-';

  const clientOptions = clients.map((c: Client) => ({ id: c.id, name: c.name }));

  const orderOptions = orders.reduce<Array<{ id: string; name: string }>>((options, order) => {
    if (order.status === 'confirmed') {
      options.push({
        id: order.id,
        name: `${order.clientName} - ${formatOrderId(order.id)}`,
      });
    }
    return options;
  }, []);

  const selectedOrder = orderId ? orders.find((o) => o.id === orderId) : undefined;

  const offerOptions = offers.reduce<Array<{ id: string; name: string }>>(
    (options, offer) => {
      if (offer.status !== 'sent' && offer.status !== 'accepted') return options;
      if (clientId && offer.clientId !== clientId) return options;
      options.push({ id: offer.id, name: `${offer.clientName} - ${offer.id}` });
      return options;
    },
    [{ id: '', name: t('projects:projects.noOfferLinked') }],
  );
  if (offerId && !offerOptions.some((o) => o.id === offerId)) {
    const fallback = offers.find((o) => o.id === offerId);
    if (fallback) {
      offerOptions.unshift({ id: fallback.id, name: `${fallback.clientName} - ${fallback.id}` });
    }
  }

  const activitiesRevenueSum = sumActivityRevenue(draftTasks);
  const revenueSource = resolveRevenueSource(activitiesRevenueSum);
  const revenueBySource: Record<RevenueSource, number> = {
    activities: activitiesRevenueSum,
    manual: revenue ? parseFloat(revenue) : 0,
  };
  // The activity hint explains why the field is read-only; the manual source is
  // omitted because the field label already says what to enter.
  const revenueHintBySource: Partial<Record<RevenueSource, string>> = {
    activities: t('projects:projects.revenueFromActivities'),
  };
  const displayedRevenue = revenueBySource[revenueSource];
  const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;

  const formatDraftNumber = (value: number, minimumFractionDigits = 0) =>
    value.toLocaleString(i18n.language, {
      minimumFractionDigits,
      maximumFractionDigits: 2,
    });

  const managingProject = projects.find((p) => p.id === managingProjectId);
  const assignableUsers = users.filter(
    (u) => !u.hasTopManagerRole && !u.isAdminOnly && !u.isDisabled,
  );
  const handleTabChange = (value: string) => {
    if (value !== 'commissions' && value !== 'tasks') return;
    const nextTab = value as ProjectsViewTab;
    if (!canViewTab(nextTab)) return;
    setUncontrolledTab(nextTab);
    onTabChange?.(nextTab);
  };

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
          options={translatedBillingFrequencyOptions}
          value={row.billingFrequency}
          onChange={(val) => updateDraftTask(row._id, 'billingFrequency', val as string)}
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
      header: t('projects:projects.duration'),
      id: 'duration',
      accessorKey: 'duration',
      disableFiltering: true,
      cell: ({ row }) => (
        <Input
          type="number"
          min="0"
          step="any"
          required
          value={row.duration}
          placeholder="1"
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
          }}
          onChange={(e) => updateDraftTask(row._id, 'duration', e.target.value)}
          className="h-8 min-w-[80px] text-xs"
        />
      ),
    },
    {
      header: t('projects:projects.expectedEffort'),
      id: 'expectedEffort',
      accessorFn: (row) => parseDraftNumber(row.monthlyEffort) * parseDraftNumber(row.duration, 1),
      disableFiltering: true,
      cell: ({ row }) => {
        const totalEffort = parseDraftNumber(row.monthlyEffort) * parseDraftNumber(row.duration, 1);
        return (
          <output className="flex h-8 min-w-[90px] items-center rounded-md border border-input bg-muted/40 px-3 text-xs text-muted-foreground tabular-nums">
            {formatDraftNumber(totalEffort)}h
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
      header: `${t('projects:projects.taskTotalRevenue')} (${currency})`,
      id: 'totalRevenue',
      accessorFn: (row) => parseDraftNumber(row.revenue) * parseDraftNumber(row.duration, 1),
      disableFiltering: true,
      cell: ({ row }) => {
        const totalRevenue = parseDraftNumber(row.revenue) * parseDraftNumber(row.duration, 1);
        return (
          <output className="flex h-8 min-w-[110px] items-center rounded-md border border-input bg-muted/40 px-3 text-xs text-muted-foreground tabular-nums">
            {currency}
            {formatDraftNumber(totalRevenue, 2)}
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeDraftTask(row._id)}
                  aria-label={t('common:buttons.delete')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <i className="fa-solid fa-trash-can text-xs"></i>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
  ];

  const projectColumns: Column<Project>[] = [
    {
      header: t('projects:projects.tableHeaders.client'),
      id: 'client',
      accessorFn: (row) => clientById.get(row.clientId)?.name || t('projects:projects.unknown'),
      cell: ({ row }) => {
        const client = clientById.get(row.clientId);
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
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {row.createdAt ? formatInsertDate(row.createdAt, i18n.language) : '—'}
        </span>
      ),
    },
    {
      header: t('projects:projects.tableHeaders.startDate'),
      accessorKey: 'startDate',
      className: 'whitespace-nowrap',
      filterFormat: (value) =>
        value ? formatDateOnlyForLocale(String(value), i18n.language) : '-',
      cell: ({ row }) => (
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {row.startDate ? formatDateOnlyForLocale(row.startDate, i18n.language) : '-'}
        </span>
      ),
    },
    {
      header: t('projects:projects.tableHeaders.endDate'),
      accessorKey: 'endDate',
      className: 'whitespace-nowrap',
      filterFormat: (value) =>
        value ? formatDateOnlyForLocale(String(value), i18n.language) : '-',
      cell: ({ row }) => (
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {row.endDate ? formatDateOnlyForLocale(row.endDate, i18n.language) : '-'}
        </span>
      ),
    },
    {
      header: t('projects:projects.tableHeaders.projectName'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <span
          className={`text-sm font-bold ${
            row.isDisabled ? 'text-zinc-600 line-through decoration-zinc-300' : 'text-zinc-800'
          }`}
        >
          {row.name}
        </span>
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
      header: t('projects:projects.tipo'),
      id: 'tipo',
      accessorFn: (row) => formatTipo(row.tipo),
      cell: ({ row }) => (
        <span className="text-xs font-bold text-zinc-600">{formatTipo(row.tipo)}</span>
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
      accessorFn: (row) => formatProjectStatus(row.status),
      cell: ({ row }) => {
        const client = clientById.get(row.clientId);
        const isClientDisabled = client?.isDisabled || false;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              type={getProjectStatusBadgeType(row.status)}
              label={formatProjectStatus(row.status)}
            />
            {row.isDisabled && (
              <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />
            )}
            {!row.isDisabled && isClientDisabled && (
              <StatusBadge type="inherited" label={t('projects:projects.statusInheritedDisable')} />
            )}
          </div>
        );
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
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignments(row.id);
                      }}
                      aria-label={t('projects:projects.manageMembers')}
                      className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-users"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('projects:projects.manageMembers')}</TooltipContent>
              </Tooltip>
            )}
            {canUpdateProjects &&
              (row.isDisabled ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject(row.id, { isDisabled: false });
                        }}
                        aria-label={t('projects:projects.enableProject')}
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
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject(row.id, { isDisabled: true });
                        }}
                        aria-label={t('projects:projects.disableProject')}
                        className="p-2 text-amber-700 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-ban"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('projects:projects.disableProject')}</TooltipContent>
                </Tooltip>
              ))}
            {canDeleteProjects && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        promptDelete(row);
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
  ];

  return {
    addDraftTask,
    applyClientChange,
    assignableUsers,
    billingFrequency,
    billingType,
    canCreateProjects,
    canManageAssignments,
    canViewCommissions,
    canViewTasks,
    clearStaleClientLinks,
    clientId,
    clientOptions,
    clients,
    closeAssignments,
    closeModal,
    currency,
    description,
    dispatch,
    displayedRevenue,
    draftTaskColumns,
    draftTasks,
    endDate,
    errors,
    handleDelete,
    handleSubmit,
    handleTabChange,
    isDeleteConfirmOpen,
    isModalOpen,
    managingProject,
    managingProjectId,
    name,
    offerId,
    offerOptions,
    offers,
    onAddTask,
    onDeleteTask,
    onNavigateToProject,
    onUpdateTask,
    onViewOrder,
    openAddModal,
    orderId,
    orderOptions,
    orders,
    permissions,
    projectColumns,
    projectToDelete,
    projects,
    revenue,
    revenueHintBySource,
    revenueSource,
    roles,
    selectedOrder,
    selectedTab,
    startDate,
    status,
    t,
    tasks,
    tipo,
    translatedBillingFrequencyOptions,
    translatedBillingTypeOptions,
    translatedTipoOptions,
    translatedStatusOptions,
    users,
  };
};

type ProjectsController = ReturnType<typeof useProjectsController>;

const ProjectsView: React.FC<ProjectsViewProps> = (props) => {
  const controller = useProjectsController(props);
  return <ProjectsLayout controller={controller} />;
};

const ProjectsLayout: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="space-y-8">
    <CreateProjectModal controller={controller} />
    <ProjectDeleteDialog controller={controller} />
    <ProjectAssignmentDialog controller={controller} />
    <ProjectsTabs controller={controller} />
  </div>
);

const CreateProjectModal: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <Modal isOpen={controller.isModalOpen} onClose={controller.closeModal}>
    {() => (
      <ModalContent size="2xl">
        <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-col">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-briefcase" aria-hidden="true"></i>
              </span>
              {controller.t('projects:projects.createNewProject')}
            </ModalTitle>
            <ModalCloseButton onClick={controller.closeModal} />
          </ModalHeader>
          <ModalBody className="space-y-6">
            <CreateProjectFormFields controller={controller} />
          </ModalBody>
          <ModalFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={controller.closeModal}>
              {controller.t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={!controller.canCreateProjects}>
              {controller.t('projects:projects.addProject')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    )}
  </Modal>
);

const CreateProjectFormFields: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="space-y-4">
    <ProjectClientOrderFields controller={controller} />
    <ProjectDescriptionField controller={controller} />
    <ProjectDateFields controller={controller} />
    <ProjectOfferRevenueFields controller={controller} />
    <ProjectTipoField controller={controller} />
    <ProjectStatusField controller={controller} />
    <ProjectBillingFields controller={controller} />
    <ProjectDraftTasksTable controller={controller} />
  </div>
);

const ProjectClientOrderFields: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="grid gap-4 md:grid-cols-2">
    <div className="space-y-1.5">
      <SelectControl
        id="project-order"
        options={controller.orderOptions}
        value={controller.orderId}
        onChange={(value) => {
          const nextOrderId = value as string;
          controller.dispatch({ type: 'setOrderId', value: nextOrderId });
          if (controller.errors.orderId) {
            controller.dispatch({ type: 'patchErrors', value: { orderId: '' } });
          }
          const nextOrder = controller.orders.find((order) => order.id === nextOrderId);
          if (!nextOrder) return;
          controller.dispatch({ type: 'setClientId', value: nextOrder.clientId });
          if (controller.errors.clientId) {
            controller.dispatch({ type: 'patchErrors', value: { clientId: '' } });
          }
          controller.clearStaleClientLinks(nextOrder.clientId, 'order');
        }}
        label={
          <>
            {controller.t('projects:projects.order')} <RequiredMark />
          </>
        }
        placeholder={controller.t('projects:projects.selectOrder')}
        searchable={true}
        buttonClassName="h-9"
      />
      <FieldError className="text-xs">{controller.errors.orderId}</FieldError>
    </div>
    <div className="space-y-1.5">
      <SelectControl
        id="project-client"
        options={controller.clientOptions}
        value={controller.clientId}
        onChange={(value) => controller.applyClientChange(value as string)}
        label={
          <>
            {controller.t('projects:projects.client')} <RequiredMark />
          </>
        }
        placeholder={controller.t('projects:projects.selectClient')}
        searchable={true}
        disabled={Boolean(controller.selectedOrder)}
        buttonClassName="h-9"
      />
      <FieldError className="text-xs">{controller.errors.clientId}</FieldError>
      {controller.selectedOrder && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <i className="fa-solid fa-link text-xs text-muted-foreground" aria-hidden="true"></i>
          <span className="text-xs text-muted-foreground">
            {controller.t('projects:projects.inheritedClientLabel')}:
          </span>
          <span className="text-xs font-medium text-foreground">
            {controller.selectedOrder.clientName}
          </span>
        </div>
      )}
    </div>
    <Field data-invalid={Boolean(controller.errors.name)} className="md:col-span-2">
      <FieldLabel htmlFor="project-name">
        {controller.t('projects:projects.name')} <RequiredMark />
      </FieldLabel>
      <Input
        id="project-name"
        type="text"
        required
        value={controller.name}
        aria-invalid={Boolean(controller.errors.name)}
        onChange={(event) => {
          controller.dispatch({ type: 'setName', value: event.target.value });
          if (controller.errors.name) {
            controller.dispatch({ type: 'patchErrors', value: { name: '' } });
          }
        }}
        placeholder={controller.t('projects:projects.projectNamePlaceholder')}
      />
      <FieldError className="text-xs">{controller.errors.name}</FieldError>
    </Field>
  </div>
);

const ProjectDescriptionField: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <Field>
    <FieldLabel htmlFor="project-description">
      {controller.t('projects:projects.description')}
    </FieldLabel>
    <Textarea
      id="project-description"
      value={controller.description}
      onChange={(event) =>
        controller.dispatch({ type: 'setDescription', value: event.target.value })
      }
      placeholder={controller.t('projects:projects.descriptionPlaceholder')}
      rows={3}
      className="min-h-20 resize-none"
    />
  </Field>
);

const ProjectDateFields: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <>
    <div className="grid gap-4 md:grid-cols-2">
      <ProjectDateField controller={controller} field="startDate" />
      <ProjectDateField controller={controller} field="endDate" />
    </div>
    {controller.errors.dateRange && (
      <FieldError className="text-xs">{controller.errors.dateRange}</FieldError>
    )}
  </>
);

const ProjectDateField: React.FC<{
  controller: ProjectsController;
  field: 'startDate' | 'endDate';
}> = ({ controller, field }) => {
  const isStart = field === 'startDate';
  const id = isStart ? 'project-start-date' : 'project-end-date';
  const label = controller.t(isStart ? 'projects:projects.startDate' : 'projects:projects.endDate');
  const value = isStart ? controller.startDate : controller.endDate;
  const errorKey = isStart ? 'startDate' : 'endDate';
  const actionType = isStart ? 'setStartDate' : 'setEndDate';

  return (
    <Field data-invalid={Boolean(controller.errors[errorKey] || controller.errors.dateRange)}>
      <FieldLabel htmlFor={id}>
        {label} <RequiredMark />
      </FieldLabel>
      <DateField
        id={id}
        required
        value={value}
        aria-invalid={Boolean(controller.errors[errorKey] || controller.errors.dateRange)}
        onChange={(nextValue) => {
          controller.dispatch({ type: actionType, value: nextValue } as ProjectsViewAction);
          if (controller.errors[errorKey] || controller.errors.dateRange) {
            controller.dispatch({
              type: 'patchErrors',
              value: { [errorKey]: '', dateRange: '' },
            });
          }
        }}
      />
      <FieldError className="text-xs">{controller.errors[errorKey]}</FieldError>
    </Field>
  );
};

const ProjectOfferRevenueFields: React.FC<{ controller: ProjectsController }> = ({
  controller,
}) => (
  <div className="grid gap-4 md:grid-cols-2">
    <div className="space-y-1.5">
      <SelectControl
        id="project-offer"
        options={controller.offerOptions}
        value={controller.offerId}
        onChange={(value) => {
          const nextOfferId = value as string;
          controller.dispatch({ type: 'setOfferId', value: nextOfferId });
          if (controller.errors.offerId) {
            controller.dispatch({ type: 'patchErrors', value: { offerId: '' } });
          }
          const nextOffer = controller.offers.find((offer) => offer.id === nextOfferId);
          if (!nextOffer) return;
          if (nextOffer.clientId !== controller.clientId) {
            controller.dispatch({ type: 'setClientId', value: nextOffer.clientId });
            if (controller.errors.clientId) {
              controller.dispatch({ type: 'patchErrors', value: { clientId: '' } });
            }
          }
          controller.clearStaleClientLinks(nextOffer.clientId, 'offer');
        }}
        label={controller.t('projects:projects.offerOptionalLabel')}
        placeholder={controller.t('projects:projects.selectOffer')}
        searchable={true}
        buttonClassName="h-9"
      />
      <FieldError className="text-xs">{controller.errors.offerId}</FieldError>
    </div>
    <Field>
      <FieldLabel htmlFor="project-revenue">
        {`${controller.t('projects:projects.projectRevenue')} (${controller.currency})`}
      </FieldLabel>
      <Input
        id="project-revenue"
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={
          controller.revenueSource === 'manual'
            ? controller.revenue
            : controller.displayedRevenue.toFixed(2)
        }
        readOnly={controller.revenueSource !== 'manual'}
        onChange={(event) => controller.dispatch({ type: 'setRevenue', value: event.target.value })}
      />
      {controller.revenueHintBySource[controller.revenueSource] && (
        <FieldDescription className="text-xs">
          {controller.revenueHintBySource[controller.revenueSource]}
        </FieldDescription>
      )}
    </Field>
  </div>
);

const ProjectTipoField: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="grid gap-4 md:grid-cols-2">
    <div className="space-y-1.5">
      <SelectControl
        id="project-tipo"
        options={controller.translatedTipoOptions}
        value={controller.tipo}
        onChange={(value) => {
          controller.dispatch({ type: 'setTipo', value: value as ProjectTipo });
          if (controller.errors.tipo) {
            controller.dispatch({ type: 'patchErrors', value: { tipo: '' } });
          }
        }}
        label={
          <>
            {controller.t('projects:projects.tipo')} <RequiredMark />
          </>
        }
        placeholder={controller.t('projects:projects.selectTipo')}
        searchable={false}
        buttonClassName="h-9"
      />
      <FieldError className="text-xs">{controller.errors.tipo}</FieldError>
    </div>
  </div>
);

const ProjectStatusField: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="grid gap-4 md:grid-cols-2">
    <SelectControl
      id="project-status"
      options={controller.translatedStatusOptions}
      value={controller.status}
      onChange={(value) =>
        controller.dispatch({ type: 'setStatus', value: value as ProjectStatus })
      }
      label={controller.t('projects:projects.status')}
      labelAccessory={<ProjectStatusInfoTooltip t={controller.t} />}
      required
      placeholder={controller.t('projects:projects.selectStatus')}
      searchable={false}
      buttonClassName="h-9"
    />
  </div>
);

const ProjectBillingFields: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="grid gap-4 md:grid-cols-2">
    <SelectControl
      id="project-billing-type"
      options={controller.translatedBillingTypeOptions}
      value={controller.billingType}
      onChange={(value) =>
        controller.dispatch({ type: 'setBillingType', value: value as StoredBillingType })
      }
      label={controller.t('projects:projects.billingType')}
      searchable={false}
      buttonClassName="h-9"
    />
    <SelectControl
      id="project-billing-frequency"
      options={controller.translatedBillingFrequencyOptions}
      value={controller.billingFrequency}
      onChange={(value) =>
        controller.dispatch({ type: 'setBillingFrequency', value: value as BillingFrequency })
      }
      label={controller.t('projects:projects.billingFrequency')}
      searchable={false}
      buttonClassName="h-9"
    />
  </div>
);

const ProjectDraftTasksTable: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <div className="space-y-2">
    <StandardTable<DraftTask>
      title={controller.t('projects:projects.projectTasks')}
      data={controller.draftTasks}
      columns={controller.draftTaskColumns}
      defaultRowsPerPage={5}
      emptyState={
        <span className="text-xs italic text-muted-foreground">
          {controller.t('projects:projects.noTasksAdded')}
        </span>
      }
      headerAction={
        <Button
          type="button"
          onClick={controller.addDraftTask}
          size="sm"
          className={TABLE_CONTROL_BUTTON_CLASSNAME}
        >
          <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
          {controller.t('projects:projects.addTaskRow')}
        </Button>
      }
    />
  </div>
);

const ProjectDeleteDialog: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <DeleteConfirmModal
    isOpen={controller.isDeleteConfirmOpen}
    onClose={controller.closeModal}
    onConfirm={controller.handleDelete}
    title={controller.t('projects:projects.deleteProjectTitle', {
      name: controller.projectToDelete?.name,
    })}
    description={controller.t('projects:projects.deleteConfirm')}
  />
);

const ProjectAssignmentDialog: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <UserAssignmentModal
    isOpen={!!controller.managingProjectId}
    onClose={controller.closeAssignments}
    users={controller.assignableUsers}
    roles={controller.roles}
    loadAssignedUserIds={(signal) =>
      projectsApi.getUsers(controller.managingProjectId as string, signal)
    }
    saveAssignedUserIds={(ids) =>
      projectsApi.updateUsers(controller.managingProjectId as string, ids)
    }
    entityLabel={controller.t('projects:projects.entityLabel')}
    entityName={controller.managingProject?.name || ''}
    disabled={!controller.canManageAssignments}
  />
);

const ProjectsTabs: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <Tabs
    value={controller.selectedTab}
    onValueChange={controller.handleTabChange}
    className="space-y-6"
  >
    <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b px-0">
      {controller.canViewCommissions && (
        <TabsTrigger value="commissions" className="flex-none rounded-none pb-3">
          <Folder className="size-4" aria-hidden="true" />
          {controller.t('projects:tabs.commissions')}
        </TabsTrigger>
      )}
      {controller.canViewTasks && (
        <TabsTrigger value="tasks" className="flex-none rounded-none pb-3">
          <ListChecks className="size-4" aria-hidden="true" />
          {controller.t('projects:tabs.tasks')}
        </TabsTrigger>
      )}
    </TabsList>
    {controller.canViewCommissions && <ProjectsCommissionsTab controller={controller} />}
    {controller.canViewTasks && <ProjectsTasksTab controller={controller} />}
  </Tabs>
);

const ProjectsCommissionsTab: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <TabsContent value="commissions" className="mt-0 space-y-8">
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-800">
            {controller.t('projects:projects.title')}
          </h2>
          <p className="text-zinc-500 text-sm">{controller.t('projects:projects.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {controller.canCreateProjects && (
            <HeaderAddButton onClick={controller.openAddModal}>
              {controller.t('projects:projects.addProject')}
            </HeaderAddButton>
          )}
        </div>
      </div>
    </div>
    <StandardTable<Project>
      title={controller.t('projects:projects.projectsDirectory')}
      viewKey="projects.directory"
      defaultRowsPerPage={5}
      data={controller.projects}
      onRowClick={
        controller.onNavigateToProject
          ? (row) => controller.onNavigateToProject?.(row.id)
          : undefined
      }
      rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
      columns={controller.projectColumns}
    />
  </TabsContent>
);

const ProjectsTasksTab: React.FC<{ controller: ProjectsController }> = ({ controller }) => (
  <TabsContent value="tasks" className="mt-0">
    <TasksView
      tasks={controller.tasks}
      projects={controller.projects}
      clients={controller.clients}
      permissions={controller.permissions}
      users={controller.users}
      roles={controller.roles}
      currency={controller.currency}
      onAddTask={controller.onAddTask}
      onUpdateTask={controller.onUpdateTask}
      onDeleteTask={controller.onDeleteTask}
      onViewOrder={controller.onViewOrder}
    />
  </TabsContent>
);

export default ProjectsView;
