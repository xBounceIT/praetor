import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { COLORS } from '../../constants';
import { entriesApi, projectsApi } from '../../services/api';
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
  TimeEntry,
  User,
} from '../../types';
import { formatInsertDate } from '../../utils/date';
import { calculatePricingTotals } from '../../utils/numbers';
import { hasPermission, hasScopedActionPermission } from '../../utils/permissions';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import SelectControl from '../shared/SelectControl';
import StatusBadge from '../shared/StatusBadge';
import Toggle from '../shared/Toggle';
import UserAssignmentModal from '../shared/UserAssignmentModal';
import ProjectTasksTable from './ProjectTasksTable';
import type { RecurringConfig } from './TaskFormModal';

const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

const normalizeHex = (v: string): string => {
  let h = v.trim();
  if (h && !h.startsWith('#')) h = '#' + h;
  const m = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(h);
  if (m) h = `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  return h;
};

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;

const toStoredBillingType = (value: BillingType | undefined): StoredBillingType =>
  value === 'retainer' ? 'retainer' : 'time_and_materials';

const RequiredMark = () => (
  <span className="text-destructive" aria-hidden="true">
    *
  </span>
);

const billingTypeOptions = [
  { id: 'time_and_materials', name: 'projects:projects.billingTypes.timeAndMaterials' },
  { id: 'retainer', name: 'projects:projects.billingTypes.retainer' },
];

const billingFrequencyOptions = [
  { id: 'monthly', name: 'projects:projects.billingFrequencies.monthly' },
  { id: 'one_time', name: 'projects:projects.billingFrequencies.oneTime' },
];

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

type RevenueSource = 'activities' | 'order' | 'manual';

const sumActivityRevenue = (tasks: ReadonlyArray<{ revenue?: number | string | null }>): number =>
  tasks.reduce((sum, t) => sum + (Number(t.revenue) || 0), 0);

const resolveRevenueSource = (activitiesSum: number, hasOrder: boolean): RevenueSource => {
  if (activitiesSum > 0) return 'activities';
  if (hasOrder) return 'order';
  return 'manual';
};

export interface ProjectDetailViewProps {
  project: Project;
  clients: Client[];
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
      'expectedEffort' | 'monthlyEffort' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => Promise<ProjectTask>;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void | Promise<void>;
  onDeleteTask: (id: string) => void | Promise<void>;
  onViewOrder?: (orderId: string) => void;
}

const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
  project,
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
}) => {
  const { t, i18n } = useTranslation(['projects', 'common', 'form', 'timesheets']);

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

  // Form state — initialized from project, kept in sync when project prop changes.
  const [name, setName] = useState(project.name);
  const [clientId, setClientId] = useState(project.clientId);
  const [description, setDescription] = useState(project.description ?? '');
  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [endDate, setEndDate] = useState(project.endDate ?? '');
  const [offerId, setOfferId] = useState(project.offerId ?? '');
  const [revenue, setRevenue] = useState(
    project.revenue !== null && project.revenue !== undefined ? String(project.revenue) : '',
  );
  const [color, setColor] = useState(project.color);
  const [hexInput, setHexInput] = useState(project.color);
  const [tempIsDisabled, setTempIsDisabled] = useState(project.isDisabled ?? false);
  const storedInitialBillingType = toStoredBillingType(project.billingType);
  const [billingType, setBillingType] = useState<StoredBillingType>(storedInitialBillingType);
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>(
    storedInitialBillingType === 'time_and_materials'
      ? 'monthly'
      : (project.billingFrequency ?? 'monthly'),
  );
  const [projectBillingChanged, setProjectBillingChanged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  // No prop-sync useEffect: the parent passes `key={project.id}` so this component
  // remounts on project switch — useState initializers above re-run with the new
  // project values, and same-id parent updates (background poll / optimistic update)
  // intentionally do NOT clobber the form so unsaved edits survive.

  // Analytics state
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesTruncated, setEntriesTruncated] = useState(false);
  const [entriesError, setEntriesError] = useState<'forbidden' | 'failed' | null>(null);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(true);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<ProjectTask | null>(null);
  const [isTaskDeleteConfirmOpen, setIsTaskDeleteConfirmOpen] = useState(false);
  const [isAssignmentsOpen, setIsAssignmentsOpen] = useState(false);
  // Hover-to-isolate state for the donut charts: when the user hovers a row in
  // the legend, we dim the other slices via fillOpacity so the hovered one pops.
  const [hoveredUserKey, setHoveredUserKey] = useState<string | null>(null);
  const [hoveredLocationKey, setHoveredLocationKey] = useState<string | null>(null);

  useEffect(() => {
    // Short-circuit when the caller lacks the tracker view permission — the route
    // would return 403 and we'd burn 10 round-trips for nothing.
    if (!canViewEntries) {
      setEntries([]);
      setEntriesTruncated(false);
      setEntriesError('forbidden');
      setEntriesLoading(false);
      return;
    }
    const ac = new AbortController();
    setEntriesLoading(true);
    setEntries([]);
    setEntriesTruncated(false);
    setEntriesError(null);
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
  }, [project.id, canViewEntries]);

  useEffect(() => {
    // GET /projects/:id/users is server-gated on `projects.assignments.update`. Without
    // that permission the fetch 403s, we'd swallow the error, and the KPI would render
    // a misleading "0" team size for projects that actually have members.
    if (!canManageAssignments) {
      setAssignedUserIds([]);
      setAssignedLoading(false);
      return;
    }
    const ac = new AbortController();
    setAssignedLoading(true);
    // Reset before the new fetch so the avatar row doesn't briefly show the
    // previous project's members while switching projects.
    setAssignedUserIds([]);
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
  }, [project.id, canManageAssignments]);

  // Aggregations
  const totalHours = useMemo(
    () => entries.reduce((sum, e) => sum + (e.duration ?? 0), 0),
    [entries],
  );
  const totalCost = useMemo(() => entries.reduce((sum, e) => sum + (e.cost ?? 0), 0), [entries]);
  const hoursByUser = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.userId, (map.get(e.userId) ?? 0) + (e.duration ?? 0));
    }
    return Array.from(map.entries())
      .map(([userId, hours]) => ({
        userId,
        userName: users.find((u) => u.id === userId)?.name ?? userId,
        hours: Math.round(hours * 100) / 100,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 8);
  }, [entries, users]);

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
          return {
            // Stable key for the chart config / Cell fill — survives task renames.
            key,
            task: name || unknownLabel,
            hours: Math.round(hours * 100) / 100,
          };
        })
        // Secondary sort by name keeps the 0-hour tail in a stable, scannable order
        // — otherwise all the zeros tie on the primary sort and depend on Map
        // insertion order, which shifts as new tasks get added.
        .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task))
        .slice(0, 10)
    );
  }, [entries, tasks, project.id, t]);

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

  const locationSplit = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const loc = e.location || 'remote';
      map.set(loc, (map.get(loc) ?? 0) + (e.duration ?? 0));
    }
    return Array.from(map.entries())
      .map(([location, hours]) => ({ location, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);
  }, [entries]);

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  // Single pass: filter to accepted/sent offers belonging to the current client and
  // shape into the option struct (vs. .filter().filter().map() iterating thrice).
  const offerOptions: { id: string; name: string }[] = [];
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

  const translatedBillingTypeOptions = billingTypeOptions.map((o) => ({
    id: o.id,
    name: t(o.name),
  }));
  const translatedBillingFrequencyOptions = billingFrequencyOptions.map((o) => ({
    id: o.id,
    name: t(o.name),
  }));

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === project.id),
    [tasks, project.id],
  );

  // Derive "mixed" status the same way ProjectsView does
  const derivedBillingType: BillingType = useMemo(() => {
    if (project.billingType === 'mixed') return 'mixed';
    const stored = toStoredBillingType(project.billingType);
    const taskTypes = new Set(projectTasks.map((t) => t.billingType ?? 'time_and_materials'));
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

  const linkedOrder = project.orderId ? orders.find((o) => o.id === project.orderId) : undefined;
  const client = clients.find((c) => c.id === clientId);
  const isClientDisabled = client?.isDisabled ?? false;
  const isCurrentlyDisabled = tempIsDisabled || isClientDisabled;

  // Revenue precedence (mirrors ProjectsView create-flow):
  //   activitiesRevenueSum > 0 → revenue is the sum (read-only);
  //   else linkedOrder → revenue is the order total (read-only);
  //   else → manual entry.
  // Persisting the manual `revenue` field only matters in the 'manual' branch — otherwise
  // it's recomputed on read, and writing it would shadow/override the derived value.
  const activitiesRevenueSum = sumActivityRevenue(projectTasks);
  const orderRevenue = linkedOrder
    ? calculatePricingTotals(
        linkedOrder.items,
        linkedOrder.discount,
        'hours',
        linkedOrder.discountType,
      ).total
    : 0;
  const revenueSource = resolveRevenueSource(activitiesRevenueSum, Boolean(linkedOrder));
  const revenueBySource: Record<RevenueSource, number> = {
    activities: activitiesRevenueSum,
    order: orderRevenue,
    manual: revenue ? parseFloat(revenue) : 0,
  };
  const displayedRevenue = revenueBySource[revenueSource];
  const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;
  const revenueHintBySource: Record<RevenueSource, string> = {
    activities: t('projects:projects.revenueFromActivities'),
    order: t('projects:projects.revenueFromOrder'),
    manual: t('projects:projects.revenueManualHint'),
  };

  // Budget % is meaningful only when cost is visible, entries loaded, AND revenue is
  // non-zero. Denominator uses `displayedRevenue` (derived from activities sum / linked
  // order total / manual) so the KPI reflects what the user sees in the revenue field —
  // `project.revenue` lags for activities/order sources because we only persist it when
  // source==='manual'.
  const budgetUsedPct = useMemo(() => {
    if (!canViewCost) return null;
    if (entriesError !== null) return null;
    if (!displayedRevenue || displayedRevenue <= 0) return null;
    return Math.round((totalCost / displayedRevenue) * 100);
  }, [canViewCost, entriesError, displayedRevenue, totalCost]);

  // Order locks the client — server enforces FK against the order's client, so let the UI
  // mirror it instead of allowing a save that the API will reject.
  const isClientLockedByOrder = Boolean(project.orderId);

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
    offerId !== (project.offerId ?? '') ||
    revenueChanged ||
    color !== project.color ||
    tempIsDisabled !== (project.isDisabled ?? false) ||
    projectBillingChanged;

  const handleDiscard = () => {
    setName(project.name);
    setClientId(project.clientId);
    setDescription(project.description ?? '');
    setStartDate(project.startDate ?? '');
    setEndDate(project.endDate ?? '');
    setOfferId(project.offerId ?? '');
    setRevenue(
      project.revenue !== null && project.revenue !== undefined ? String(project.revenue) : '',
    );
    setColor(project.color);
    setHexInput(project.color);
    setTempIsDisabled(project.isDisabled ?? false);
    const stored = toStoredBillingType(project.billingType);
    setBillingType(stored);
    setBillingFrequency(
      stored === 'time_and_materials' ? 'monthly' : (project.billingFrequency ?? 'monthly'),
    );
    setProjectBillingChanged(false);
    setErrors({});
  };

  const handleSave = async () => {
    if (!canUpdateProjects) return;
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = t('common:validation.projectNameRequired');
    if (!clientId) newErrors.clientId = t('projects:projects.clientRequired');
    if (!offerId) newErrors.offerId = t('projects:projects.offerRequired');
    // Only enforce required dates on projects that already carry them. Legacy projects
    // predating the dates-required rule still allow null dates on the PATCH endpoint;
    // forcing dates here would block unrelated edits (rename, color, disable) until the
    // user invented a planning window.
    if (project.startDate && !startDate) {
      newErrors.startDate = t('projects:projects.startDateRequired');
    }
    if (project.endDate && !endDate) {
      newErrors.endDate = t('projects:projects.endDateRequired');
    }
    if (startDate && endDate && startDate > endDate) {
      newErrors.dateRange = t('projects:projects.dateRangeInvalid');
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    const updates: Partial<Project> = {
      name,
      clientId,
      description,
      color,
      isDisabled: tempIsDisabled,
      offerId,
      startDate: startDate || null,
      endDate: endDate || null,
    };
    // Only touch `revenue` when the source is manual: derived values (activities
    // sum or linked-order total) are recomputed on read. Sending `null` here would
    // wipe a previously stored manual revenue any time the user saves an unrelated
    // field while activities/order momentarily satisfy the precedence.
    if (revenueSource === 'manual') {
      updates.revenue = persistedRevenue ?? null;
    }
    if (derivedBillingType !== 'mixed' || projectBillingChanged) {
      updates.billingType = billingType;
      updates.billingFrequency =
        billingType === 'time_and_materials' ? 'monthly' : billingFrequency;
    }
    // Await so we can clear the billing-change latch only on success. Every other
    // hasChanges contributor compares local state to project.* (so a rejected save
    // naturally keeps the save bar up). Billing uses a latching boolean — clearing
    // it eagerly would hide the save bar even when the update never persisted.
    // The parent handler catches and toasts errors itself, returning `null` on
    // failure (mirroring `add`), so we branch on the result rather than try/catch.
    const result = await onUpdateProject(project.id, updates);
    if (result !== null) setProjectBillingChanged(false);
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

  // Chart configs (theme-aware via --chart-N)
  const hoursByUserConfig: ChartConfig = useMemo(
    () =>
      hoursByUser.reduce<ChartConfig>((acc, row, idx) => {
        acc[row.userId] = {
          label: row.userName,
          color: `var(--chart-${(idx % 5) + 1})`,
        };
        return acc;
      }, {}),
    [hoursByUser],
  );

  const locationConfig: ChartConfig = useMemo(() => {
    // Translation keys live under `entry.locationTypes` (camelCase keys), not `tracker.*`.
    const labelKey: Record<string, string> = {
      remote: 'timesheets:entry.locationTypes.remote',
      office: 'timesheets:entry.locationTypes.office',
      customer_premise: 'timesheets:entry.locationTypes.customerPremise',
      transfer: 'timesheets:entry.locationTypes.transfer',
    };
    const cfg: ChartConfig = {};
    locationSplit.forEach((row, idx) => {
      cfg[row.location] = {
        label: t(labelKey[row.location] ?? row.location, row.location),
        color: `var(--chart-${(idx % 5) + 1})`,
      };
    });
    return cfg;
  }, [locationSplit, t]);

  // The bar Cells set their own per-row fill below (one var(--chart-N) per task,
  // cycling), so the config only needs the shared 'hours' label for the tooltip.
  // We avoid keying colors by hoursByTask.key because the legacy null-taskId
  // fallback ("name:Foo bar") contains characters that aren't valid in CSS
  // variable identifiers.
  const taskChartConfig: ChartConfig = {
    hours: { label: t('projects:detail.charts.hoursLabel') },
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

  const assignedUsers = users.filter((u) => assignedUserIds.includes(u.id));
  // Use the filtered list so the count and the avatar row always agree; an assigned-but-
  // missing-from-`users` id is invisible in the UI, so it shouldn't inflate the KPI.
  const teamSize = assignedUsers.length;
  const assignableUsers = users.filter(
    (u) => !u.hasTopManagerRole && !u.isAdminOnly && !u.isDisabled,
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
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
            <span
              className="inline-block size-6 rounded-md border border-border shadow-sm"
              style={{ backgroundColor: project.color }}
              aria-hidden="true"
            />
            <h1 className="text-2xl font-semibold text-foreground">{project.name}</h1>
            {project.isDisabled ? (
              <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />
            ) : isClientDisabled ? (
              <StatusBadge type="inherited" label={t('projects:projects.statusInheritedDisable')} />
            ) : (
              <StatusBadge type="active" label={t('projects:projects.statusActive')} />
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

      {/* Top section: details (left, ~40%) + tasks table (right, ~60%) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2 self-start space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold leading-none">
              {t('projects:detail.detailsTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('projects:detail.detailsDescription')}
            </p>
          </div>
          {linkedOrder && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                  <i className="fa-solid fa-link" aria-hidden="true"></i>
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t('projects:projects.linkedOrder')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatOrderId(linkedOrder.id)} · {linkedOrder.clientName}
                  </div>
                </div>
              </div>
              {onViewOrder && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => onViewOrder(linkedOrder.id)}
                  className="px-0"
                >
                  {t('projects:projects.viewOrder')}
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <SelectControl
                id="detail-client"
                options={clientOptions}
                value={clientId}
                onChange={(val) => {
                  const nextClientId = val as string;
                  setClientId(nextClientId);
                  if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
                  // Clear a stale offerId belonging to the previous client — server enforces
                  // the same invariant and would reject the save otherwise.
                  if (offerId) {
                    const current = offers.find((o) => o.id === offerId);
                    if (!current || current.clientId !== nextClientId) {
                      setOfferId('');
                      if (errors.offerId) setErrors((prev) => ({ ...prev, offerId: '' }));
                    }
                  }
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
                  <i
                    className="fa-solid fa-link text-xs text-muted-foreground"
                    aria-hidden="true"
                  ></i>
                  <span className="text-xs text-muted-foreground">
                    {t('projects:projects.inheritedClientLabel')}:
                  </span>
                  <span className="text-xs font-medium text-foreground">
                    {linkedOrder.clientName}
                  </span>
                </div>
              )}
            </div>
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
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="detail-description">
                {t('projects:projects.description')}
              </FieldLabel>
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
            <Field data-invalid={Boolean(errors.startDate || errors.dateRange)}>
              <FieldLabel htmlFor="detail-start-date">
                {t('projects:projects.startDate')} {project.startDate && <RequiredMark />}
              </FieldLabel>
              <Input
                id="detail-start-date"
                type="date"
                value={startDate}
                disabled={!canUpdateProjects}
                aria-invalid={Boolean(errors.startDate || errors.dateRange)}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (errors.startDate || errors.dateRange) {
                    setErrors((prev) => ({ ...prev, startDate: '', dateRange: '' }));
                  }
                }}
              />
              <FieldError className="text-xs">{errors.startDate}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.endDate || errors.dateRange)}>
              <FieldLabel htmlFor="detail-end-date">
                {t('projects:projects.endDate')} {project.endDate && <RequiredMark />}
              </FieldLabel>
              <Input
                id="detail-end-date"
                type="date"
                value={endDate}
                disabled={!canUpdateProjects}
                aria-invalid={Boolean(errors.endDate || errors.dateRange)}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  if (errors.endDate || errors.dateRange) {
                    setErrors((prev) => ({ ...prev, endDate: '', dateRange: '' }));
                  }
                }}
              />
              <FieldError className="text-xs">{errors.endDate}</FieldError>
            </Field>
            {errors.dateRange && (
              <FieldError className="md:col-span-2 text-xs">{errors.dateRange}</FieldError>
            )}
            <div className="space-y-1.5">
              <SelectControl
                id="detail-offer"
                options={offerOptions}
                value={offerId}
                onChange={(val) => {
                  setOfferId(val as string);
                  if (errors.offerId) setErrors((prev) => ({ ...prev, offerId: '' }));
                }}
                label={
                  <>
                    {t('projects:projects.offerReference')} <RequiredMark />
                  </>
                }
                placeholder={t('projects:projects.selectOffer')}
                searchable
                buttonClassName="h-9"
                disabled={!canUpdateProjects}
              />
              <FieldError className="text-xs">{errors.offerId}</FieldError>
            </div>
            <Field>
              <FieldLabel htmlFor="detail-revenue">
                {`${t('projects:projects.projectRevenue')} (${currency})`}
              </FieldLabel>
              <Input
                id="detail-revenue"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                disabled={!canUpdateProjects}
                value={revenueSource === 'manual' ? revenue : displayedRevenue.toFixed(2)}
                readOnly={revenueSource !== 'manual'}
                onChange={(e) => setRevenue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{revenueHintBySource[revenueSource]}</p>
            </Field>
            <SelectControl
              id="detail-billing-type"
              options={projectBillingTypeOptions}
              value={derivedBillingType}
              onChange={(val) => {
                const next = val as StoredBillingType;
                setProjectBillingChanged(true);
                setBillingType(next);
                if (next === 'time_and_materials') setBillingFrequency('monthly');
              }}
              label={t('projects:projects.billingType')}
              disabled={!canUpdateProjects || derivedBillingType === 'mixed'}
              searchable={false}
              buttonClassName="h-9"
            />
            <SelectControl
              id="detail-billing-frequency"
              options={
                billingType === 'retainer'
                  ? translatedBillingFrequencyOptions
                  : translatedBillingFrequencyOptions.filter((o) => o.id === 'monthly')
              }
              value={
                derivedBillingType === 'mixed'
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
                !canUpdateProjects ||
                derivedBillingType === 'mixed' ||
                billingType === 'time_and_materials'
              }
              searchable={false}
              buttonClassName="h-9"
            />
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
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
                          disabled={!canUpdateProjects}
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
                    disabled={!canUpdateProjects}
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
                    disabled={!canUpdateProjects}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHexInput(val);
                      if (isValidHex(val)) setColor(val);
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
            <Field>
              <FieldLabel>{t('projects:projects.projectDisabled')}</FieldLabel>
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
                    if (!isClientDisabled && canUpdateProjects) {
                      setTempIsDisabled(!tempIsDisabled);
                    }
                  }}
                  disabled={isClientDisabled || !canUpdateProjects}
                />
              </div>
            </Field>
          </div>
        </div>

        <ProjectRulesMockup className="xl:col-span-3" />
      </div>

      {/* Project tasks — full-width row so the table scales with many tasks */}
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

      {/* Save bar — shows only when there are unsaved changes */}
      {hasChanges && canUpdateProjects && (
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
      )}

      {/* Analytics section header — scope/error notices appear as a single-line
          chip beside the header so the section stays compact; the full message
          lives in a tooltip on hover. Vertical centering keeps the chip aligned
          with the title even though the description wraps the header to 2 lines. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold leading-none">
            {t('projects:detail.analyticsTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('projects:detail.analyticsDescription')}
          </p>
        </div>
        {!entriesLoading && entriesError === 'forbidden' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-flex max-w-full cursor-help items-center gap-2 rounded-md border border-amber-300/50 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200 sm:max-w-xs">
                <i className="fa-solid fa-lock shrink-0" aria-hidden="true"></i>
                <span className="truncate font-medium">
                  {t('projects:detail.notices.forbiddenTitle')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{t('projects:detail.notices.forbiddenDescription')}</TooltipContent>
          </Tooltip>
        )}
        {!entriesLoading && entriesError === 'failed' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-flex max-w-full cursor-help items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive sm:max-w-xs">
                <i className="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
                <span className="truncate font-medium">
                  {t('projects:detail.notices.loadFailedTitle')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{t('projects:detail.notices.loadFailedDescription')}</TooltipContent>
          </Tooltip>
        )}
        {!entriesLoading && entriesError === null && (entriesTruncated || isPartialEntryScope) && (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* When both notices apply, prefer the truncated one in the chip
                    (it signals missing data); the tooltip lists both. */}
              <div className="inline-flex max-w-full cursor-help items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground sm:max-w-md">
                <i className="fa-solid fa-circle-info shrink-0" aria-hidden="true"></i>
                <span className="truncate">
                  {entriesTruncated
                    ? t('projects:detail.notices.truncated', { count: ENTRIES_FETCH_CEILING })
                    : t('projects:detail.notices.partialScope')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="space-y-1 text-xs">
                {entriesTruncated && (
                  <div>
                    {t('projects:detail.notices.truncated', { count: ENTRIES_FETCH_CEILING })}
                  </div>
                )}
                {isPartialEntryScope && <div>{t('projects:detail.notices.partialScope')}</div>}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* KPI cards + project timeline split the row 50/50 on large screens.
          KPIs share the left half (auto-laid in their own inner grid), timeline
          fills the right half regardless of how many KPIs are visible. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(() => {
          // Inner grid for the KPIs only. Picks the column count that lays them
          // out cleanly in the left half: 4 → 2x2, 3 → 3 wide, 2 → 2 wide, 1 → 1.
          const visibleKpiCount =
            1 + (canViewCost ? 1 : 0) + (canManageAssignments ? 1 : 0) + (canViewCost ? 1 : 0);
          const innerColsClass =
            visibleKpiCount >= 4
              ? 'sm:grid-cols-2'
              : visibleKpiCount === 3
                ? 'sm:grid-cols-3'
                : visibleKpiCount === 2
                  ? 'sm:grid-cols-2'
                  : 'sm:grid-cols-1';
          return (
            <div className={`grid grid-cols-1 gap-4 ${innerColsClass}`}>
              <KpiCard
                title={t('projects:detail.kpi.totalHours')}
                icon="fa-clock"
                accent="blue"
                loading={entriesLoading}
                unavailable={entriesError !== null}
                value={
                  <>
                    {totalHours.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
                    <span className="ml-1 text-base font-medium text-muted-foreground">h</span>
                  </>
                }
                subtitle={
                  entries.length > 0
                    ? t('projects:detail.kpi.totalHoursSubtitle', { count: entries.length })
                    : undefined
                }
              />
              {canViewCost && (
                <KpiCard
                  title={t('projects:detail.kpi.totalCost')}
                  icon="fa-coins"
                  accent="emerald"
                  loading={entriesLoading}
                  unavailable={entriesError !== null}
                  value={
                    <>
                      <span className="mr-1 text-base font-medium text-muted-foreground">
                        {currency}
                      </span>
                      {totalCost.toLocaleString(i18n.language, {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: 2,
                      })}
                    </>
                  }
                  subtitle={
                    totalHours > 0
                      ? t('projects:detail.kpi.totalCostSubtitle', {
                          rate: (totalCost / totalHours).toLocaleString(i18n.language, {
                            maximumFractionDigits: 2,
                          }),
                          currency,
                        })
                      : undefined
                  }
                />
              )}
              {canManageAssignments && (
                <KpiCard
                  title={t('projects:detail.kpi.teamSize')}
                  icon="fa-users"
                  accent="violet"
                  loading={assignedLoading}
                  value={teamSize}
                  subtitle={teamSize > 0 ? t('projects:detail.kpi.teamSizeSubtitle') : undefined}
                  footer={
                    !assignedLoading && assignedUsers.length > 0 ? (
                      <div className="flex -space-x-2">
                        {assignedUsers.slice(0, 6).map((u) => (
                          <Avatar key={u.id} className="size-7 border-2 border-card">
                            <AvatarFallback className="text-[10px]">
                              {getInitials(u.name)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {assignedUsers.length > 6 && (
                          <div className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium text-muted-foreground">
                            +{assignedUsers.length - 6}
                          </div>
                        )}
                      </div>
                    ) : undefined
                  }
                />
              )}
              {canViewCost && (
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
                          budget: displayedRevenue.toLocaleString(i18n.language, {
                            maximumFractionDigits: 0,
                          }),
                          currency,
                        })
                      : undefined
                  }
                  footer={
                    !entriesLoading && budgetUsedPct !== null ? (
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
                    ) : undefined
                  }
                />
              )}
            </div>
          );
        })()}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">
                  {t('projects:detail.timeline.title')}
                </CardDescription>
              </div>
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
              <p className="text-sm text-muted-foreground">
                {t('projects:detail.timeline.noDates')}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatInsertDate(projectTimeline.start.getTime(), i18n.language)}</span>
                  <span>{formatInsertDate(projectTimeline.end.getTime(), i18n.language)}</span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all ${
                      projectTimeline.phase === 'completed'
                        ? 'bg-muted-foreground'
                        : 'bg-emerald-500'
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
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('projects:detail.charts.hoursByUser')}</CardTitle>
            <CardDescription>{t('projects:detail.charts.hoursByUserDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {entriesLoading ? (
              <Skeleton className="h-[260px] w-full xl:h-[320px]" />
            ) : entriesError !== null ? (
              <ChartEmpty variant={entriesError === 'forbidden' ? 'forbidden' : 'failed'} />
            ) : hoursByUser.length === 0 || hoursByUser.every((r) => r.hours === 0) ? (
              <ChartEmpty />
            ) : (
              /* Relative wrapper: the donut centers in the card (mx-auto) and
                 the legend overlays the top-right corner on sm+. On mobile the
                 legend falls back to stacking below the chart full-width. This
                 lets the chart visually dominate without a sidebar column
                 pulling the layout left-of-center. */
              <div className="relative">
                <ChartContainer
                  config={hoursByUserConfig}
                  className="mx-auto aspect-square w-full max-w-[360px] shrink-0 sm:max-w-[460px] xl:max-w-[560px]"
                >
                  <PieChart>
                    <ChartTooltip
                      isAnimationActive={false}
                      content={<ChartTooltipContent nameKey="userId" />}
                    />
                    <Pie
                      data={hoursByUser}
                      dataKey="hours"
                      nameKey="userId"
                      innerRadius="55%"
                      outerRadius="85%"
                      strokeWidth={2}
                      isAnimationActive={false}
                      onMouseEnter={(entry) =>
                        setHoveredUserKey((entry as { userId?: string })?.userId ?? null)
                      }
                      onMouseLeave={() => setHoveredUserKey(null)}
                    >
                      {hoursByUser.map((row, idx) => (
                        <Cell
                          key={row.userId}
                          fill={`var(--color-${row.userId})`}
                          name={row.userName}
                          data-idx={idx}
                          fillOpacity={hoveredUserKey && hoveredUserKey !== row.userId ? 0.2 : 1}
                          style={{ transition: 'fill-opacity 150ms ease-out' }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-4 w-full sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:w-56 xl:w-64">
                  <PieLegend
                    compact
                    rows={hoursByUser.map((row, idx) => ({
                      key: row.userId,
                      label: row.userName,
                      value: row.hours,
                      // Mirrors the Pie Cell fill, which uses var(--color-<userId>)
                      // sourced from hoursByUserConfig (var(--chart-N) cycling 1-5).
                      color: `var(--chart-${(idx % 5) + 1})`,
                    }))}
                    total={totalHours}
                    valueFormatter={(v) =>
                      v.toLocaleString(i18n.language, { maximumFractionDigits: 1 })
                    }
                    onRowHover={setHoveredUserKey}
                    headers={{
                      label: t('projects:detail.charts.legendHeaders.user'),
                      value: t('projects:detail.charts.legendHeaders.hours'),
                      share: '%',
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('projects:detail.charts.hoursByTask')}</CardTitle>
            <CardDescription>{t('projects:detail.charts.hoursByTaskDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {entriesLoading ? (
              <Skeleton className="h-[260px] w-full xl:h-[320px]" />
            ) : entriesError !== null ? (
              <ChartEmpty variant={entriesError === 'forbidden' ? 'forbidden' : 'failed'} />
            ) : hoursByTask.length === 0 ? (
              // Only empty when there are neither project tasks nor entries — tasks
              // with no hours yet are still meaningful (planned/not-yet-worked-on)
              // and render as 0-height bars below.
              <ChartEmpty />
            ) : (
              <ChartContainer config={taskChartConfig} className="h-[260px] w-full xl:h-[320px]">
                <BarChart data={hoursByTask} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
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
                    content={<ChartTooltipContent />}
                    cursor={false}
                    // Pin Y so the tooltip doesn't drift up/down as the cursor
                    // moves inside a tall bar — it just tracks X horizontally.
                    position={{ y: 0 }}
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    {hoursByTask.map((row, idx) => (
                      <Cell key={row.key} fill={`var(--chart-${(idx % 5) + 1})`} name={row.task} />
                    ))}
                    <LabelList dataKey="hours" position="top" className="fill-foreground text-xs" />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {(() => {
          // Always render the card for callers who can see the project at all —
          // when they lack `reports.cost.view` we just hide the cost area
          // (server strips cost, so rendering it would be a misleading
          // flat-zero line) and still surface the revenue ceiling. Skip the
          // whole card only when there's nothing meaningful to show.
          const hasEntryTimeline =
            costOverTime.length > 0 && costOverTime.some((r) => r.cumulativeCost > 0);
          if (!hasEntryTimeline && !canViewCost && displayedRevenue === 0) return null;
          if (canViewCost && !hasEntryTimeline && displayedRevenue === 0) return null;
          // Synthesise two X-axis anchors from the project window when there's
          // no entry-driven cost data, so the revenue reference line still has
          // something to draw against.
          const fallbackTimeline =
            project.startDate && project.endDate
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
          return (
            <Card>
              <CardHeader>
                <CardTitle>{t('projects:detail.charts.costVsRevenue')}</CardTitle>
                <CardDescription>{t('projects:detail.charts.costVsRevenueDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {entriesLoading ? (
                  <Skeleton className="h-[260px] w-full xl:h-[320px]" />
                ) : entriesError !== null ? (
                  <ChartEmpty variant={entriesError === 'forbidden' ? 'forbidden' : 'failed'} />
                ) : chartData.length === 0 ? (
                  <ChartEmpty />
                ) : (
                  <ChartContainer
                    config={budgetChartConfig}
                    className="max-h-[260px] w-full xl:max-h-[320px]"
                  >
                    <AreaChart
                      data={chartData}
                      margin={{ left: 12, right: 12, top: 16, bottom: 8 }}
                    >
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
                        tickFormatter={(v: number) =>
                          v.toLocaleString(i18n.language, { maximumFractionDigits: 0 })
                        }
                      />
                      <ChartTooltip
                        isAnimationActive={false}
                        content={<ChartTooltipContent indicator="line" />}
                        cursor={false}
                        position={{ y: 0 }}
                      />
                      <defs>
                        <linearGradient id="fillCumulativeCost" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor="var(--color-cumulativeCost)"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-cumulativeCost)"
                            stopOpacity={0.05}
                          />
                        </linearGradient>
                      </defs>
                      {canViewCost && hasEntryTimeline && (
                        <Area
                          type="monotone"
                          dataKey="cumulativeCost"
                          stroke="var(--color-cumulativeCost)"
                          fill="url(#fillCumulativeCost)"
                          strokeWidth={2}
                        />
                      )}
                      {displayedRevenue > 0 && (
                        <ReferenceLine
                          y={displayedRevenue}
                          stroke="var(--color-revenue)"
                          strokeDasharray="4 4"
                          strokeWidth={1.5}
                          label={{
                            value: `${t('projects:detail.charts.revenueLabel')} · ${displayedRevenue.toLocaleString(i18n.language, { maximumFractionDigits: 0 })} ${currency}`,
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
                {!canViewCost && !entriesLoading && entriesError === null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('projects:detail.charts.costHiddenNote')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader>
            <CardTitle>{t('projects:detail.charts.locationSplit')}</CardTitle>
            <CardDescription>{t('projects:detail.charts.locationSplitDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {entriesLoading ? (
              <Skeleton className="h-[260px] w-full xl:h-[320px]" />
            ) : entriesError !== null ? (
              <ChartEmpty variant={entriesError === 'forbidden' ? 'forbidden' : 'failed'} />
            ) : locationSplit.length === 0 || locationSplit.every((r) => r.hours === 0) ? (
              <ChartEmpty />
            ) : (
              /* Same centered-chart + corner-overlay legend layout as the
                 hours-by-user chart. See that section for the rationale. */
              <div className="relative">
                <ChartContainer
                  config={locationConfig}
                  className="mx-auto aspect-square w-full max-w-[360px] shrink-0 sm:max-w-[460px] xl:max-w-[560px]"
                >
                  <PieChart>
                    <ChartTooltip
                      isAnimationActive={false}
                      content={<ChartTooltipContent nameKey="location" />}
                    />
                    <Pie
                      data={locationSplit}
                      dataKey="hours"
                      nameKey="location"
                      innerRadius="55%"
                      outerRadius="85%"
                      strokeWidth={2}
                      isAnimationActive={false}
                      onMouseEnter={(entry) =>
                        setHoveredLocationKey((entry as { location?: string })?.location ?? null)
                      }
                      onMouseLeave={() => setHoveredLocationKey(null)}
                    >
                      {locationSplit.map((row) => (
                        <Cell
                          key={row.location}
                          fill={`var(--color-${row.location})`}
                          name={String(locationConfig[row.location]?.label ?? row.location)}
                          fillOpacity={
                            hoveredLocationKey && hoveredLocationKey !== row.location ? 0.2 : 1
                          }
                          style={{ transition: 'fill-opacity 150ms ease-out' }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-4 w-full sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:w-56 xl:w-64">
                  <PieLegend
                    compact
                    rows={locationSplit.map((row, idx) => ({
                      key: row.location,
                      label: String(locationConfig[row.location]?.label ?? row.location),
                      value: row.hours,
                      // Same chart palette index as the Pie Cell fills.
                      color: `var(--chart-${(idx % 5) + 1})`,
                    }))}
                    total={locationSplit.reduce((s, r) => s + r.hours, 0)}
                    valueFormatter={(v) =>
                      v.toLocaleString(i18n.language, { maximumFractionDigits: 1 })
                    }
                    onRowHover={setHoveredLocationKey}
                    headers={{
                      label: t('projects:detail.charts.legendHeaders.location'),
                      value: t('projects:detail.charts.legendHeaders.hours'),
                      share: '%',
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
        // Mirror the saved ids back into local state so the team-size KPI and avatar row
        // refresh immediately — the modal itself doesn't expose an onSaved callback.
        saveAssignedUserIds={async (ids) => {
          await projectsApi.updateUsers(project.id, ids);
          setAssignedUserIds(ids);
        }}
        entityLabel={t('common:labels.project')}
        entityName={project.name}
        disabled={!canManageAssignments}
      />
    </div>
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
  <Card className="gap-3">
    <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
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
          <span className="text-base text-muted-foreground">—</span>
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

// Right-side legend for the donut charts. Built inline rather than via shadcn's
// ChartLegendContent because that one is hard-coded to horizontal flex; we want a
// vertical layout that also surfaces hours and percent-of-total per row.
const PieLegend: React.FC<{
  // `color` is the slice color for this row. It must be passed in because the
  // legend renders outside the ChartContainer, where `var(--color-<key>)` from
  // shadcn's ChartStyle isn't in scope. Without it, both the swatch and the
  // colored value/share would render with no color at all.
  rows: ReadonlyArray<{ key: string; label: string; value: number; color: string }>;
  total: number;
  valueFormatter: (v: number) => string;
  // `compact` shrinks typography and tightens spacing so the legend can sit as a
  // small annotation in the top-right corner of a chart rather than as a primary
  // sidebar column.
  compact?: boolean;
  // Fired with the hovered row's key on mouseenter and with null on mouseleave.
  // The parent uses this to dim non-hovered slices in the corresponding chart.
  onRowHover?: (key: string | null) => void;
  // Optional column headers. Color swatch column never gets a header.
  headers?: { label: string; value: string; share?: string };
}> = ({ rows, total, valueFormatter, compact, onRowHover, headers }) => {
  // Width tokens shared between the header row and each body row so the columns
  // actually line up. Keep them as constants instead of inlining so changing one
  // tier (e.g. value column width) only needs editing in one place.
  // Non-compact bumps up at xl: on a 2K monitor the legend has enough horizontal
  // room to deserve `text-sm` instead of squinting at `text-xs`. Compact stays
  // tight for the in-chart annotation use case.
  const swatch = compact ? 'size-2' : 'size-2.5 xl:size-3';
  const valueCol = 'min-w-[2.5rem] text-right';
  const shareCol = compact ? 'w-8 text-right' : 'w-10 text-right xl:w-12';
  const rowGap = compact ? 'gap-1.5' : 'gap-2 xl:gap-3';
  return (
    <div
      className={`flex-1 min-w-0 ${compact ? 'text-[10px]' : 'text-xs xl:text-sm'}`}
      onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
    >
      {headers && (
        <div
          className={`flex items-center px-1 pb-1 font-medium uppercase tracking-wide text-muted-foreground/70 ${rowGap} ${compact ? 'text-[9px]' : 'text-[10px] xl:text-xs'}`}
        >
          {/* Spacer to align with the color swatch column on each row */}
          <span className={`shrink-0 ${swatch}`} aria-hidden="true" />
          <span className="flex-1 truncate">{headers.label}</span>
          <span className={`tabular-nums ${valueCol}`}>{headers.value}</span>
          {headers.share && <span className={`tabular-nums ${shareCol}`}>{headers.share}</span>}
        </div>
      )}
      <ul className={compact ? 'space-y-0.5' : 'space-y-1'}>
        {rows.map((row) => {
          const pct = total > 0 ? (row.value / total) * 100 : 0;
          return (
            <li
              key={row.key}
              className={`flex items-center rounded-sm transition-colors px-1 py-0.5 ${rowGap} ${onRowHover ? 'cursor-default hover:bg-muted/60' : ''}`}
              onMouseEnter={onRowHover ? () => onRowHover(row.key) : undefined}
            >
              <span
                className={`shrink-0 rounded-[2px] ${swatch}`}
                style={{ backgroundColor: row.color }}
                aria-hidden="true"
              />
              <span className="flex-1 truncate text-foreground">{row.label}</span>
              {/* Numeric columns are demoted to muted text — the color signal
                  lives in the swatch chip on the left, not in the numbers. */}
              <span className={`tabular-nums text-muted-foreground ${valueCol}`}>
                {valueFormatter(row.value)}
              </span>
              <span className={`font-medium tabular-nums text-muted-foreground ${shareCol}`}>
                {pct.toFixed(pct >= 10 ? 0 : 1)}%
              </span>
            </li>
          );
        })}
      </ul>
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

// Mockup — automatic controls for the project (budget alerts, deadline reminders,
// stale-task pings). Rendered as a static, read-only preview so we can pin down the
// shape with the user before wiring rule storage, evaluation, and notifications.
const ProjectRulesMockup: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation(['projects']);
  const rules: Array<{ id: string; icon: string; enabled: boolean }> = [
    { id: 'budgetThreshold', icon: 'fa-piggy-bank', enabled: true },
    { id: 'deadlineApproaching', icon: 'fa-calendar-day', enabled: true },
    { id: 'staleTask', icon: 'fa-hourglass-half', enabled: false },
    { id: 'unassignedTask', icon: 'fa-user-slash', enabled: false },
  ];
  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold leading-none">
            {t('projects:detail.rules.title')}
          </h2>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('projects:detail.rules.comingSoonBadge')}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{t('projects:detail.rules.description')}</p>
      </div>
      <div className="rounded-lg border border-dashed border-border bg-background/40 p-1">
        <ul className="divide-y divide-border">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-start justify-between gap-3 px-3 py-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <i className={`fa-solid ${rule.icon}`} aria-hidden="true"></i>
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {t(`projects:detail.rules.items.${rule.id}.name`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`projects:detail.rules.items.${rule.id}.description`)}
                  </p>
                </div>
              </div>
              <Toggle checked={rule.enabled} onChange={() => {}} disabled />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default ProjectDetailView;
