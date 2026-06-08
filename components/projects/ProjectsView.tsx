import type React from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  BILLING_FREQUENCY_OPTIONS,
  BILLING_TYPE_OPTIONS,
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
  ProjectTask,
  Role,
  StoredBillingType,
  User,
} from '../../types';
import { formatInsertDate } from '../../utils/date';
import { calculatePricingTotals } from '../../utils/numbers';
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
import type { RecurringConfig } from './TaskFormModal';

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

type RevenueSource = 'activities' | 'order' | 'manual';
type RevenueLike = { revenue?: number | string | null };

const sumActivityRevenue = (tasks: RevenueLike[]): number =>
  tasks.reduce((sum, t) => sum + (Number(t.revenue) || 0), 0);

const resolveRevenueSource = (activitiesSum: number, hasOrder: boolean): RevenueSource => {
  if (activitiesSum > 0) return 'activities';
  if (hasOrder) return 'order';
  return 'manual';
};

export type AddProjectFormInput = {
  name: string;
  clientId: string;
  offerId: string;
  orderId?: string;
  description?: string;
  draftTasks?: DraftTaskInput[];
  billingType?: StoredBillingType;
  billingFrequency?: BillingFrequency;
  startDate?: string | null;
  endDate?: string | null;
  revenue?: number | null;
};

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
      'expectedEffort' | 'monthlyEffort' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => Promise<ProjectTask>;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onDeleteTask: (id: string) => void | Promise<void>;
  onViewOrder?: (orderId: string) => void;
  onNavigateToProject?: (projectId: string) => void;
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

const ProjectsView: React.FC<ProjectsViewProps> = ({
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
  onNavigateToProject,
}) => {
  const { t, i18n } = useTranslation(['projects', 'common', 'form']);
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
    errors,
    draftTasks,
  } = state;

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

  useEffect(() => {
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
  }, [projectIdsKey]);

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
    if (!offerId) newErrors.offerId = t('projects:projects.offerRequired');
    if (!startDate) newErrors.startDate = t('projects:projects.startDateRequired');
    if (!endDate) newErrors.endDate = t('projects:projects.endDateRequired');
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
        expectedEffort: task.expectedEffort ? parseFloat(task.expectedEffort) : undefined,
        revenue: task.revenue ? parseFloat(task.revenue) : undefined,
        notes: task.notes.trim() || undefined,
      });
    }
    const result = await onAddProject({
      name,
      clientId,
      orderId: orderId || undefined,
      offerId,
      description,
      draftTasks: taskInputs.length > 0 ? taskInputs : undefined,
      billingType,
      billingFrequency,
      startDate: startDate || null,
      endDate: endDate || null,
      revenue: persistedRevenue,
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
          expectedEffort: '',
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

  const translatedBillingTypeOptions = BILLING_TYPE_OPTIONS.map((option) => ({
    id: option.id,
    name: t(option.name),
  }));
  const translatedBillingFrequencyOptions = BILLING_FREQUENCY_OPTIONS.map((option) => ({
    id: option.id,
    name: t(option.name),
  }));
  const formatBillingType = (value: Project['billingType'] | ProjectTask['billingType']) =>
    value === 'mixed'
      ? t('projects:projects.billingTypes.mixed')
      : (translatedBillingTypeOptions.find((option) => option.id === value)?.name ?? '-');
  const formatBillingFrequency = (value: BillingFrequency | undefined) =>
    translatedBillingFrequencyOptions.find((option) => option.id === value)?.name ?? '-';

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

  const offerOptions = offers.reduce<Array<{ id: string; name: string }>>((options, offer) => {
    if (offer.status !== 'sent' && offer.status !== 'accepted') return options;
    if (clientId && offer.clientId !== clientId) return options;
    options.push({ id: offer.id, name: `${offer.clientName} - ${offer.id}` });
    return options;
  }, []);
  if (offerId && !offerOptions.some((o) => o.id === offerId)) {
    const fallback = offers.find((o) => o.id === offerId);
    if (fallback) {
      offerOptions.unshift({ id: fallback.id, name: `${fallback.clientName} - ${fallback.id}` });
    }
  }

  const activitiesRevenueSum = sumActivityRevenue(draftTasks);
  const orderRevenue = selectedOrder
    ? calculatePricingTotals(
        selectedOrder.items,
        selectedOrder.discount,
        'hours',
        selectedOrder.discountType,
      ).total
    : 0;

  const revenueSource = resolveRevenueSource(activitiesRevenueSum, Boolean(selectedOrder));
  const revenueBySource: Record<RevenueSource, number> = {
    activities: activitiesRevenueSum,
    order: orderRevenue,
    manual: revenue ? parseFloat(revenue) : 0,
  };
  const revenueHintBySource: Record<RevenueSource, string> = {
    activities: t('projects:projects.revenueFromActivities'),
    order: t('projects:projects.revenueFromOrder'),
    manual: t('projects:projects.revenueManualHint'),
  };
  const displayedRevenue = revenueBySource[revenueSource];
  const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;

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
      {/* Create Project Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        {() => (
          <ModalContent size="2xl">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i className="fa-solid fa-briefcase" aria-hidden="true"></i>
                  </span>
                  {t('projects:projects.createNewProject')}
                </ModalTitle>
                <ModalCloseButton onClick={closeModal} />
              </ModalHeader>

              <ModalBody className="space-y-6">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <SelectControl
                        id="project-order"
                        options={orderOptions}
                        value={orderId}
                        onChange={(val) => {
                          const nextOrderId = val as string;
                          dispatch({ type: 'setOrderId', value: nextOrderId });
                          if (errors.orderId)
                            dispatch({ type: 'patchErrors', value: { orderId: '' } });
                          const nextOrder = orders.find((o) => o.id === nextOrderId);
                          if (!nextOrder) return;
                          dispatch({ type: 'setClientId', value: nextOrder.clientId });
                          if (errors.clientId)
                            dispatch({ type: 'patchErrors', value: { clientId: '' } });
                          clearStaleClientLinks(nextOrder.clientId, 'order');
                        }}
                        label={t('projects:projects.orderOptionalLabel')}
                        placeholder={t('projects:projects.selectOrder')}
                        searchable={true}
                        buttonClassName="h-9"
                      />
                      <FieldError className="text-xs">{errors.orderId}</FieldError>
                    </div>
                    <div className="space-y-1.5">
                      <SelectControl
                        id="project-client"
                        options={clientOptions}
                        value={clientId}
                        onChange={(val) => {
                          applyClientChange(val as string);
                        }}
                        label={
                          <>
                            {t('projects:projects.client')} <RequiredMark />
                          </>
                        }
                        placeholder={t('projects:projects.selectClient')}
                        searchable={true}
                        disabled={Boolean(selectedOrder)}
                        buttonClassName="h-9"
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                      {selectedOrder && (
                        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                          <i
                            className="fa-solid fa-link text-xs text-muted-foreground"
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
                    <Field data-invalid={Boolean(errors.name)} className="md:col-span-2">
                      <FieldLabel htmlFor="project-name">
                        {t('projects:projects.name')} <RequiredMark />
                      </FieldLabel>
                      <Input
                        id="project-name"
                        type="text"
                        required
                        value={name}
                        aria-invalid={Boolean(errors.name)}
                        onChange={(e) => {
                          dispatch({ type: 'setName', value: e.target.value });
                          if (errors.name) dispatch({ type: 'patchErrors', value: { name: '' } });
                        }}
                        placeholder={t('projects:projects.projectNamePlaceholder')}
                      />
                      <FieldError className="text-xs">{errors.name}</FieldError>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="project-description">
                      {t('projects:projects.description')}
                    </FieldLabel>
                    <Textarea
                      id="project-description"
                      value={description}
                      onChange={(e) => dispatch({ type: 'setDescription', value: e.target.value })}
                      placeholder={t('projects:projects.descriptionPlaceholder')}
                      rows={3}
                      className="min-h-20 resize-none"
                    />
                  </Field>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field data-invalid={Boolean(errors.startDate || errors.dateRange)}>
                      <FieldLabel htmlFor="project-start-date">
                        {t('projects:projects.startDate')} <RequiredMark />
                      </FieldLabel>
                      <DateField
                        id="project-start-date"
                        required
                        value={startDate}
                        aria-invalid={Boolean(errors.startDate || errors.dateRange)}
                        onChange={(value) => {
                          dispatch({ type: 'setStartDate', value });
                          if (errors.startDate || errors.dateRange) {
                            dispatch({
                              type: 'patchErrors',
                              value: { startDate: '', dateRange: '' },
                            });
                          }
                        }}
                      />
                      <FieldError className="text-xs">{errors.startDate}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.endDate || errors.dateRange)}>
                      <FieldLabel htmlFor="project-end-date">
                        {t('projects:projects.endDate')} <RequiredMark />
                      </FieldLabel>
                      <DateField
                        id="project-end-date"
                        required
                        value={endDate}
                        aria-invalid={Boolean(errors.endDate || errors.dateRange)}
                        onChange={(value) => {
                          dispatch({ type: 'setEndDate', value });
                          if (errors.endDate || errors.dateRange) {
                            dispatch({
                              type: 'patchErrors',
                              value: { endDate: '', dateRange: '' },
                            });
                          }
                        }}
                      />
                      <FieldError className="text-xs">{errors.endDate}</FieldError>
                    </Field>
                  </div>
                  {errors.dateRange && (
                    <FieldError className="text-xs">{errors.dateRange}</FieldError>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <SelectControl
                        id="project-offer"
                        options={offerOptions}
                        value={offerId}
                        onChange={(val) => {
                          const nextOfferId = val as string;
                          dispatch({ type: 'setOfferId', value: nextOfferId });
                          if (errors.offerId)
                            dispatch({ type: 'patchErrors', value: { offerId: '' } });
                          const nextOffer = offers.find((o) => o.id === nextOfferId);
                          if (!nextOffer) return;
                          if (nextOffer.clientId !== clientId) {
                            dispatch({ type: 'setClientId', value: nextOffer.clientId });
                            if (errors.clientId)
                              dispatch({ type: 'patchErrors', value: { clientId: '' } });
                          }
                          clearStaleClientLinks(nextOffer.clientId, 'offer');
                        }}
                        label={
                          <>
                            {t('projects:projects.offerReference')} <RequiredMark />
                          </>
                        }
                        placeholder={t('projects:projects.selectOffer')}
                        searchable={true}
                        buttonClassName="h-9"
                      />
                      <FieldError className="text-xs">{errors.offerId}</FieldError>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="project-revenue">
                        {`${t('projects:projects.projectRevenue')} (${currency})`}
                      </FieldLabel>
                      <Input
                        id="project-revenue"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={revenueSource === 'manual' ? revenue : displayedRevenue.toFixed(2)}
                        readOnly={revenueSource !== 'manual'}
                        onChange={(e) => dispatch({ type: 'setRevenue', value: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {revenueHintBySource[revenueSource]}
                      </p>
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectControl
                      id="project-billing-type"
                      options={translatedBillingTypeOptions}
                      value={billingType}
                      onChange={(val) =>
                        dispatch({ type: 'setBillingType', value: val as StoredBillingType })
                      }
                      label={t('projects:projects.billingType')}
                      searchable={false}
                      buttonClassName="h-9"
                    />
                    <SelectControl
                      id="project-billing-frequency"
                      options={translatedBillingFrequencyOptions}
                      value={billingFrequency}
                      onChange={(val) =>
                        dispatch({ type: 'setBillingFrequency', value: val as BillingFrequency })
                      }
                      label={t('projects:projects.billingFrequency')}
                      searchable={false}
                      buttonClassName="h-9"
                    />
                  </div>

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
                </div>
              </ModalBody>

              <ModalFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={closeModal}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit" disabled={!canCreateProjects}>
                  {t('projects:projects.addProject')}
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
        viewKey="projects.directory"
        defaultRowsPerPage={5}
        data={projects}
        onRowClick={onNavigateToProject ? (row) => onNavigateToProject(row.id) : undefined}
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
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {row.createdAt ? formatInsertDate(row.createdAt, i18n.language) : '—'}
                </span>
              ),
            },
            {
              header: t('projects:projects.tableHeaders.projectName'),
              accessorKey: 'name',
              cell: ({ row }) => (
                <span
                  className={`text-sm font-bold ${
                    row.isDisabled
                      ? 'text-zinc-600 line-through decoration-zinc-300'
                      : 'text-zinc-800'
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
          ] as Column<Project>[]
        }
      />
    </div>
  );
};

export default ProjectsView;
