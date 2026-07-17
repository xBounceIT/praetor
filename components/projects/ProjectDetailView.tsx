import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
} from '@/components/ui/chart';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  RequiredMark,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBillingFrequencyOptions, useBillingTypeOptions } from '@/hooks/useBillingOptions';
import {
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  toStoredBillingType,
} from '@/utils/billing';
import { useCurrentUserId } from '../../contexts/useCurrentUserId';
import { entriesApi, projectsApi } from '../../services/api';
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
  TimeEntry,
  User,
} from '../../types';
import { LEGACY_PROJECT_STATUS, PROJECT_TIPOS } from '../../types';
import { formatInsertDate } from '../../utils/date';
import { formatNumber } from '../../utils/numbers';
import { hasPermission, hasScopedActionPermission } from '../../utils/permissions';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import StatusBadge from '../shared/StatusBadge';
import Toggle from '../shared/Toggle';
import UserAssignmentModal from '../shared/UserAssignmentModal';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import DashboardControls from './DashboardControls';
import DashboardGrid, { DashboardItem } from './DashboardGrid';
import type { DashboardWidgetDef } from './dashboardLayout';
import ProjectRules from './ProjectRules';
import { ProjectStatusInfoTooltip } from './ProjectStatusInfoTooltip';
import ProjectTasksTable from './ProjectTasksTable';
import {
  getProjectStatusBadgeType,
  getProjectStatusIcon,
  translateProjectStatusOptions,
} from './projectStatusUi';
import type { RecurringConfig } from './TaskFormModal';
import { useDashboardLayout } from './useDashboardLayout';

// Stable id for the GLOBAL tier of the project-analytics dashboard: the shared
// default layout + the named-view library, applied to every project that has no
// override of its own. Per-project overrides layer on top, keyed by project.id.
const DASHBOARD_ID = 'project-analytics';

// Canonical widget set + default layout for the analytics section on a 12-column
// grid: `x`/`y` is the default top-left cell, `w`/`h` the default size, `minW`/
// `minH` the smallest the card may be resized to. The KPI stat cards, the
// project timeline, and the four charts are all placeable.
// IMPORTANT: each entry must have a matching item in `widgetItems` below (and
// vice-versa). An id here without an item reserves an invisible slot; an item
// without an id here renders unmanaged. Keep the two in lockstep.
//
// Permission-gated cards (totalCost / budgetUsed / teamSize) are filtered out of
// the *active* def set before reaching the layout hook, so a user who can't see
// them never gets an empty reserved slot.
// Heights are sized so the default cell fits its content without clipping: KPI
// cards are h3 (the team-size card needs room for its avatar row) with a matching
// minH3 floor so a stored h2 layout from an earlier build is bumped back up, and
// charts are h6 so the taller xl chart variant fits.
const DASHBOARD_WIDGETS: readonly DashboardWidgetDef[] = [
  { id: 'totalHours', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { id: 'totalCost', x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { id: 'teamSize', x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { id: 'budgetUsed', x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { id: 'timeline', x: 0, y: 3, w: 12, h: 3, minW: 4, minH: 2 },
  { id: 'hoursByUser', x: 0, y: 6, w: 6, h: 6, minW: 4, minH: 4 },
  { id: 'hoursByTask', x: 6, y: 6, w: 6, h: 6, minW: 4, minH: 4 },
  { id: 'costVsRevenue', x: 0, y: 12, w: 6, h: 6, minW: 4, minH: 4 },
  { id: 'monthlyActivity', x: 6, y: 12, w: 6, h: 6, minW: 4, minH: 4 },
];

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;
const formatOneDecimal = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });

const tipoOptions = PROJECT_TIPOS.map((id) => ({
  id,
  name: `projects:projects.tipoValues.${id}`,
}));

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
};

// Pagination cap for the project entries fetch. 10 pages × 500 rows = 5000 entries.
// Long-running projects beyond this surface the truncation notice; aggregations
// past this range stop being meaningful at the UI layer anyway.
const ENTRIES_PAGE_LIMIT = 500;
const ENTRIES_PAGE_CAP = 10;
const ENTRIES_FETCH_CEILING = ENTRIES_PAGE_LIMIT * ENTRIES_PAGE_CAP;

const formatMonthBucket = (date: string, locale: string): string => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(0, 7);
  return d.toLocaleString(locale, { month: 'short', year: '2-digit' });
};

type RevenueSource = 'activities' | 'manual';
type RevenueLike = {
  revenue?: number | string | null;
  duration?: number | string | null;
  totalRevenue?: number | string | null;
};

const sumActivityRevenue = (tasks: ReadonlyArray<RevenueLike>): number =>
  tasks.reduce((sum, t) => {
    const totalRevenue =
      t.totalRevenue !== undefined && t.totalRevenue !== null
        ? Number(t.totalRevenue)
        : (Number(t.revenue) || 0) * (Number(t.duration ?? 1) || 0);
    return sum + (Number.isFinite(totalRevenue) ? totalRevenue : 0);
  }, 0);

const resolveRevenueSource = (activitiesSum: number): RevenueSource => {
  if (activitiesSum > 0) return 'activities';
  return 'manual';
};

export interface ProjectDetailViewProps {
  project: Project;
  clients: Client[];
  companyName: string | null;
  orders: ClientsOrder[];
  offers: ClientOffer[];
  users: User[];
  roles: Role[];
  permissions: string[];
  currency: string;
  tasks: ProjectTask[];
  onBack: () => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<Project | null>;
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
}

type ProjectDetailFormState = {
  name: string;
  clientId: string;
  description: string;
  startDate: string;
  endDate: string;
  orderId: string;
  offerId: string;
  revenue: string;
  tempIsDisabled: boolean;
  status: ProjectStatus;
  tipo: ProjectTipo | '';
  errors: Record<string, string>;
};

type ProjectDetailFormField = Exclude<keyof ProjectDetailFormState, 'errors'>;

type ProjectDetailFormAction =
  | {
      type: 'setField';
      field: ProjectDetailFormField;
      value: ProjectDetailFormState[ProjectDetailFormField];
    }
  | { type: 'setErrors'; value: React.SetStateAction<Record<string, string>> }
  | { type: 'reset'; project: Project };

type ProjectDetailUiState = {
  billingTypeDraft: StoredBillingType | null;
  billingFrequencyDraft: BillingFrequency | null;
  entries: TimeEntry[];
  entriesLoading: boolean;
  entriesTruncated: boolean;
  entriesError: 'forbidden' | 'failed' | null;
  assignedUserIds: string[];
  assignedLoading: boolean;
  isDeleteConfirmOpen: boolean;
  taskToDelete: ProjectTask | null;
  isTaskDeleteConfirmOpen: boolean;
  isAssignmentsOpen: boolean;
  isInternalConversionOpen: boolean;
};

type ProjectDetailUiAction = {
  [Key in keyof ProjectDetailUiState]: {
    type: 'set';
    key: Key;
    value: React.SetStateAction<ProjectDetailUiState[Key]>;
  };
}[keyof ProjectDetailUiState];

const resolveStateAction = <T,>(value: React.SetStateAction<T>, previous: T): T =>
  typeof value === 'function' ? (value as (previous: T) => T)(previous) : value;

const getProjectDetailBaselineTipo = (project: Project): ProjectTipo | '' =>
  project.tipoConfirmed ? (project.tipo ?? '') : '';

const createProjectDetailFormState = (project: Project): ProjectDetailFormState => ({
  name: project.name,
  clientId: project.clientId,
  description: project.description ?? '',
  startDate: project.startDate ?? '',
  endDate: project.endDate ?? '',
  orderId: project.orderId ?? '',
  offerId: project.offerId ?? '',
  revenue: project.revenue !== null && project.revenue !== undefined ? String(project.revenue) : '',
  tempIsDisabled: project.isDisabled ?? false,
  status: project.status ?? LEGACY_PROJECT_STATUS,
  tipo: getProjectDetailBaselineTipo(project),
  errors: {},
});

const projectDetailFormReducer = (
  state: ProjectDetailFormState,
  action: ProjectDetailFormAction,
): ProjectDetailFormState => {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value };
    case 'setErrors':
      return { ...state, errors: resolveStateAction(action.value, state.errors) };
    case 'reset':
      return createProjectDetailFormState(action.project);
  }
};

const createProjectDetailUiState = (): ProjectDetailUiState => ({
  billingTypeDraft: null,
  billingFrequencyDraft: null,
  entries: [],
  entriesLoading: false,
  entriesTruncated: false,
  entriesError: null,
  assignedUserIds: [],
  assignedLoading: false,
  isDeleteConfirmOpen: false,
  taskToDelete: null,
  isTaskDeleteConfirmOpen: false,
  isAssignmentsOpen: false,
  isInternalConversionOpen: false,
});

const projectDetailUiReducer = (
  state: ProjectDetailUiState,
  action: ProjectDetailUiAction,
): ProjectDetailUiState => {
  const current = state[action.key];
  return {
    ...state,
    [action.key]: resolveStateAction(action.value as React.SetStateAction<typeof current>, current),
  };
};

const useProjectDetailController = ({
  project,
  companyName,
  clients,
  orders,
  offers,
  users,
  roles,
  permissions,
  currency,
  tasks,
  onBack,
  onUpdateProject,
  onDeleteProject,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onViewOrder,
}: ProjectDetailViewProps) => {
  const { t, i18n } = useTranslation(['projects', 'common', 'form']);
  // Identifies the viewer for the server-backed dashboard view library (ownership
  // is computed server-side; this is threaded for parity with the table surface).
  const currentUserId = useCurrentUserId();

  const canUpdateProjects = hasScopedActionPermission(permissions, 'projects.manage', 'update');
  const canDeleteProjects = hasScopedActionPermission(permissions, 'projects.manage', 'delete');
  const canCreateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'create');
  const canUpdateTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'update');
  const canDeleteTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'delete');
  const canManageAssignments = hasScopedActionPermission(
    permissions,
    'projects.assignments',
    'update',
  );
  const canViewCost = permissions.includes('reports.cost.view');
  // Probed up front so we can short-circuit the entries fetch without round-tripping
  // through a guaranteed 403 ten times per detail-view navigation. Mirrors the route's
  // `requireScopedPermission('timesheets.tracker', 'view')` gate.
  const canViewEntries = hasScopedActionPermission(permissions, 'timesheets.tracker', 'view');

  const [formState, dispatchForm] = useReducer(
    projectDetailFormReducer,
    project,
    createProjectDetailFormState,
  );
  const {
    name,
    clientId,
    description,
    startDate,
    endDate,
    offerId,
    revenue,
    tempIsDisabled,
    status,
    tipo,
    errors,
  } = formState;
  const [orderId, setOrderId] = useState(project.orderId ?? '');
  const setFormField = <K extends ProjectDetailFormField>(
    field: K,
    value: ProjectDetailFormState[K],
  ) => dispatchForm({ type: 'setField', field, value });
  const setName = (value: string) => setFormField('name', value);
  const setClientId = (value: string) => setFormField('clientId', value);
  const setDescription = (value: string) => setFormField('description', value);
  const setStartDate = (value: string) => setFormField('startDate', value);
  const setEndDate = (value: string) => setFormField('endDate', value);
  const setOfferId = (value: string) => setFormField('offerId', value);
  const setRevenue = (value: string) => setFormField('revenue', value);
  const setTempIsDisabled = (value: boolean) => setFormField('tempIsDisabled', value);
  const setStatus = (value: ProjectStatus) => setFormField('status', value);
  const setTipo = (value: ProjectTipo | '') => setFormField('tipo', value);
  const setErrors = (value: React.SetStateAction<Record<string, string>>) =>
    dispatchForm({ type: 'setErrors', value });
  const [uiState, dispatchUiState] = useReducer(
    projectDetailUiReducer,
    undefined,
    createProjectDetailUiState,
  );
  const {
    billingTypeDraft,
    billingFrequencyDraft,
    entries,
    entriesLoading,
    entriesTruncated,
    entriesError,
    assignedUserIds,
    assignedLoading,
    isDeleteConfirmOpen,
    taskToDelete,
    isTaskDeleteConfirmOpen,
    isAssignmentsOpen,
    isInternalConversionOpen,
  } = uiState;
  const setUiState = useCallback(
    <Key extends keyof ProjectDetailUiState>(
      key: Key,
      value: React.SetStateAction<ProjectDetailUiState[Key]>,
    ) => {
      dispatchUiState({ type: 'set', key, value } as ProjectDetailUiAction);
    },
    [],
  );
  const setBillingTypeDraft = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['billingTypeDraft']>) =>
      setUiState('billingTypeDraft', value),
    [setUiState],
  );
  const setBillingFrequencyDraft = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['billingFrequencyDraft']>) =>
      setUiState('billingFrequencyDraft', value),
    [setUiState],
  );
  const setEntries = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['entries']>) => setUiState('entries', value),
    [setUiState],
  );
  const setEntriesLoading = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['entriesLoading']>) =>
      setUiState('entriesLoading', value),
    [setUiState],
  );
  const setEntriesTruncated = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['entriesTruncated']>) =>
      setUiState('entriesTruncated', value),
    [setUiState],
  );
  const setEntriesError = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['entriesError']>) =>
      setUiState('entriesError', value),
    [setUiState],
  );
  const setAssignedUserIds = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['assignedUserIds']>) =>
      setUiState('assignedUserIds', value),
    [setUiState],
  );
  const setAssignedLoading = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['assignedLoading']>) =>
      setUiState('assignedLoading', value),
    [setUiState],
  );
  const setIsDeleteConfirmOpen = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['isDeleteConfirmOpen']>) =>
      setUiState('isDeleteConfirmOpen', value),
    [setUiState],
  );
  const setTaskToDelete = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['taskToDelete']>) =>
      setUiState('taskToDelete', value),
    [setUiState],
  );
  const setIsTaskDeleteConfirmOpen = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['isTaskDeleteConfirmOpen']>) =>
      setUiState('isTaskDeleteConfirmOpen', value),
    [setUiState],
  );
  const setIsAssignmentsOpen = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['isAssignmentsOpen']>) =>
      setUiState('isAssignmentsOpen', value),
    [setUiState],
  );
  const setIsInternalConversionOpen = useCallback(
    (value: React.SetStateAction<ProjectDetailUiState['isInternalConversionOpen']>) =>
      setUiState('isInternalConversionOpen', value),
    [setUiState],
  );
  // `tipo` (issue #784). A rollout-defaulted project (`tipoConfirmed === false`) starts with an
  // EMPTY selector so the user must make a deliberate first choice before saving — we don't
  // pre-fill the silent 'attivo' default. A confirmed project shows its stored value.
  const tipoNeedsConfirmation = !project.tipoConfirmed;
  const baselineTipo = getProjectDetailBaselineTipo(project);
  const baselineStatus = project.status ?? LEGACY_PROJECT_STATUS;

  // No prop-sync useEffect: the parent passes `key={project.id}` so this component
  // remounts on project switch. Same-id parent updates (background poll / optimistic update)
  // intentionally do NOT clobber the reducer draft so unsaved edits survive.

  const entriesLoadKey = `${project.id}|${canViewEntries ? '1' : '0'}`;
  const assignedLoadKey = `${project.id}|${canManageAssignments ? '1' : '0'}`;
  const [loadedEntriesKey, setLoadedEntriesKey] = useState<string | null>(null);
  const [loadedAssignedKey, setLoadedAssignedKey] = useState<string | null>(null);

  if (loadedEntriesKey !== entriesLoadKey) {
    setLoadedEntriesKey(entriesLoadKey);
    setEntries([]);
    setEntriesTruncated(false);
    setEntriesError(canViewEntries ? null : 'forbidden');
    setEntriesLoading(canViewEntries);
  }

  if (loadedAssignedKey !== assignedLoadKey) {
    setLoadedAssignedKey(assignedLoadKey);
    setAssignedUserIds([]);
    setAssignedLoading(canManageAssignments);
  }

  // Dashboard layout: position / size / visibility of the analytics cards on a
  // free-form grid, plus saved named views. The named-view library is now
  // server-backed and shareable (own + shared-with-me, keyed by DASHBOARD_ID as
  // the server scope), owned by its creator and grantable to other users as read
  // (apply-only) or write (edit/rename/re-save). The personal baseline (global
  // default) and the per-project override + active-view marker stay in
  // localStorage, per-user. Permission-gated cards are dropped from the active
  // def set so they never reserve an empty slot.
  // Single source of truth for which cards the viewer may see — used both to
  // filter the layout def set and to gate the matching JSX below, so the two
  // can't drift apart.
  const widgetPermitted = useCallback(
    (id: string): boolean => {
      if (id === 'totalCost' || id === 'budgetUsed') return canViewCost;
      if (id === 'teamSize') return canManageAssignments;
      return true;
    },
    [canViewCost, canManageAssignments],
  );
  const activeWidgetDefs = useMemo(
    () => DASHBOARD_WIDGETS.filter((d) => widgetPermitted(d.id)),
    [widgetPermitted],
  );
  const dashboard = useDashboardLayout(DASHBOARD_ID, project.id, activeWidgetDefs, currentUserId);

  useEffect(() => {
    // Short-circuit when the caller lacks the tracker view permission — the route
    // would return 403 and we'd burn 10 round-trips for nothing.
    if (!canViewEntries) {
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        const collected: TimeEntry[] = [];
        let cursor: string | null = null;
        let truncated = false;
        for (let i = 0; i < ENTRIES_PAGE_CAP; i++) {
          if (ac.signal.aborted) return;
          const page = await entriesApi.listPage({
            projectId: project.id,
            cursor,
            limit: ENTRIES_PAGE_LIMIT,
            signal: ac.signal,
          });
          collected.push(...page.entries);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (cursor) truncated = true;
        if (ac.signal.aborted) return;
        setEntries(collected);
        setEntriesTruncated(truncated);
      } catch (e) {
        if (ac.signal.aborted) return;
        // 403 → permission gap surfaced server-side (e.g. role changed between mount
        // and fetch); surface the clear unavailable state instead of empty charts.
        const status =
          (e as { status?: number; statusCode?: number })?.status ??
          (e as { statusCode?: number })?.statusCode;
        if (status === 403) {
          setEntriesError('forbidden');
        } else {
          console.error('Failed to load project time entries', e);
          setEntriesError('failed');
        }
      } finally {
        if (!ac.signal.aborted) setEntriesLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [
    project.id,
    canViewEntries,
    setEntries,
    setEntriesError,
    setEntriesLoading,
    setEntriesTruncated,
  ]);

  useEffect(() => {
    // GET /projects/:id/users is server-gated on `projects.assignments.update`. Without
    // that permission the fetch 403s, we'd swallow the error, and the KPI would render
    // a misleading "0" team size for projects that actually have members.
    if (!canManageAssignments) {
      return;
    }
    const ac = new AbortController();
    projectsApi
      .getUsers(project.id, ac.signal)
      .then((ids) => {
        if (ac.signal.aborted) return;
        setAssignedUserIds(ids);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        console.error('Failed to load project users', e);
      })
      .finally(() => {
        if (!ac.signal.aborted) setAssignedLoading(false);
      });
    return () => {
      ac.abort();
    };
  }, [project.id, canManageAssignments, setAssignedLoading, setAssignedUserIds]);

  // Aggregations
  const totalHours = useMemo(
    () => entries.reduce((sum, e) => sum + (e.duration ?? 0), 0),
    [entries],
  );
  const totalCost = useMemo(() => entries.reduce((sum, e) => sum + (e.cost ?? 0), 0), [entries]);
  // Grouped histogram: per user, hours logged on each task. Users are the X-axis
  // groups; tasks are the colored series, so each user shows one bar per task
  // (5 users × 3 tasks → 15 bars). Capped to keep the cluster readable: the top
  // tasks by total hours become the series, the top users by their hours over
  // those tasks become the groups. The task cap matches the chart palette
  // (--chart-1..5) so no two task series collide on the same color.
  const TOP_TASK_SERIES = 5;
  const TOP_USER_GROUPS = 8;
  const hoursByUserTask = useMemo(() => {
    const unknownLabel = t('projects:projects.unknown');
    // userId -> taskKey -> hours
    const byUser = new Map<string, Map<string, number>>();
    const taskTotals = new Map<string, number>();
    const taskNames = new Map<string, string>();
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    for (const e of entries) {
      const taskKey = e.taskId ?? `name:${e.task || ''}`;
      const dur = e.duration ?? 0;
      taskTotals.set(taskKey, (taskTotals.get(taskKey) ?? 0) + dur);
      // Prefer the current task name (handles renames), then the entry snapshot.
      const currentName = e.taskId ? (tasksById.get(e.taskId)?.name ?? e.task) : e.task;
      const resolved = currentName || unknownLabel;
      const existing = taskNames.get(taskKey);
      if (!existing || (existing === unknownLabel && resolved !== unknownLabel)) {
        taskNames.set(taskKey, resolved);
      }
      let um = byUser.get(e.userId);
      if (!um) {
        um = new Map();
        byUser.set(e.userId, um);
      }
      um.set(taskKey, (um.get(taskKey) ?? 0) + dur);
    }
    // Top tasks → stable synthetic series keys (t0, t1, …). Synthetic keys avoid
    // using a raw task name (or "name:…" fallback) as a Recharts dataKey, where
    // dots would be misread as nested-path accessors.
    const topTaskKeys = Array.from(taskTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_TASK_SERIES)
      .map(([k]) => k);
    const series = topTaskKeys.map((taskKey, i) => ({
      seriesKey: `t${i}`,
      taskKey,
      name: taskNames.get(taskKey) ?? unknownLabel,
      color: `var(--chart-${(i % 5) + 1})`,
    }));
    // Candidate users = everyone assigned to the project (so members who haven't
    // logged time still appear, as 0-hour bars) ∪ anyone who logged time (covers
    // former members no longer assigned). Seeding from the assignment roster
    // mirrors how hours-by-task seeds planned-but-unworked tasks. When the viewer
    // lacks assignment-view permission `assignedUserIds` is empty, so the chart
    // gracefully degrades to just the users who logged time.
    const candidateIds = new Set<string>([...assignedUserIds, ...byUser.keys()]);
    const rows = Array.from(candidateIds)
      .map((userId) => {
        const um = byUser.get(userId);
        let total = 0;
        for (const k of topTaskKeys) total += um?.get(k) ?? 0;
        return {
          userId,
          // Fall back to a translated "unknown" label rather than the raw UUID
          // when the user is no longer in the loaded `users` list.
          userName: users.find((u) => u.id === userId)?.name ?? unknownLabel,
          total,
        };
      })
      // Active users first; 0-hour members fall to the end in stable name order.
      .sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName, i18n.language))
      .slice(0, TOP_USER_GROUPS)
      .map(({ userId, userName }) => {
        const um = byUser.get(userId);
        const row: Record<string, string | number> = { userId, userName };
        for (const s of series) {
          row[s.seriesKey] = Math.round((um?.get(s.taskKey) ?? 0) * 100) / 100;
        }
        return row;
      });
    return { rows, series };
  }, [entries, tasks, users, assignedUserIds, t, i18n.language]);

  const hoursByTask = useMemo(() => {
    // Key by taskId where available so renamed tasks don't appear as two bars; fall back
    // to the snapshot task name for legacy entries with null taskId. Resolve labels in
    // two passes: aggregate hours first, then pick the best name per key — preferring the
    // current task name over the entry's frozen one, falling back to "unknown" last. This
    // avoids the "first entry wins" trap where an early entry with an empty name would
    // lock the label to 'Unknown' even after later entries provide a real name.
    const unknownLabel = t('projects:projects.unknown');
    const hoursByKey = new Map<string, number>();
    const sampleEntryByKey = new Map<string, TimeEntry>();
    // Seed with every task on this project so tasks without entries still surface
    // as 0-hour bars (e.g. tasks planned but not yet worked on). Without this seed,
    // the chart would silently omit them and read as "tasks X, Y, Z are the only
    // ones on this project" instead of "X, Y, Z got the hours so far."
    for (const pt of tasks) {
      if (pt.projectId === project.id) hoursByKey.set(pt.id, 0);
    }
    for (const e of entries) {
      const key = e.taskId ?? `name:${e.task || ''}`;
      hoursByKey.set(key, (hoursByKey.get(key) ?? 0) + (e.duration ?? 0));
      const sample = sampleEntryByKey.get(key);
      // Prefer entries with a non-empty task snapshot so the label resolution below can
      // fall back to a meaningful name when the current task isn't in `tasks`.
      if (!sample || (!sample.task && e.task)) sampleEntryByKey.set(key, e);
    }
    return (
      Array.from(hoursByKey.entries())
        .map(([key, hours]) => {
          // Resolve the label: current task name (handles renames AND seeded tasks
          // with no entries), then entry snapshot, then 'unknown'.
          const currentTask = tasks.find((t) => t.id === key);
          const sample = sampleEntryByKey.get(key);
          const sampleTask = sample?.taskId ? tasks.find((t) => t.id === sample.taskId) : undefined;
          const name = currentTask?.name ?? sampleTask?.name ?? sample?.task;
          const round = (n: number) => Math.round(n * 100) / 100;
          const actual = round(hours);
          // `expectedEffort` ("Impegno totale" / total effort available) drives the
          // planned-vs-actual stack below. Legacy entries with no resolvable task
          // (null taskId, task deleted) have no budget → expected 0.
          const expected = round(currentTask?.expectedEffort ?? sampleTask?.expectedEffort ?? 0);
          // Split actual hours into the segments of a single utilization bar:
          //   logged    — consumed effort, capped at the budget (solid)
          //   remaining — unused budget = expected − actual (faint)
          //   over      — overrun = actual − expected (destructive)
          // For tasks with no budget (expected 0), all hours are just `logged`
          // and there's no overrun — a missing budget isn't "over budget".
          const logged = expected > 0 ? Math.min(actual, expected) : actual;
          const remaining = Math.max(0, round(expected - actual));
          const over = expected > 0 ? Math.max(0, round(actual - expected)) : 0;
          return {
            // Stable key that survives task renames (used for React keys).
            key,
            task: name || unknownLabel,
            hours: actual,
            expected,
            logged,
            remaining,
            over,
          };
        })
        // Secondary sort by name keeps the 0-hour tail in a stable, scannable order
        // — otherwise all the zeros tie on the primary sort and depend on Map
        // insertion order, which shifts as new tasks get added. Pass i18n.language
        // so accented characters collate per the user's locale (every other
        // formatter in this file is locale-aware).
        .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task, i18n.language))
        .slice(0, 10)
    );
  }, [entries, tasks, project.id, t, i18n.language]);

  // Cumulative cost vs the project revenue ceiling, bucketed monthly. The
  // running total makes burn-down readable at a glance against the revenue
  // reference line, while the per-month bar gives a sense of recent activity.
  const costOverTime = useMemo(() => {
    const monthlyMap = new Map<string, number>();
    for (const e of entries) {
      const month = e.date.slice(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (e.cost ?? 0));
    }
    let cumulative = 0;
    return Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, monthlyCost]) => {
        cumulative += monthlyCost;
        return {
          month,
          label: formatMonthBucket(`${month}-01`, i18n.language),
          monthlyCost: Math.round(monthlyCost * 100) / 100,
          cumulativeCost: Math.round(cumulative * 100) / 100,
        };
      });
  }, [entries, i18n.language]);

  // Logged hours bucketed by calendar month — the project's activity cadence.
  // Answers "is this ramping up, steady, winding down, or stalled?", which none
  // of the other charts surface. Chronological (not sorted by size) so the trend
  // reads left-to-right, and the mean gives a baseline to compare months against.
  const monthlyActivity = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const month = e.date.slice(0, 7);
      map.set(month, (map.get(month) ?? 0) + (e.duration ?? 0));
    }
    const rows = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, hours]) => ({
        month,
        label: formatMonthBucket(`${month}-01`, i18n.language),
        hours: Math.round(hours * 100) / 100,
      }));
    const total = rows.reduce((s, r) => s + r.hours, 0);
    const avg = rows.length > 0 ? Math.round((total / rows.length) * 100) / 100 : 0;
    return { rows, avg };
  }, [entries, i18n.language]);

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  const orderOptions = orders.reduce<Array<{ id: string; name: string }>>((options, order) => {
    if (order.status === 'confirmed') {
      options.push({
        id: order.id,
        name: `${order.clientName} - ${formatOrderId(order.id)}`,
      });
    }
    return options;
  }, []);
  if (orderId && !orderOptions.some((o) => o.id === orderId)) {
    const fallback = orders.find((o) => o.id === orderId);
    if (fallback) {
      orderOptions.unshift({
        id: fallback.id,
        name: `${fallback.clientName} - ${formatOrderId(fallback.id)}`,
      });
    }
  }
  // Single pass: filter to accepted/sent offers belonging to the current client and
  // shape into the option struct (vs. .filter().filter().map() iterating thrice).
  const offerOptions: { id: string; name: string }[] = [
    { id: '', name: t('projects:projects.noOfferLinked') },
  ];
  for (const o of offers) {
    if (o.status !== 'sent' && o.status !== 'accepted') continue;
    if (clientId && o.clientId !== clientId) continue;
    offerOptions.push({ id: o.id, name: `${o.clientName} - ${o.id}` });
  }
  if (offerId && !offerOptions.some((o) => o.id === offerId)) {
    const fallback = offers.find((o) => o.id === offerId);
    if (fallback) {
      offerOptions.unshift({ id: fallback.id, name: `${fallback.clientName} - ${fallback.id}` });
    }
  }

  const translatedBillingTypeOptions = useBillingTypeOptions();
  const translatedBillingFrequencyOptions = useBillingFrequencyOptions();
  const translatedTipoOptions = tipoOptions.map((o) => ({
    id: o.id,
    name: t(o.name),
  }));
  const translatedStatusOptions = translateProjectStatusOptions(t);

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === project.id),
    [tasks, project.id],
  );

  // Derive "mixed" status the same way ProjectsView does
  const derivedBillingType: BillingType = useMemo(() => {
    if (project.billingType === 'mixed') return 'mixed';
    const stored = toStoredBillingType(project.billingType);
    const taskTypes = new Set(projectTasks.map((t) => t.billingType ?? DEFAULT_BILLING_TYPE));
    if (taskTypes.size === 0) return stored;
    if (taskTypes.size > 1) return 'mixed';
    return taskTypes.has(stored) ? stored : 'mixed';
  }, [project.billingType, projectTasks]);

  const projectBillingTypeOptions =
    derivedBillingType === 'mixed'
      ? [
          ...translatedBillingTypeOptions,
          { id: 'mixed', name: t('projects:projects.billingTypes.mixed') },
        ]
      : translatedBillingTypeOptions;
  const storedBillingType = toStoredBillingType(project.billingType);
  const billingType = billingTypeDraft ?? storedBillingType;
  const billingFrequency =
    billingFrequencyDraft ?? project.billingFrequency ?? DEFAULT_BILLING_FREQUENCY;
  const displayedBillingType = derivedBillingType === 'mixed' ? derivedBillingType : billingType;
  const projectBillingChanged =
    billingTypeDraft !== null ||
    (billingFrequencyDraft !== null &&
      billingFrequencyDraft !== (project.billingFrequency ?? DEFAULT_BILLING_FREQUENCY));
  const companyDisplayName = companyName?.trim() || 'PRAETOR';

  const isInternalProject = tipo === 'interno';
  const linkedOrder = orderId ? orders.find((o) => o.id === orderId) : undefined;
  const client = clients.find((c) => c.id === clientId);
  const isClientDisabled = client?.isDisabled ?? false;
  const isCurrentlyDisabled = tempIsDisabled || isClientDisabled;

  // Revenue precedence (mirrors ProjectsView create-flow):
  //   activitiesRevenueSum > 0 → revenue is the sum (read-only);
  //   else → manual entry.
  // Persisting the manual `revenue` field only matters in the 'manual' branch — otherwise
  // it's recomputed on read, and writing it would shadow/override the derived value.
  const activitiesRevenueSum = sumActivityRevenue(projectTasks);
  const revenueSource = resolveRevenueSource(activitiesRevenueSum);
  const revenueBySource: Record<RevenueSource, number> = {
    activities: activitiesRevenueSum,
    manual: revenue ? parseFloat(revenue) : 0,
  };
  const displayedRevenue = revenueBySource[revenueSource];
  const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;
  const revenueHintBySource: Partial<Record<RevenueSource, string>> = {
    activities: t('projects:projects.revenueFromActivities'),
  };

  // Budget % is meaningful only when cost is visible, entries loaded, AND revenue is
  // non-zero. Denominator uses `displayedRevenue` (derived from activities sum / manual)
  // so the KPI reflects what the user sees in the revenue field — `project.revenue` lags for
  // activity-derived revenue because we only persist it when source==='manual'.
  const budgetUsedPct = useMemo(() => {
    if (!canViewCost) return null;
    if (entriesError !== null) return null;
    if (!displayedRevenue || displayedRevenue <= 0) return null;
    return Math.round((totalCost / displayedRevenue) * 100);
  }, [canViewCost, entriesError, displayedRevenue, totalCost]);

  // Order locks the client — server enforces FK against the order's client, so let the UI
  // mirror it instead of allowing a save that the API will reject.
  const isClientLockedByOrder = !isInternalProject && Boolean(orderId);

  // A manager who lacks `timesheets.tracker_all.view` only sees entries from themselves and
  // their managed users, so chart totals exclude any teammate outside that scope. Surface a
  // small note so totals aren't read as project-wide.
  const canViewAllEntries = hasPermission(permissions, 'timesheets.tracker_all.view');
  const isPartialEntryScope = !canViewAllEntries && entriesError === null;

  // Compare revenue numerically so trailing zeros ('100.50' vs server-normalized '100.5')
  // don't keep the sticky save bar visible after a successful save.
  const revenueNumber = revenue.trim() === '' ? null : parseFloat(revenue);
  const projectRevenueNumber =
    project.revenue !== null && project.revenue !== undefined ? Number(project.revenue) : null;
  const revenueChanged =
    Number.isFinite(revenueNumber as number) || revenueNumber === null
      ? revenueNumber !== projectRevenueNumber
      : true; // non-numeric input is a "change" that will surface its own validation later
  const hasChanges =
    name !== project.name ||
    clientId !== project.clientId ||
    description !== (project.description ?? '') ||
    startDate !== (project.startDate ?? '') ||
    endDate !== (project.endDate ?? '') ||
    orderId !== (project.orderId ?? '') ||
    offerId !== (project.offerId ?? '') ||
    revenueChanged ||
    tempIsDisabled !== (project.isDisabled ?? false) ||
    status !== baselineStatus ||
    projectBillingChanged ||
    // For an unconfirmed project baselineTipo is '', so picking a value (or any other edit)
    // raises the save bar; for a confirmed project this fires only on an actual tipo change.
    tipo !== baselineTipo;

  const clearStaleClientLinks = (nextClientId: string, keep: 'order' | 'offer' | null) => {
    if (keep !== 'offer' && offerId) {
      const currentOffer = offers.find((o) => o.id === offerId);
      if (!currentOffer || currentOffer.clientId !== nextClientId) {
        setOfferId('');
        if (errors.offerId) setErrors((prev) => ({ ...prev, offerId: '' }));
      }
    }
    if (keep !== 'order' && orderId) {
      const currentOrder = orders.find((o) => o.id === orderId);
      if (!currentOrder || currentOrder.clientId !== nextClientId) {
        setOrderId('');
        if (errors.orderId) setErrors((prev) => ({ ...prev, orderId: '' }));
      }
    }
  };

  const requestTipoChange = (nextTipo: ProjectTipo) => {
    if (nextTipo === 'interno' && (orderId || offerId)) {
      setIsInternalConversionOpen(true);
      return;
    }
    setTipo(nextTipo);
    if (nextTipo === 'interno') {
      setErrors((previous) => ({
        ...previous,
        tipo: '',
        startDate: '',
        endDate: '',
        dateRange: '',
      }));
    } else if (errors.tipo) {
      setErrors((previous) => ({ ...previous, tipo: '' }));
    }
  };

  const confirmInternalConversion = () => {
    setTipo('interno');
    setOrderId('');
    setOfferId('');
    setErrors((previous) => ({
      ...previous,
      tipo: '',
      orderId: '',
      offerId: '',
      startDate: '',
      endDate: '',
      dateRange: '',
    }));
    setIsInternalConversionOpen(false);
  };

  const handleDiscard = () => {
    dispatchForm({ type: 'reset', project });
    setOrderId(project.orderId ?? '');
    setBillingTypeDraft(null);
    setBillingFrequencyDraft(null);
    setIsInternalConversionOpen(false);
  };

  const handleSave = async () => {
    if (!canUpdateProjects) return;
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = t('common:validation.projectNameRequired');
    if (!isInternalProject && !clientId) newErrors.clientId = t('projects:projects.clientRequired');
    if (!isInternalProject && !orderId) newErrors.orderId = t('projects:projects.orderRequired');
    // Existing commercial projects keep the legacy-compatible rule: a missing stored date does
    // not block unrelated edits. Internal projects may always clear dates, while converting one
    // back to a commercial type requires a complete planning window in the same save.
    const isConvertingInternalToCommercial = project.tipo === 'interno' && !isInternalProject;
    if (
      !isInternalProject &&
      (project.startDate || isConvertingInternalToCommercial) &&
      !startDate
    ) {
      newErrors.startDate = t('projects:projects.startDateRequired');
    }
    if (!isInternalProject && (project.endDate || isConvertingInternalToCommercial) && !endDate) {
      newErrors.endDate = t('projects:projects.endDateRequired');
    }
    if (startDate && endDate && startDate > endDate) {
      newErrors.dateRange = t('projects:projects.dateRangeInvalid');
    }
    // Force a deliberate tipo choice before saving: required for confirmed projects and the
    // forced first-edit confirmation for rollout-defaulted ones (issue #784).
    if (!tipo) newErrors.tipo = t('projects:projects.tipoConfirmRequired');
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    const updates: Partial<Project> = {
      name,
      clientId: isInternalProject ? undefined : clientId,
      description,
      isDisabled: tempIsDisabled,
      orderId: isInternalProject ? null : orderId,
      offerId: isInternalProject ? null : offerId || null,
      startDate: startDate || null,
      endDate: endDate || null,
      // Guaranteed non-empty by the `!tipo` guard above. Sending it confirms the field
      // server-side (tipo_confirmed = true), clearing the forced-confirmation state.
      tipo: tipo as ProjectTipo,
      status,
    };
    // Only touch `revenue` when the source is manual: activity-derived values are
    // recomputed on read. Sending `null` here would
    // wipe a previously stored manual revenue any time the user saves an unrelated
    // field while activities momentarily satisfy the precedence.
    if (revenueSource === 'manual') {
      updates.revenue = persistedRevenue ?? null;
    }
    if (derivedBillingType !== 'mixed') {
      updates.billingType = billingType;
      updates.billingFrequency = billingFrequency;
    } else if (projectBillingChanged) {
      // A mixed project has no single billing type to set, but its frequency is a real
      // project-level value (inherited by quick-added tasks), so persist a frequency edit
      // without touching the derived/mixed type.
      updates.billingFrequency = billingFrequency;
    }
    // Await so we can clear the billing-change latch only on success. Every other
    // hasChanges contributor compares local state to project.* (so a rejected save
    // naturally keeps the save bar up). Billing uses a latching boolean — clearing
    // it eagerly would hide the save bar even when the update never persisted.
    // The parent handler catches and toasts errors itself, returning `null` on
    // failure (mirroring `add`), so we branch on the result rather than try/catch.
    const result = await onUpdateProject(project.id, updates);
    if (result !== null) {
      setBillingTypeDraft(null);
      setBillingFrequencyDraft(null);
    }
  };

  const handleDelete = () => {
    if (!canDeleteProjects) return;
    onDeleteProject(project.id);
    setIsDeleteConfirmOpen(false);
    onBack();
  };

  const handleAddTask = async () => {
    if (!canCreateTasks) return;
    await onAddTask(t('projects:detail.newTaskDefaultName'), project.id);
  };

  const handleConfirmDeleteTask = () => {
    if (!taskToDelete) return;
    onDeleteTask(taskToDelete.id);
    setTaskToDelete(null);
    setIsTaskDeleteConfirmOpen(false);
  };

  // Chart configs (theme-aware via --chart-N). One series per displayed task —
  // the legend lists task names, and var(--color-<seriesKey>) feeds each Bar.
  const userTaskChartConfig: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    for (const s of hoursByUserTask.series) {
      cfg[s.seriesKey] = { label: s.name, color: s.color };
    }
    return cfg;
  }, [hoursByUserTask.series]);

  const activityChartConfig: ChartConfig = {
    hours: { label: t('projects:detail.charts.hoursLabel'), color: 'var(--chart-2)' },
  };

  // Each task renders as a single utilization bar that stacks logged hours over
  // the remaining available effort (so the full bar height = total effort), with
  // any overrun on top. Three semantic series share one legend across all tasks
  // (we no longer cycle a per-task palette — the colors now mean logged / spare /
  // over, not "which task").
  const taskChartConfig: ChartConfig = {
    logged: { label: t('projects:detail.charts.loggedLabel'), color: 'var(--chart-1)' },
    remaining: {
      label: t('projects:detail.charts.remainingEffortLabel'),
      color: 'var(--muted-foreground)',
    },
    over: { label: t('projects:detail.charts.overBudgetLabel'), color: 'var(--destructive)' },
  };

  const budgetChartConfig: ChartConfig = {
    cumulativeCost: {
      label: t('projects:detail.charts.cumulativeCostLabel'),
      color: 'var(--chart-3)',
    },
    revenue: {
      label: t('projects:detail.charts.revenueLabel'),
      color: 'var(--chart-1)',
    },
  };

  // Days elapsed vs total project duration, derived from project.startDate /
  // project.endDate. Null when either date is missing — we render an explicit
  // "set dates" empty state instead of a misleading 0% bar.
  const projectTimeline = useMemo(() => {
    if (!project.startDate || !project.endDate) return null;
    const start = new Date(`${project.startDate}T00:00:00`);
    const end = new Date(`${project.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const MS_PER_DAY = 86400000;
    // +1 so a project that spans day N → day N counts as 1 day, not 0.
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1);
    const rawElapsed = Math.round((today.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    const elapsedDays = Math.max(0, Math.min(totalDays, rawElapsed));
    const remainingDays = Math.max(0, totalDays - elapsedDays);
    const pct = (elapsedDays / totalDays) * 100;
    const phase: 'pending' | 'inProgress' | 'completed' =
      today < start ? 'pending' : today > end ? 'completed' : 'inProgress';
    return { totalDays, elapsedDays, remainingDays, pct, phase, start, end };
  }, [project.startDate, project.endDate]);

  const assignedUserIdSet = new Set(assignedUserIds);
  const assignedUsers = users.filter((u) => assignedUserIdSet.has(u.id));
  // Use the filtered list so the count and the avatar row always agree; an assigned-but-
  // missing-from-`users` id is invisible in the UI, so it shouldn't inflate the KPI.
  const teamSize = assignedUsers.length;
  const assignableUsers = users.filter(
    (u) => !u.hasTopManagerRole && !u.isAdminOnly && !u.isDisabled,
  );

  return {
    t,
    i18n,
    project,
    orders,
    roles,
    permissions,
    currency,
    onBack,
    onUpdateTask,
    onViewOrder,
    canUpdateProjects,
    canDeleteProjects,
    canCreateTasks,
    canUpdateTasks,
    canDeleteTasks,
    canManageAssignments,
    companyDisplayName,
    canViewCost,
    name,
    clientId,
    description,
    startDate,
    endDate,
    orderId,
    offerId,
    revenue,
    tempIsDisabled,
    status,
    tipo,
    errors,
    setName,
    setClientId,
    setDescription,
    setStartDate,
    setEndDate,
    setOrderId,
    setOfferId,
    setRevenue,
    setTempIsDisabled,
    setStatus,
    setErrors,
    entries,
    entriesLoading,
    entriesTruncated,
    entriesError,
    assignedLoading,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    taskToDelete,
    setTaskToDelete,
    isTaskDeleteConfirmOpen,
    setIsTaskDeleteConfirmOpen,
    isAssignmentsOpen,
    setIsAssignmentsOpen,
    isInternalConversionOpen,
    setIsInternalConversionOpen,
    confirmInternalConversion,
    setAssignedUserIds,
    isInternalProject,
    requestTipoChange,
    isClientDisabled,
    linkedOrder,
    orderOptions,
    clientOptions,
    isClientLockedByOrder,
    clearStaleClientLinks,
    offerOptions,
    revenueSource,
    displayedRevenue,
    revenueHintBySource,
    translatedTipoOptions,
    translatedStatusOptions,
    tipoNeedsConfirmation,
    projectBillingTypeOptions,
    displayedBillingType,
    setBillingTypeDraft,
    derivedBillingType,
    translatedBillingFrequencyOptions,
    billingFrequency,
    setBillingFrequencyDraft,
    client,
    isCurrentlyDisabled,
    projectTasks,
    handleAddTask,
    hasChanges,
    handleDiscard,
    handleSave,
    isPartialEntryScope,
    dashboard,
    activeWidgetDefs,
    widgetPermitted,
    totalHours,
    totalCost,
    assignedUsers,
    teamSize,
    budgetUsedPct,
    projectTimeline,
    hoursByUserTask,
    userTaskChartConfig,
    hoursByTask,
    taskChartConfig,
    costOverTime,
    budgetChartConfig,
    monthlyActivity,
    activityChartConfig,
    handleDelete,
    handleConfirmDeleteTask,
    assignableUsers,
  };
};

type ProjectDetailController = ReturnType<typeof useProjectDetailController>;

const ProjectDetailView: React.FC<ProjectDetailViewProps> = (props) => {
  // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Custom-hook invocation is misclassified as a state updater.
  const controller = useProjectDetailController(props);
  return <ProjectDetailLayout controller={controller} />;
};

const ProjectDetailLayout: React.FC<{ controller: ProjectDetailController }> = ({ controller }) => (
  <div className="space-y-6">
    <ProjectDetailHeader controller={controller} />
    <ProjectDetailTopSection controller={controller} />
    <ProjectDetailTasksSection controller={controller} />
    <ProjectDetailSaveBar controller={controller} />
    <ProjectAnalyticsSection controller={controller} />
    <ProjectDetailModals controller={controller} />
  </div>
);

const ProjectDetailHeader: React.FC<{ controller: ProjectDetailController }> = ({ controller }) => {
  const {
    t,
    i18n,
    project,
    onBack,
    isClientDisabled,
    canManageAssignments,
    setIsAssignmentsOpen,
    canDeleteProjects,
    setIsDeleteConfirmOpen,
  } = controller;
  const projectStatus = project.status ?? LEGACY_PROJECT_STATUS;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true"></i>
          {t('projects:detail.actions.back')}
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{project.name}</h1>
          <StatusBadge
            type={getProjectStatusBadgeType(project.status)}
            label={t(`projects:projects.statusValues.${projectStatus}`)}
            icon={getProjectStatusIcon(project.status, 'size-[1em]')}
          />
          {project.isDisabled && (
            <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />
          )}
          {!project.isDisabled && isClientDisabled && (
            <StatusBadge type="inherited" label={t('projects:projects.statusInheritedDisable')} />
          )}
          {project.createdAt && (
            <span className="text-xs text-muted-foreground">
              {t('projects:detail.createdOn', {
                date: formatInsertDate(project.createdAt, i18n.language),
              })}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canManageAssignments && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsAssignmentsOpen(true)}
          >
            <i className="fa-solid fa-users text-xs" aria-hidden="true"></i>
            <span className="ml-2">{t('projects:projects.manageMembers')}</span>
          </Button>
        )}
        {canDeleteProjects && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsDeleteConfirmOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            <i className="fa-solid fa-trash-can text-xs" aria-hidden="true"></i>
            <span className="ml-2">{t('common:buttons.delete')}</span>
          </Button>
        )}
      </div>
    </div>
  );
};

const ProjectDetailTopSection: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => (
  <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
    <ProjectDetailForm controller={controller} />
    <ProjectRules
      projectId={controller.project.id}
      permissions={controller.permissions}
      className="xl:col-span-3"
    />
  </div>
);

const ProjectDetailForm: React.FC<{ controller: ProjectDetailController }> = ({ controller }) => (
  <div className="xl:col-span-2 self-start space-y-6">
    <ProjectDetailFormIntro controller={controller} />
    <ProjectDetailLinkedOrderBanner controller={controller} />
    <ProjectDetailFieldsGrid controller={controller} />
    <Separator />
    <ProjectDetailDisabledSection controller={controller} />
  </div>
);

const ProjectDetailFormIntro: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => (
  <div className="space-y-1.5">
    <h2 className="text-base font-semibold leading-none">
      {controller.t('projects:detail.detailsTitle')}
    </h2>
    <p className="text-sm text-muted-foreground">
      {controller.t('projects:detail.detailsDescription')}
    </p>
  </div>
);

const ProjectDetailLinkedOrderBanner: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, linkedOrder, onViewOrder, isInternalProject } = controller;
  if (isInternalProject || !linkedOrder) return null;

  return (
    <LinkedRecordBanner
      label={t('projects:projects.linkedOrder')}
      value={formatOrderId(linkedOrder.id) + ' · ' + linkedOrder.clientName}
      action={
        onViewOrder
          ? {
              label: t('projects:projects.viewOrder'),
              onClick: () => onViewOrder(linkedOrder.id),
            }
          : undefined
      }
    />
  );
};

const ProjectDetailFieldsGrid: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => (
  <div className="grid gap-4 md:grid-cols-2">
    <ProjectDetailTipoField controller={controller} />
    {!controller.isInternalProject && <ProjectDetailOrderField controller={controller} />}
    <ProjectDetailClientField controller={controller} />
    <ProjectDetailNameField controller={controller} />
    <ProjectDetailDescriptionField controller={controller} />
    <ProjectDetailStartDateField controller={controller} />
    <ProjectDetailEndDateField controller={controller} />
    <ProjectDetailDateRangeError controller={controller} />
    {!controller.isInternalProject && <ProjectDetailOfferField controller={controller} />}
    <ProjectDetailRevenueField controller={controller} />
    <ProjectDetailStatusField controller={controller} />
    <ProjectDetailBillingTypeField controller={controller} />
    <ProjectDetailBillingFrequencyField controller={controller} />
  </div>
);

const ProjectDetailOrderField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    orderOptions,
    orderId,
    setOrderId,
    errors,
    setErrors,
    orders,
    setClientId,
    clearStaleClientLinks,
    canUpdateProjects,
  } = controller;
  return (
    <div className="space-y-1.5">
      <SelectControl
        id="detail-order"
        options={orderOptions}
        value={orderId}
        onChange={(val) => {
          const nextOrderId = val as string;
          setOrderId(nextOrderId);
          if (errors.orderId) setErrors((prev) => ({ ...prev, orderId: '' }));
          const nextOrder = orders.find((o) => o.id === nextOrderId);
          if (!nextOrder) return;
          setClientId(nextOrder.clientId);
          if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
          clearStaleClientLinks(nextOrder.clientId, 'order');
        }}
        label={
          <>
            {t('projects:projects.order')} <RequiredMark />
          </>
        }
        placeholder={t('projects:projects.selectOrder')}
        searchable
        buttonClassName="h-9"
        disabled={!canUpdateProjects}
      />
      <FieldError className="text-xs">{errors.orderId}</FieldError>
    </div>
  );
};

const ProjectDetailClientField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  if (controller.isInternalProject) {
    return (
      <Field>
        <FieldLabel htmlFor="detail-client">
          {controller.t('projects:projects.client')} <RequiredMark />
        </FieldLabel>
        <Input
          id="detail-client"
          value={controller.companyDisplayName}
          readOnly
          aria-readonly="true"
          className="bg-muted/40 text-foreground"
        />
        <FieldDescription>{controller.t('projects:projects.internalClientHint')}</FieldDescription>
      </Field>
    );
  }
  const {
    t,
    clientOptions,
    clientId,
    setClientId,
    errors,
    setErrors,
    clearStaleClientLinks,
    canUpdateProjects,
    isClientLockedByOrder,
    linkedOrder,
  } = controller;
  return (
    <div className="space-y-1.5">
      <SelectControl
        id="detail-client"
        options={clientOptions}
        value={clientId}
        onChange={(val) => {
          const nextClientId = val as string;
          setClientId(nextClientId);
          if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
          clearStaleClientLinks(nextClientId, null);
        }}
        label={
          <>
            {t('projects:projects.client')} <RequiredMark />
          </>
        }
        placeholder={t('projects:projects.selectClient')}
        searchable
        buttonClassName="h-9"
        disabled={!canUpdateProjects || isClientLockedByOrder}
      />
      <FieldError className="text-xs">{errors.clientId}</FieldError>
      {isClientLockedByOrder && linkedOrder && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <i className="fa-solid fa-link text-xs text-muted-foreground" aria-hidden="true"></i>
          <span className="text-xs text-muted-foreground">
            {t('projects:projects.inheritedClientLabel')}:
          </span>
          <span className="text-xs font-medium text-foreground">{linkedOrder.clientName}</span>
        </div>
      )}
    </div>
  );
};

const ProjectDetailNameField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, errors, setErrors, name, setName, canUpdateProjects } = controller;

  return (
    <Field data-invalid={Boolean(errors.name)}>
      <FieldLabel htmlFor="detail-name">
        {t('projects:projects.name')} <RequiredMark />
      </FieldLabel>
      <Input
        id="detail-name"
        type="text"
        value={name}
        aria-invalid={Boolean(errors.name)}
        disabled={!canUpdateProjects}
        onChange={(e) => {
          setName(e.target.value);
          if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
        }}
        placeholder={t('projects:projects.projectNamePlaceholder')}
      />
      <FieldError className="text-xs">{errors.name}</FieldError>
    </Field>
  );
};

const ProjectDetailDescriptionField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, description, setDescription, canUpdateProjects } = controller;

  return (
    <Field className="md:col-span-2">
      <FieldLabel htmlFor="detail-description">{t('projects:projects.description')}</FieldLabel>
      <Textarea
        id="detail-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('projects:projects.descriptionPlaceholder')}
        disabled={!canUpdateProjects}
        rows={2}
        className="min-h-16 resize-none"
      />
    </Field>
  );
};

const ProjectDetailStartDateField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    project,
    startDate,
    setStartDate,
    canUpdateProjects,
    errors,
    setErrors,
    isInternalProject,
  } = controller;
  const isRequired =
    !isInternalProject && (Boolean(project.startDate) || project.tipo === 'interno');

  return (
    <Field data-invalid={Boolean(errors.startDate || errors.dateRange)}>
      <FieldLabel htmlFor="detail-start-date">
        {t('projects:projects.startDate')} {isRequired && <RequiredMark />}
      </FieldLabel>
      <DateField
        id="detail-start-date"
        value={startDate}
        required={isRequired}
        disabled={!canUpdateProjects}
        aria-invalid={Boolean(errors.startDate || errors.dateRange)}
        onChange={(value) => {
          setStartDate(value);
          if (errors.startDate || errors.dateRange) {
            setErrors((prev) => ({ ...prev, startDate: '', dateRange: '' }));
          }
        }}
      />
      <FieldError className="text-xs">{errors.startDate}</FieldError>
    </Field>
  );
};

const ProjectDetailEndDateField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    project,
    endDate,
    setEndDate,
    canUpdateProjects,
    errors,
    setErrors,
    isInternalProject,
  } = controller;
  const isRequired = !isInternalProject && (Boolean(project.endDate) || project.tipo === 'interno');

  return (
    <Field data-invalid={Boolean(errors.endDate || errors.dateRange)}>
      <FieldLabel htmlFor="detail-end-date">
        {t('projects:projects.endDate')} {isRequired && <RequiredMark />}
      </FieldLabel>
      <DateField
        id="detail-end-date"
        value={endDate}
        required={isRequired}
        disabled={!canUpdateProjects}
        aria-invalid={Boolean(errors.endDate || errors.dateRange)}
        onChange={(value) => {
          setEndDate(value);
          if (errors.endDate || errors.dateRange) {
            setErrors((prev) => ({ ...prev, endDate: '', dateRange: '' }));
          }
        }}
      />
      <FieldError className="text-xs">{errors.endDate}</FieldError>
    </Field>
  );
};

const ProjectDetailDateRangeError: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) =>
  controller.errors.dateRange ? (
    <FieldError className="md:col-span-2 text-xs">{controller.errors.dateRange}</FieldError>
  ) : null;

const ProjectDetailOfferField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, offerOptions, offerId, setOfferId, errors, setErrors, canUpdateProjects } = controller;

  return (
    <div className="space-y-1.5">
      <SelectControl
        id="detail-offer"
        options={offerOptions}
        value={offerId}
        onChange={(val) => {
          setOfferId(val as string);
          if (errors.offerId) setErrors((prev) => ({ ...prev, offerId: '' }));
        }}
        label={t('projects:projects.offerOptionalLabel')}
        placeholder={t('projects:projects.selectOffer')}
        searchable
        buttonClassName="h-9"
        disabled={!canUpdateProjects}
      />
      <FieldError className="text-xs">{errors.offerId}</FieldError>
    </div>
  );
};

const ProjectDetailRevenueField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    currency,
    revenueSource,
    revenue,
    displayedRevenue,
    setRevenue,
    revenueHintBySource,
    canUpdateProjects,
  } = controller;
  return (
    <Field>
      <FieldLabel htmlFor="detail-revenue">
        {`${t('projects:projects.projectRevenue')} (${currency})`}
      </FieldLabel>
      <ValidatedNumberInput
        id="detail-revenue"
        min="0"
        placeholder="0,00"
        disabled={!canUpdateProjects}
        value={revenueSource === 'manual' ? revenue : displayedRevenue}
        formatDecimals={2}
        readOnly={revenueSource !== 'manual'}
        onValueChange={setRevenue}
      />
      {revenueHintBySource[revenueSource] && (
        <p className="text-xs text-muted-foreground">{revenueHintBySource[revenueSource]}</p>
      )}
    </Field>
  );
};

const ProjectDetailTipoField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    translatedTipoOptions,
    tipo,
    requestTipoChange,
    errors,
    tipoNeedsConfirmation,
    canUpdateProjects,
  } = controller;
  return (
    <div className="space-y-1.5">
      <SelectControl
        id="detail-tipo"
        options={translatedTipoOptions}
        value={tipo}
        onChange={(val) => requestTipoChange(val as ProjectTipo)}
        label={
          <>
            {t('projects:projects.tipo')} <RequiredMark />
          </>
        }
        placeholder={t('projects:projects.selectTipo')}
        searchable={false}
        buttonClassName="h-9"
        disabled={!canUpdateProjects}
      />
      {tipoNeedsConfirmation && !tipo && !errors.tipo && (
        <p className="flex items-center gap-1 text-[10px] font-medium text-amber-600">
          <i className="fa-solid fa-circle-info" aria-hidden="true"></i>
          {t('projects:projects.tipoConfirmHint')}
        </p>
      )}
      <FieldError className="text-xs">{errors.tipo}</FieldError>
    </div>
  );
};

const ProjectDetailStatusField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, translatedStatusOptions, status, setStatus, canUpdateProjects } = controller;

  return (
    <SelectControl
      id="detail-status"
      options={translatedStatusOptions}
      value={status}
      onChange={(value) => setStatus(value as ProjectStatus)}
      label={t('projects:projects.status')}
      labelAccessory={<ProjectStatusInfoTooltip t={t} />}
      required
      placeholder={t('projects:projects.selectStatus')}
      searchable={false}
      buttonClassName="h-9"
      disabled={!canUpdateProjects}
    />
  );
};
const ProjectDetailBillingTypeField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    projectBillingTypeOptions,
    displayedBillingType,
    setBillingTypeDraft,
    derivedBillingType,
    canUpdateProjects,
  } = controller;
  return (
    <SelectControl
      id="detail-billing-type"
      options={projectBillingTypeOptions}
      value={displayedBillingType}
      onChange={(val) => {
        setBillingTypeDraft(val as StoredBillingType);
      }}
      label={t('projects:projects.billingType')}
      disabled={!canUpdateProjects || derivedBillingType === 'mixed'}
      searchable={false}
      buttonClassName="h-9"
    />
  );
};

const ProjectDetailBillingFrequencyField: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    translatedBillingFrequencyOptions,
    billingFrequency,
    setBillingFrequencyDraft,
    canUpdateProjects,
  } = controller;
  return (
    <SelectControl
      id="detail-billing-frequency"
      options={translatedBillingFrequencyOptions}
      value={billingFrequency}
      onChange={(val) => {
        setBillingFrequencyDraft(val as BillingFrequency);
      }}
      label={t('projects:projects.billingFrequency')}
      disabled={!canUpdateProjects}
      searchable={false}
      buttonClassName="h-9"
    />
  );
};

const ProjectDetailDisabledSection: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    isClientDisabled,
    client,
    isCurrentlyDisabled,
    canUpdateProjects,
    tempIsDisabled,
    setTempIsDisabled,
  } = controller;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel>{t('projects:projects.projectDisabled')}</FieldLabel>
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
          <div>
            <p
              className={`text-sm font-medium ${
                isClientDisabled ? 'text-muted-foreground' : 'text-foreground'
              }`}
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
              if (!isClientDisabled && canUpdateProjects) {
                setTempIsDisabled(!tempIsDisabled);
              }
            }}
            disabled={isClientDisabled || !canUpdateProjects}
          />
        </div>
      </Field>
    </div>
  );
};

const ProjectDetailTasksSection: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    project,
    projectTasks,
    currency,
    canCreateTasks,
    canUpdateTasks,
    canDeleteTasks,
    handleAddTask,
    onUpdateTask,
    setTaskToDelete,
    setIsTaskDeleteConfirmOpen,
  } = controller;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold leading-none">
          {t('projects:projects.projectTasks')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('projects:detail.tasksDescription')}</p>
      </div>
      <ProjectTasksTable
        projectId={project.id}
        tasks={projectTasks}
        currency={currency}
        canCreate={canCreateTasks}
        canUpdate={canUpdateTasks}
        canDelete={canDeleteTasks}
        onAddTask={handleAddTask}
        onUpdateTask={onUpdateTask}
        onRequestDeleteTask={(task) => {
          setTaskToDelete(task);
          setIsTaskDeleteConfirmOpen(true);
        }}
      />
    </div>
  );
};

const ProjectDetailSaveBar: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, hasChanges, canUpdateProjects, handleDiscard, handleSave } = controller;
  const showSaveBar = hasChanges && canUpdateProjects;
  if (!showSaveBar) return null;

  return (
    <div className="sticky bottom-4 z-20 mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
      <span className="text-sm text-muted-foreground">
        <i className="fa-solid fa-circle-info text-xs mr-2" aria-hidden="true"></i>
        {t('projects:detail.unsavedChanges')}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleDiscard}>
          {t('common:buttons.cancel')}
        </Button>
        <Button type="button" size="sm" onClick={handleSave}>
          {t('common:buttons.update')}
        </Button>
      </div>
    </div>
  );
};

const ProjectAnalyticsSection: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => (
  <>
    <ProjectAnalyticsHeader controller={controller} />
    <ProjectAnalyticsGrid controller={controller} />
  </>
);

// Analytics section header
const ProjectAnalyticsHeader: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, entriesLoading, entriesError, entriesTruncated, isPartialEntryScope, dashboard } =
    controller;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold leading-none">
          {t('projects:detail.analyticsTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('projects:detail.analyticsDescription')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {!entriesLoading && entriesError === 'forbidden' && (
          <ProjectForbiddenAnalyticsNotice controller={controller} />
        )}
        {!entriesLoading && entriesError === 'failed' && (
          <ProjectLoadFailedAnalyticsNotice controller={controller} />
        )}
        {!entriesLoading && entriesError === null && (entriesTruncated || isPartialEntryScope) && (
          <ProjectScopeNotice controller={controller} />
        )}
        <DashboardControls controls={dashboard} />
      </div>
    </div>
  );
};

const ProjectForbiddenAnalyticsNotice: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t } = controller;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('projects:detail.notices.forbiddenDescription')}
          className="inline-flex max-w-full cursor-help items-center gap-2 rounded-md border border-amber-300/50 bg-amber-50 px-2.5 py-1.5 text-left text-xs text-amber-800 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200 sm:max-w-xs"
        >
          <i className="fa-solid fa-lock shrink-0" aria-hidden="true"></i>
          <span className="truncate font-medium">
            {t('projects:detail.notices.forbiddenTitle')}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('projects:detail.notices.forbiddenDescription')}</TooltipContent>
    </Tooltip>
  );
};

const ProjectLoadFailedAnalyticsNotice: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t } = controller;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('projects:detail.notices.loadFailedDescription')}
          className="inline-flex max-w-full cursor-help items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-left text-xs text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:max-w-xs"
        >
          <i className="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span className="truncate font-medium">
            {t('projects:detail.notices.loadFailedTitle')}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('projects:detail.notices.loadFailedDescription')}</TooltipContent>
    </Tooltip>
  );
};

const ProjectScopeNotice: React.FC<{ controller: ProjectDetailController }> = ({ controller }) => {
  const { t, entriesTruncated, isPartialEntryScope } = controller;
  const messages = [
    entriesTruncated
      ? t('projects:detail.notices.truncated', { count: ENTRIES_FETCH_CEILING })
      : null,
    isPartialEntryScope ? t('projects:detail.notices.partialScope') : null,
  ].filter(Boolean);
  const messageText = messages.filter(Boolean).join(' · ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={messageText}
          className="inline-flex max-w-full cursor-help items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:max-w-md"
        >
          <i className="fa-solid fa-circle-info shrink-0" aria-hidden="true"></i>
          <span className="truncate">{messageText}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          {entriesTruncated && (
            <div>{t('projects:detail.notices.truncated', { count: ENTRIES_FETCH_CEILING })}</div>
          )}
          {isPartialEntryScope && <div>{t('projects:detail.notices.partialScope')}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

// Free-form analytics grid
const ProjectAnalyticsGrid: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { dashboard, activeWidgetDefs } = controller;

  return (
    <DashboardGrid
      layout={dashboard.layout}
      defs={activeWidgetDefs}
      editing={dashboard.editing}
      onMove={dashboard.moveWidget}
      onResize={dashboard.resizeWidget}
      onToggleHidden={dashboard.toggleHidden}
    >
      <ProjectKpiDashboardItems controller={controller} />
      <ProjectTimelineDashboardItem controller={controller} />
      <ProjectHoursByUserDashboardItem controller={controller} />
      <ProjectHoursByTaskDashboardItem controller={controller} />
      <ProjectCostVsRevenueDashboardItem controller={controller} />
      <ProjectMonthlyActivityDashboardItem controller={controller} />
    </DashboardGrid>
  );
};

// KPI cards + project timeline
const ProjectKpiDashboardItems: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    currency,
    widgetPermitted,
    entriesLoading,
    entriesError,
    entries,
    totalHours,
    totalCost,
    assignedLoading,
    assignedUsers,
    teamSize,
    budgetUsedPct,
    displayedRevenue,
  } = controller;
  return (
    <>
      <DashboardItem id="totalHours" title={t('projects:detail.kpi.totalHours')}>
        <KpiCard
          title={t('projects:detail.kpi.totalHours')}
          icon="fa-clock"
          accent="blue"
          loading={entriesLoading}
          unavailable={entriesError !== null}
          value={
            <>
              {formatNumber(totalHours, { maximumFractionDigits: 1 })}
              <span className="ml-1 text-base font-medium text-muted-foreground">h</span>
            </>
          }
          subtitle={
            entries.length > 0
              ? t('projects:detail.kpi.totalHoursSubtitle', { count: entries.length })
              : undefined
          }
        />
      </DashboardItem>
      {widgetPermitted('totalCost') && (
        <DashboardItem id="totalCost" title={t('projects:detail.kpi.totalCost')}>
          <KpiCard
            title={t('projects:detail.kpi.totalCost')}
            icon="fa-coins"
            accent="emerald"
            loading={entriesLoading}
            unavailable={entriesError !== null}
            value={
              <>
                <span className="mr-1 text-base font-medium text-muted-foreground">{currency}</span>
                {formatNumber(totalCost, {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                })}
              </>
            }
            subtitle={
              totalHours > 0
                ? t('projects:detail.kpi.totalCostSubtitle', {
                    rate: formatNumber(totalCost / totalHours, {
                      maximumFractionDigits: 2,
                    }),
                    currency,
                  })
                : undefined
            }
          />
        </DashboardItem>
      )}
      {widgetPermitted('teamSize') && (
        <DashboardItem id="teamSize" title={t('projects:detail.kpi.teamSize')}>
          <KpiCard
            title={t('projects:detail.kpi.teamSize')}
            icon="fa-users"
            accent="violet"
            loading={assignedLoading}
            value={teamSize}
            subtitle={teamSize > 0 ? t('projects:detail.kpi.teamSizeSubtitle') : undefined}
            footer={<ProjectTeamAvatars assignedUsers={assignedUsers} loading={assignedLoading} />}
          />
        </DashboardItem>
      )}
      {widgetPermitted('budgetUsed') && (
        <DashboardItem id="budgetUsed" title={t('projects:detail.kpi.budgetUsed')}>
          <KpiCard
            title={t('projects:detail.kpi.budgetUsed')}
            icon="fa-chart-pie"
            accent={
              budgetUsedPct === null
                ? 'amber'
                : budgetUsedPct > 100
                  ? 'destructive'
                  : budgetUsedPct >= 80
                    ? 'amber'
                    : 'emerald'
            }
            loading={entriesLoading}
            unavailable={budgetUsedPct === null}
            value={budgetUsedPct !== null ? `${budgetUsedPct}%` : '—'}
            subtitle={
              displayedRevenue > 0
                ? t('projects:detail.kpi.budgetUsedSubtitle', {
                    budget: formatNumber(displayedRevenue, {
                      maximumFractionDigits: 0,
                    }),
                    currency,
                  })
                : undefined
            }
            footer={<ProjectBudgetBar loading={entriesLoading} budgetUsedPct={budgetUsedPct} />}
          />
        </DashboardItem>
      )}
    </>
  );
};

const ProjectTeamAvatars: React.FC<{ assignedUsers: User[]; loading: boolean }> = ({
  assignedUsers,
  loading,
}) => {
  if (loading || assignedUsers.length === 0) return null;

  return (
    <div className="flex [&>*+*]:-ml-2">
      {assignedUsers.slice(0, 6).map((u) => (
        <Tooltip key={u.id}>
          <TooltipTrigger asChild>
            <Avatar role="img" aria-label={u.name} className="size-7 border-2 border-card">
              <AvatarFallback className="text-[10px]">{getInitials(u.name)}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{u.name}</TooltipContent>
        </Tooltip>
      ))}
      {assignedUsers.length > 6 && (
        <div className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium text-muted-foreground">
          +{assignedUsers.length - 6}
        </div>
      )}
    </div>
  );
};

const ProjectBudgetBar: React.FC<{ loading: boolean; budgetUsedPct: number | null }> = ({
  loading,
  budgetUsedPct,
}) => {
  if (loading || budgetUsedPct === null) return null;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all ${
          budgetUsedPct > 100
            ? 'bg-destructive'
            : budgetUsedPct >= 80
              ? 'bg-amber-500'
              : 'bg-emerald-500'
        }`}
        style={{ width: `${Math.min(budgetUsedPct, 100)}%` }}
      />
    </div>
  );
};

const ProjectTimelineDashboardItem: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, i18n, projectTimeline } = controller;

  return (
    <DashboardItem id="timeline" title={t('projects:detail.timeline.title')}>
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardDescription className="text-xs font-medium uppercase tracking-wide">
              {t('projects:detail.timeline.title')}
            </CardDescription>
            {projectTimeline && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  projectTimeline.phase === 'completed'
                    ? 'bg-muted text-muted-foreground'
                    : projectTimeline.phase === 'pending'
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    projectTimeline.phase === 'completed'
                      ? 'bg-muted-foreground'
                      : projectTimeline.phase === 'pending'
                        ? 'bg-blue-500'
                        : 'bg-emerald-500'
                  }`}
                  aria-hidden="true"
                />
                {t(`projects:detail.timeline.phase.${projectTimeline.phase}`)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!projectTimeline ? (
            <p className="text-sm text-muted-foreground">{t('projects:detail.timeline.noDates')}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatInsertDate(projectTimeline.start.getTime(), i18n.language)}</span>
                <span>{formatInsertDate(projectTimeline.end.getTime(), i18n.language)}</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${
                    projectTimeline.phase === 'completed' ? 'bg-muted-foreground' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${projectTimeline.pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">
                    {projectTimeline.elapsedDays}
                  </span>{' '}
                  / {projectTimeline.totalDays} {t('projects:detail.timeline.daysElapsed')}
                </span>
                <span className="text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">
                    {projectTimeline.remainingDays}
                  </span>{' '}
                  {t('projects:detail.timeline.daysRemaining')}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardItem>
  );
};

const ProjectHoursByUserDashboardItem: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, entriesLoading, entriesError, hoursByUserTask, userTaskChartConfig } = controller;

  return (
    <DashboardItem id="hoursByUser" title={t('projects:detail.charts.hoursByUser')}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t('projects:detail.charts.hoursByUser')}</CardTitle>
          <CardDescription>{t('projects:detail.charts.hoursByUserDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <Skeleton className="h-[260px] w-full xl:h-[320px]" />
          ) : entriesError !== null ? (
            <ChartLocked variant={entriesError} />
          ) : hoursByUserTask.rows.length === 0 || hoursByUserTask.series.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ChartContainer config={userTaskChartConfig} className="h-[280px] w-full xl:h-[340px]">
              <BarChart
                data={hoursByUserTask.rows}
                margin={{ left: 8, right: 8, top: 16, bottom: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="userName"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip
                  isAnimationActive={false}
                  content={<UserTaskTooltip series={hoursByUserTask.series} t={t} />}
                  cursor={false}
                  position={{ y: 0 }}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {hoursByUserTask.series.map((s) => (
                  <Bar
                    key={s.seriesKey}
                    dataKey={s.seriesKey}
                    fill={`var(--color-${s.seriesKey})`}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </DashboardItem>
  );
};

const ProjectHoursByTaskDashboardItem: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, entriesLoading, entriesError, hoursByTask, taskChartConfig } = controller;

  return (
    <DashboardItem id="hoursByTask" title={t('projects:detail.charts.hoursByTask')}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t('projects:detail.charts.hoursByTask')}</CardTitle>
          <CardDescription>{t('projects:detail.charts.hoursByTaskDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <Skeleton className="h-[260px] w-full xl:h-[320px]" />
          ) : entriesError !== null ? (
            <ChartLocked variant={entriesError} />
          ) : hoursByTask.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ChartContainer config={taskChartConfig} className="h-[260px] w-full xl:h-[320px]">
              <BarChart data={hoursByTask} margin={{ left: 8, right: 8, top: 24, bottom: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="task"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip
                  isAnimationActive={false}
                  content={<TaskEffortTooltip t={t} />}
                  cursor={false}
                  position={{ y: 0 }}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="logged" stackId="effort" fill="var(--color-logged)" />
                <Bar
                  dataKey="remaining"
                  stackId="effort"
                  fill="var(--color-remaining)"
                  fillOpacity={0.3}
                  radius={[4, 4, 0, 0]}
                />
                <Bar dataKey="over" stackId="effort" fill="var(--color-over)" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="over"
                    position="top"
                    content={(props) => {
                      const { x, y, width, index } = props as {
                        x?: number;
                        y?: number;
                        width?: number;
                        index?: number;
                      };
                      if (
                        typeof x !== 'number' ||
                        typeof y !== 'number' ||
                        typeof width !== 'number' ||
                        typeof index !== 'number'
                      ) {
                        return null;
                      }
                      const row = hoursByTask[index];
                      if (!row || row.hours <= 0) return null;
                      return (
                        <text
                          x={x + width / 2}
                          y={y - 6}
                          textAnchor="middle"
                          className="fill-foreground text-xs"
                        >
                          {formatNumber(row.hours, { maximumFractionDigits: 1 })}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </DashboardItem>
  );
};

const ProjectCostVsRevenueDashboardItem: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const {
    t,
    i18n,
    project,
    entriesLoading,
    entriesError,
    canViewCost,
    costOverTime,
    displayedRevenue,
    budgetChartConfig,
    currency,
  } = controller;
  const hasEntryTimeline =
    costOverTime.length > 0 && costOverTime.some((r) => r.cumulativeCost > 0);
  const canShowCostArea = canViewCost && hasEntryTimeline;
  const canShowRevenueLine = displayedRevenue > 0;
  const fallbackTimeline =
    canShowRevenueLine && project.startDate && project.endDate
      ? [
          {
            month: project.startDate.slice(0, 7),
            label: formatMonthBucket(project.startDate, i18n.language),
            monthlyCost: 0,
            cumulativeCost: 0,
          },
          {
            month: project.endDate.slice(0, 7),
            label: formatMonthBucket(project.endDate, i18n.language),
            monthlyCost: 0,
            cumulativeCost: 0,
          },
        ]
      : [];
  const chartData = hasEntryTimeline ? costOverTime : fallbackTimeline;
  const hasChartContent = canShowCostArea || (canShowRevenueLine && chartData.length > 0);

  return (
    <DashboardItem id="costVsRevenue" title={t('projects:detail.charts.costVsRevenue')}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t('projects:detail.charts.costVsRevenue')}</CardTitle>
          <CardDescription>{t('projects:detail.charts.costVsRevenueDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <Skeleton className="h-[260px] w-full xl:h-[320px]" />
          ) : entriesError !== null ? (
            <ChartLocked variant={entriesError} />
          ) : !hasChartContent ? (
            // Cost-hidden is different from true no-data: the user may have hours
            // but no permission to see the cost series this chart is built around.
            !canViewCost ? (
              <ChartLocked variant="cost-hidden" />
            ) : (
              <ChartEmpty />
            )
          ) : (
            <ChartContainer
              config={budgetChartConfig}
              className="max-h-[260px] w-full xl:max-h-[320px]"
            >
              <AreaChart data={chartData} margin={{ left: 12, right: 12, top: 16, bottom: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={[
                    0,
                    (dataMax: number) =>
                      Math.ceil(
                        (Math.max(dataMax, canShowRevenueLine ? displayedRevenue : 0) * 1.08) / 100,
                      ) * 100,
                  ]}
                  tickFormatter={(v: number) => formatNumber(v, { maximumFractionDigits: 0 })}
                />
                <ChartTooltip
                  isAnimationActive={false}
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      formatter={(value, name, item) => (
                        <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-1 shrink-0 rounded-[2px]"
                              style={{
                                backgroundColor: item?.color ?? 'var(--color-cumulativeCost)',
                              }}
                              aria-hidden="true"
                            />
                            <span className="text-muted-foreground">
                              {budgetChartConfig[name as keyof typeof budgetChartConfig]?.label ??
                                name}
                            </span>
                          </div>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {typeof value === 'number'
                              ? `${formatNumber(value, { maximumFractionDigits: 0 })} ${currency}`
                              : String(value)}
                          </span>
                        </div>
                      )}
                    />
                  }
                  cursor={false}
                  position={{ y: 0 }}
                />
                <defs>
                  <linearGradient id="fillCumulativeCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-cumulativeCost)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-cumulativeCost)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                {canShowCostArea && (
                  <Area
                    type="monotone"
                    dataKey="cumulativeCost"
                    stroke="var(--color-cumulativeCost)"
                    fill="url(#fillCumulativeCost)"
                    strokeWidth={2}
                  />
                )}
                {canShowRevenueLine && (
                  <ReferenceLine
                    y={displayedRevenue}
                    stroke="var(--color-revenue)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: `${t('projects:detail.charts.revenueLabel')} · ${formatNumber(displayedRevenue, { maximumFractionDigits: 0 })} ${currency}`,
                      position: 'insideTopRight',
                      fill: 'var(--color-revenue)',
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  />
                )}
              </AreaChart>
            </ChartContainer>
          )}
          {!canViewCost && !entriesLoading && entriesError === null && hasChartContent && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('projects:detail.charts.costHiddenNote')}
            </p>
          )}
        </CardContent>
      </Card>
    </DashboardItem>
  );
};

const ProjectMonthlyActivityDashboardItem: React.FC<{ controller: ProjectDetailController }> = ({
  controller,
}) => {
  const { t, entriesLoading, entriesError, monthlyActivity, activityChartConfig } = controller;

  return (
    <DashboardItem id="monthlyActivity" title={t('projects:detail.charts.monthlyActivity')}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t('projects:detail.charts.monthlyActivity')}</CardTitle>
          <CardDescription>{t('projects:detail.charts.monthlyActivityDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <Skeleton className="h-[260px] w-full xl:h-[320px]" />
          ) : entriesError !== null ? (
            <ChartLocked variant={entriesError} />
          ) : monthlyActivity.rows.length === 0 ||
            monthlyActivity.rows.every((r) => r.hours === 0) ? (
            <ChartEmpty />
          ) : (
            <ChartContainer config={activityChartConfig} className="h-[260px] w-full xl:h-[320px]">
              <BarChart
                data={monthlyActivity.rows}
                margin={{ left: 8, right: 8, top: 24, bottom: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={16}
                />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip
                  isAnimationActive={false}
                  content={<ChartTooltipContent />}
                  cursor={false}
                  position={{ y: 0 }}
                />
                <Bar dataKey="hours" fill="var(--color-hours)" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="hours"
                    position="top"
                    className="fill-foreground text-xs"
                    formatter={(value: unknown) => {
                      const n = typeof value === 'number' ? value : Number(value);
                      return Number.isFinite(n) && n > 0
                        ? formatNumber(n, { maximumFractionDigits: 1 })
                        : '';
                    }}
                  />
                </Bar>
                {monthlyActivity.avg > 0 && (
                  <ReferenceLine
                    y={monthlyActivity.avg}
                    stroke="var(--foreground)"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    strokeOpacity={0.7}
                    label={{
                      value: `${t('projects:detail.charts.avgMonthlyLabel')} · ${formatNumber(monthlyActivity.avg, { maximumFractionDigits: 1 })} h`,
                      position: 'insideTopRight',
                      fill: 'var(--foreground)',
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  />
                )}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </DashboardItem>
  );
};

const ProjectDetailModals: React.FC<{ controller: ProjectDetailController }> = ({ controller }) => {
  const {
    t,
    project,
    roles,
    canManageAssignments,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    handleDelete,
    isTaskDeleteConfirmOpen,
    setIsTaskDeleteConfirmOpen,
    taskToDelete,
    setTaskToDelete,
    handleConfirmDeleteTask,
    isAssignmentsOpen,
    setIsAssignmentsOpen,
    assignableUsers,
    setAssignedUserIds,
    isInternalConversionOpen,
    setIsInternalConversionOpen,
    confirmInternalConversion,
  } = controller;
  return (
    <>
      <Modal isOpen={isInternalConversionOpen} onClose={() => setIsInternalConversionOpen(false)}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>{t('projects:projects.internalConversionTitle')}</ModalTitle>
            <ModalCloseButton onClick={() => setIsInternalConversionOpen(false)} />
          </ModalHeader>
          <ModalBody>
            <ModalDescription className="mt-0">
              {t('projects:projects.internalConversionDescription')}
            </ModalDescription>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setIsInternalConversionOpen(false)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={confirmInternalConversion}>
              {t('projects:projects.internalConversionConfirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t('projects:projects.deleteProjectTitle', { name: project.name })}
        description={t('projects:projects.deleteConfirm')}
      />
      <DeleteConfirmModal
        isOpen={isTaskDeleteConfirmOpen}
        onClose={() => {
          setIsTaskDeleteConfirmOpen(false);
          setTaskToDelete(null);
        }}
        onConfirm={handleConfirmDeleteTask}
        title={t('projects:projects.deleteTaskTitle', { name: taskToDelete?.name })}
        description={t('projects:projects.deleteTaskConfirm')}
      />
      <UserAssignmentModal
        isOpen={isAssignmentsOpen}
        onClose={() => setIsAssignmentsOpen(false)}
        users={assignableUsers}
        roles={roles}
        loadAssignedUserIds={(signal) => projectsApi.getUsers(project.id, signal)}
        saveAssignedUserIds={async (ids) => {
          await projectsApi.updateUsers(project.id, ids);
          setAssignedUserIds(ids);
        }}
        entityLabel={t('projects:projects.entityLabel')}
        entityName={project.name}
        disabled={!canManageAssignments}
      />
    </>
  );
};

// Accent tokens for the KPI icon badge. We use Tailwind utility classes (not theme
// tokens) so each KPI gets a distinct hue while staying readable on both light and
// dark backgrounds. The /15 alpha keeps the surrounding chrome subtle.
const KPI_ACCENT_CLASSES: Record<KpiAccent, string> = {
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  destructive: 'bg-destructive/15 text-destructive',
};

type KpiAccent = 'blue' | 'emerald' | 'violet' | 'amber' | 'destructive';

interface KpiCardProps {
  title: string;
  icon: string;
  accent: KpiAccent;
  value: React.ReactNode;
  subtitle?: string;
  footer?: React.ReactNode;
  loading?: boolean;
  unavailable?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({
  title,
  icon,
  accent,
  value,
  subtitle,
  footer,
  loading,
  unavailable,
}) => (
  // h-full so the card fills its dashboard grid cell instead of leaving a
  // transparent strip below short content.
  <Card className="h-full gap-3">
    <CardHeader className="flex flex-row items-start justify-between gap-2">
      <CardDescription className="text-xs font-medium uppercase tracking-wide">
        {title}
      </CardDescription>
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${KPI_ACCENT_CLASSES[accent]}`}
        aria-hidden="true"
      >
        <i className={`fa-solid ${icon} text-sm`}></i>
      </span>
    </CardHeader>
    <CardContent className="space-y-1.5">
      <div className="text-3xl font-semibold tabular-nums leading-none">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : unavailable ? (
          <span className="text-base text-muted-foreground">-</span>
        ) : (
          value
        )}
      </div>
      {!loading && !unavailable && subtitle && (
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      )}
      {!loading && footer && <div className="pt-1">{footer}</div>}
    </CardContent>
  </Card>
);

// Rendered in place of a chart whose data is gated (the caller lacks the
// required permission) or failed to load. Unlike ChartEmpty — which replaces
// the chart with a generic "no data" callout — this keeps a chart-shaped
// dashed placeholder so the user still perceives "a chart is here", and
// surfaces a warning chip centered on top to explain why it's locked.
const ChartLocked: React.FC<{
  variant: 'forbidden' | 'failed' | 'cost-hidden';
}> = ({ variant }) => {
  const { t } = useTranslation(['projects']);
  // The description gives users the *why* — the old ChartEmpty variant
  // rendered it via EmptyDescription. Without it the locked card just
  // says "Time entries unavailable" with no context (especially bad for
  // screen-reader users who can't see the analytics-section chip's tooltip).
  // Tone mirrors the analytics-section header chip: amber for permission gaps
  // (forbidden / cost-hidden), destructive for load failures.
  const AMBER_TONE =
    'border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200';
  const { icon, title, description, tone } = {
    forbidden: {
      icon: 'fa-lock',
      title: t('projects:detail.notices.forbiddenTitle'),
      description: t('projects:detail.notices.forbiddenDescription'),
      tone: AMBER_TONE,
    },
    failed: {
      icon: 'fa-triangle-exclamation',
      title: t('projects:detail.notices.loadFailedTitle'),
      description: t('projects:detail.notices.loadFailedDescription'),
      tone: 'border-destructive/40 bg-destructive/10 text-destructive',
    },
    // The caller can see entries (Total Hours KPI may show real hours) but not
    // their cost — and this chart only plots cost + revenue. Say *that*, not
    // the misleading "no hours logged yet" empty state.
    'cost-hidden': {
      icon: 'fa-lock',
      title: t('projects:detail.empty.costHiddenTitle'),
      description: t('projects:detail.charts.costHiddenNote'),
      tone: AMBER_TONE,
    },
  }[variant];
  return (
    <output className="relative block" aria-live="polite">
      {/* Dashed box matching the bar/area chart's height tokens, so the locked
          state keeps the same footprint as the live chart. */}
      <div className="h-[260px] w-full rounded-lg border-2 border-dashed border-muted/40 xl:h-[320px]" />
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <div
          className={`inline-flex max-w-sm flex-col items-start gap-1 rounded-md border px-3 py-2 text-xs ${tone}`}
        >
          <div className="flex items-center gap-2">
            <i className={`fa-solid ${icon}`} aria-hidden="true"></i>
            <span className="font-medium">{title}</span>
          </div>
          <span className="text-[11px] opacity-90">{description}</span>
        </div>
      </div>
    </output>
  );
};

// Tooltip for the hours-by-task utilization chart. Reads the whole row so it can
// show logged hours against the total available effort (and any overrun) as one
// coherent summary, rather than three raw stacked-series values.
const TaskEffortTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{
    payload?: { task: string; hours: number; expected: number; over: number };
  }>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}> = ({ active, payload, t }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="grid min-w-[11rem] gap-1.5 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium text-foreground">{row.task}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{t('projects:detail.charts.loggedLabel')}</span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {formatOneDecimal(row.hours)} h
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">
          {t('projects:detail.charts.totalEffortLabel')}
        </span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {row.expected > 0 ? `${formatOneDecimal(row.expected)} h` : '—'}
        </span>
      </div>
      {row.over > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-destructive">{t('projects:detail.charts.overBudgetLabel')}</span>
          <span className="font-mono font-medium tabular-nums text-destructive">
            +{formatOneDecimal(row.over)} h
          </span>
        </div>
      )}
    </div>
  );
};

// Tooltip for the grouped hours-by-user chart. Lists only the tasks the hovered
// user actually logged on (the default ChartTooltipContent renders a row per
// task series, padding most users with zeros) plus their total across them.
const UserTaskTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
    payload?: { userName?: string };
  }>;
  series: ReadonlyArray<{ seriesKey: string; name: string; color: string }>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}> = ({ active, payload, series, t }) => {
  if (!active || !payload?.length) return null;
  const userName = payload[0]?.payload?.userName;
  const meta = new Map(series.map((s) => [s.seriesKey, s]));
  const rows = payload.reduce<Array<{ key: string; name: string; color: string; value: number }>>(
    (acc, p) => {
      if (typeof p.value !== 'number' || p.value <= 0) return acc;
      const key = p.dataKey ?? '';
      const itemMeta = meta.get(key);
      acc.push({
        key,
        name: itemMeta?.name ?? p.dataKey ?? '',
        color: itemMeta?.color ?? 'var(--muted-foreground)',
        value: p.value,
      });
      return acc;
    },
    [],
  );
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="grid min-w-[11rem] gap-1.5 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      {userName && <div className="font-medium text-foreground">{userName}</div>}
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: r.color }}
            aria-hidden="true"
          />
          <span className="flex-1 truncate text-muted-foreground">{r.name}</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatOneDecimal(r.value)} h
          </span>
        </div>
      ))}
      <div className="mt-0.5 flex items-center justify-between gap-4 border-t border-border/50 pt-1">
        <span className="text-muted-foreground">{t('projects:detail.charts.totalLabel')}</span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {formatOneDecimal(total)} h
        </span>
      </div>
    </div>
  );
};

const ChartEmpty: React.FC<{ variant?: 'no-data' | 'forbidden' | 'failed' }> = ({
  variant = 'no-data',
}) => {
  const { t } = useTranslation(['projects']);
  // Distinct icons so the chart body's signal matches the banner above: lock for a
  // permission gap, triangle-exclamation for a network/server failure, chart-pie for
  // the legitimate empty state.
  const icon =
    variant === 'forbidden'
      ? 'fa-lock'
      : variant === 'failed'
        ? 'fa-triangle-exclamation'
        : 'fa-chart-pie';
  const isUnavailable = variant !== 'no-data';
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <i className={`fa-solid ${icon}`} aria-hidden="true"></i>
        </EmptyMedia>
        <EmptyTitle>
          {isUnavailable
            ? t('projects:detail.empty.unavailableTitle')
            : t('projects:detail.empty.noEntriesTitle')}
        </EmptyTitle>
        <EmptyDescription>
          {isUnavailable
            ? t('projects:detail.empty.unavailableDescription')
            : t('projects:detail.empty.noEntriesDescription')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

export default ProjectDetailView;
