import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type GeneralSettingsState,
  INITIAL_EMAIL_CONFIG,
  INITIAL_GENERAL_SETTINGS,
  INITIAL_LDAP_CONFIG,
} from './authScopedDefaults';
import ClientsInvoicesView from './components/accounting/ClientsInvoicesView';
import ClientsOrdersView from './components/accounting/ClientsOrdersView';
import SupplierInvoicesView from './components/accounting/SupplierInvoicesView';
import SupplierOrdersView from './components/accounting/SupplierOrdersView';
import AuthSettings from './components/administration/AuthSettings';
import EmailSettings from './components/administration/EmailSettings';
import GeneralSettings from './components/administration/GeneralSettings';
import LogsView from './components/administration/LogsView';
import RolesView from './components/administration/RolesView';
import UserManagement from './components/administration/UserManagement';
import WebhooksView from './components/administration/WebhooksView';
import ClientsView from './components/CRM/ClientsView';
import SuppliersView from './components/CRM/SuppliersView';
import InternalListingView from './components/catalog/InternalListingView';
import DocsHubView from './components/docs/DocsHubView';
import ErrorBoundary from './components/ErrorBoundary';
import ExternalEmployeesView from './components/HR/ExternalEmployeesView';
import InternalEmployeesView from './components/HR/InternalEmployeesView';
import Layout from './components/Layout';
import Login from './components/Login';
import NotFound from './components/NotFound';

// Lazy-load the detail view so the recharts bundle (~150kB) only ships when a user
// actually navigates to a project detail page — keeps the initial app bundle slim.
const ProjectDetailView = lazy(() => import('./components/projects/ProjectDetailView'));
const ApiDocsView = lazy(() => import('./components/docs/ApiDocsView'));
const FrontendDocsView = lazy(() => import('./components/docs/FrontendDocsView'));

import ProjectsView, { type ProjectsViewTab } from './components/projects/ProjectsView';
import ResalesView from './components/projects/ResalesView';
import AiReportingView from './components/reports/AiReportingView';
import SessionTimeoutHandler from './components/SessionTimeoutHandler';
import ClientOffersView from './components/sales/ClientOffersView';
import ClientQuotesView from './components/sales/ClientQuotesView';
import SupplierQuotesView from './components/sales/SupplierQuotesView';
import Calendar from './components/shared/Calendar';
import SelectControl from './components/shared/SelectControl';
import StandardTable, { type Column } from './components/shared/StandardTable';
import StatusBadge from './components/shared/StatusBadge';
import DailyView from './components/timesheet/DailyView';
import EntryEditDialog from './components/timesheet/EntryEditDialog';
import RecurringManager from './components/timesheet/RecurringManager';
import RilView from './components/timesheet/RilView';
import WeeklyView from './components/timesheet/WeeklyView';
import UserSettings, { type UserSettingsTab } from './components/UserSettings';
import { Toaster } from './components/ui/sonner';
import WorkUnitsView from './components/WorkUnitsView';
import { CurrentUserIdProvider } from './contexts/CurrentUserContext';
import { makeClientHandlers } from './hooks/handlers/clientHandlers';
import { makeEntryHandlers } from './hooks/handlers/entryHandlers';
import { makeInvoiceHandlers } from './hooks/handlers/invoiceHandlers';
import { makeLdapHandlers } from './hooks/handlers/ldapHandlers';
import { makeProductHandlers } from './hooks/handlers/productHandlers';
import { makeProjectHandlers } from './hooks/handlers/projectHandlers';
import { makeQuoteHandlers } from './hooks/handlers/quoteHandlers';
import { makeResaleHandlers } from './hooks/handlers/resaleHandlers';
import { makeSupplierHandlers } from './hooks/handlers/supplierHandlers';
import { makeSupplierInvoiceHandlers } from './hooks/handlers/supplierInvoiceHandlers';
import { makeSupplierQuoteHandlers } from './hooks/handlers/supplierQuoteHandlers';
import {
  createTaskUpdateQueueState,
  makeTaskHandlers,
  type TaskUpdateQueueState,
} from './hooks/handlers/taskHandlers';
import { makeUserHandlers } from './hooks/handlers/userHandlers';
import { useAuth } from './hooks/useAuth';
import { useLatestRef } from './hooks/useLatestRef';
import { listRequest, useModuleLoader } from './hooks/useModuleLoader';
import api, { type McpTokenScope, type PersonalAccessToken, type Settings } from './services/api';
import { decodeEntriesCursor } from './services/api/entries';
import type {
  QuoteCommunicationChannel,
  QuoteCommunicationChannelIcon,
} from './services/api/quoteCommunicationChannels';
import type {
  AppBranding,
  Client,
  ClientOffer,
  ClientsOrder,
  EmailConfig,
  GeneralSettings as IGeneralSettings,
  Invoice,
  LdapConfig,
  MfaExemptionUser,
  Notification,
  Product,
  Project,
  ProjectTask,
  Quote,
  Resale,
  ResaleCategory,
  ResaleOrderOption,
  ResponsibleUserOption,
  Role,
  SsoProvider,
  Supplier,
  SupplierInvoice,
  SupplierQuote,
  SupplierSaleOrder,
  TimeEntry,
  TimeEntryLocation,
  User,
  View,
  WorkUnit,
} from './types';
import { clearAuthScopedState } from './utils/authScopedState';
import { formatDateOnlyForLocale, getLocalDateString } from './utils/date';
import { getTechnicalDocsViewFromPathname } from './utils/docsRoutes';
import { getErrorMessage } from './utils/errors';
import {
  type ParsedViewHash,
  parseViewHash,
  resolveHashChange,
} from './utils/hashCanonicalization';
import {
  getStaleModuleScopedKeys,
  getStaleModulesAfterNavigation,
  type ModuleScopedStateKey,
} from './utils/moduleScopedState';
import { normalizeCurrency } from './utils/normalizeCurrency';
import { formatDecimal } from './utils/numbers';
import {
  ADMIN_ROLE_ID,
  buildPermission,
  equivalentPermissionsFor,
  getDefaultViewForPermissions,
  getNotFoundReturnView,
  hasAnyPermission,
  hasPermission,
  hasViewAccess,
  TOP_MANAGER_ROLE_ID,
  VIEW_PERMISSION_MAP,
} from './utils/permissions';
import {
  createProgrammaticHashTracker,
  type ProgrammaticHashTracker,
} from './utils/programmaticHashTracker';
import { retryTransient } from './utils/retry';
import {
  DEFAULT_RIL_EXIT_TIME,
  DEFAULT_RIL_START_TIME,
  normalizeRilNoteOptions,
  normalizeRilTransferOptions,
} from './utils/ril';
import { sourcesSupplierQuote } from './utils/supplierLineSync';
import { applyBrowserTheme, applyTheme, getTheme } from './utils/theme';
import { getTimesheetLoadRequirements } from './utils/timesheetLoadRequirements';
import { toastError } from './utils/toast';
import {
  filterTrackerCatalogs,
  type TrackerAssignmentState,
  type TrackerAssignments,
} from './utils/trackerCatalogs';

type AppModuleState = {
  users: User[];
  mfaExemptionUsers: MfaExemptionUser[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  resales: Resale[];
  resaleCategories: ResaleCategory[];
  resaleOrderOptions: ResaleOrderOption[];
  products: Product[];
  quotes: Quote[];
  quoteCommunicationChannels: QuoteCommunicationChannel[];
  clientOffers: ClientOffer[];
  clientsOrders: ClientsOrder[];
  invoices: Invoice[];
  suppliers: Supplier[];
  supplierQuotes: SupplierQuote[];
  supplierOrders: SupplierSaleOrder[];
  supplierInvoices: SupplierInvoice[];
  entries: TimeEntry[];
  workUnits: WorkUnit[];
  responsibleUserOptions: ResponsibleUserOption[];
};

const INITIAL_APP_MODULE_STATE: AppModuleState = {
  users: [],
  mfaExemptionUsers: [],
  clients: [],
  projects: [],
  projectTasks: [],
  resales: [],
  resaleCategories: [],
  resaleOrderOptions: [],
  products: [],
  quotes: [],
  quoteCommunicationChannels: [],
  clientOffers: [],
  clientsOrders: [],
  invoices: [],
  suppliers: [],
  supplierQuotes: [],
  supplierOrders: [],
  supplierInvoices: [],
  entries: [],
  workUnits: [],
  responsibleUserOptions: [],
};

type AppModuleStateSetAction = {
  [Key in keyof AppModuleState]: {
    type: 'set';
    key: Key;
    value: React.SetStateAction<AppModuleState[Key]>;
  };
}[keyof AppModuleState];

type AppModuleStateAction =
  | AppModuleStateSetAction
  | { type: 'clear-keys'; keys: readonly ModuleScopedStateKey[] };

const resolveAppModuleStateAction = <Value,>(
  value: React.SetStateAction<Value>,
  previous: Value,
): Value => (typeof value === 'function' ? (value as (prev: Value) => Value)(previous) : value);

const appModuleStateReducer = (
  state: AppModuleState,
  action: AppModuleStateAction,
): AppModuleState => {
  switch (action.type) {
    case 'set': {
      const previous = state[action.key] as AppModuleState[keyof AppModuleState];
      const nextValue = resolveAppModuleStateAction(
        action.value as React.SetStateAction<AppModuleState[keyof AppModuleState]>,
        previous,
      );
      if (Object.is(nextValue, previous)) return state;
      return { ...state, [action.key]: nextValue };
    }
    case 'clear-keys': {
      let next: AppModuleState | null = null;
      for (const key of action.keys) {
        if (state[key].length === 0) continue;
        next ??= { ...state };
        next[key] = INITIAL_APP_MODULE_STATE[key] as never;
      }
      return next ?? state;
    }
  }
};

type AppNavigationState = {
  activeView: View | '404';
  userSettingsTab: UserSettingsTab;
  clientQuoteFilterId: string | null;
  clientOfferFilterId: string | null;
  supplierQuoteFilterId: string | null;
  supplierOrderFilterId: string | null;
  clientsOrderFilterId: string | null;
  productFilterId: string | null;
  selectedProjectId: string | null;
  viewingUserId: string;
};

type AppNavigationStringKey = 'viewingUserId';
type AppNavigationNullableKey = Exclude<
  keyof AppNavigationState,
  'activeView' | 'viewingUserId' | 'userSettingsTab'
>;

type AppNavigationAction =
  | { type: 'set-active-view'; activeView: View | '404' }
  | { type: 'set-user-settings-tab'; tab: UserSettingsTab }
  | { type: 'open-user-settings'; tab: UserSettingsTab }
  | {
      type: 'set-nullable';
      key: AppNavigationNullableKey;
      value: React.SetStateAction<string | null>;
    }
  | {
      type: 'set-string';
      key: AppNavigationStringKey;
      value: React.SetStateAction<string>;
    };

const VALID_INITIAL_VIEWS: readonly View[] = [
  'timesheets/tracker',
  'timesheets/ril',
  'timesheets/recurring',
  'administration/user-management',
  'administration/roles',
  'administration/authentication',
  'administration/general',
  'administration/email',
  'administration/logs',
  'administration/webhooks',
  'crm/clients',
  'crm/suppliers',
  'sales/client-quotes',
  'sales/client-offers',
  'sales/supplier-quotes',
  'accounting/clients-orders',
  'accounting/clients-invoices',
  'accounting/supplier-orders',
  'accounting/supplier-invoices',
  'catalog/internal-listing',
  'projects/manage',
  'projects/detail',
  'projects/resales',
  'projects/tasks',
  'hr/internal',
  'hr/external',
  'hr/work-units',
  'reports/ai-reporting',
  'settings',
  'docs',
  'docs/api',
  'docs/frontend',
];

const resolveInitialActiveView = (initialViewHash: ParsedViewHash): View | '404' => {
  const technicalDocsView = getTechnicalDocsViewFromPathname(window.location.pathname);
  if (technicalDocsView) return technicalDocsView;

  const canonicalHash = initialViewHash.path;
  const hash = canonicalHash as View;
  return VALID_INITIAL_VIEWS.includes(hash)
    ? hash
    : canonicalHash === '' || canonicalHash === 'login'
      ? 'timesheets/tracker'
      : '404';
};

const createInitialNavigationState = (initialViewHash: ParsedViewHash): AppNavigationState => ({
  activeView: resolveInitialActiveView(initialViewHash),
  userSettingsTab: 'profile',
  clientQuoteFilterId: null,
  clientOfferFilterId: null,
  supplierQuoteFilterId:
    initialViewHash.path === 'sales/supplier-quotes' ? initialViewHash.filterId : null,
  supplierOrderFilterId:
    initialViewHash.path === 'accounting/supplier-orders' ? initialViewHash.filterId : null,
  clientsOrderFilterId: null,
  productFilterId:
    initialViewHash.path === 'catalog/internal-listing' ? initialViewHash.filterId : null,
  selectedProjectId: null,
  viewingUserId: '',
});

const appNavigationReducer = (
  state: AppNavigationState,
  action: AppNavigationAction,
): AppNavigationState => {
  switch (action.type) {
    case 'set-active-view': {
      const next: AppNavigationState = { ...state, activeView: action.activeView };
      if (action.activeView === 'settings') next.userSettingsTab = 'profile';
      if (
        action.activeView !== 'sales/client-quotes' &&
        action.activeView !== 'sales/client-offers'
      ) {
        next.clientQuoteFilterId = null;
      }
      if (
        action.activeView !== 'sales/client-offers' &&
        action.activeView !== 'accounting/clients-orders'
      ) {
        next.clientOfferFilterId = null;
      }
      if (
        action.activeView !== 'sales/supplier-quotes' &&
        action.activeView !== 'accounting/supplier-orders'
      ) {
        next.supplierQuoteFilterId = null;
      }
      if (action.activeView !== 'accounting/supplier-orders') {
        next.supplierOrderFilterId = null;
      }
      if (action.activeView !== 'accounting/clients-orders') {
        next.clientsOrderFilterId = null;
      }
      if (action.activeView !== 'catalog/internal-listing') {
        next.productFilterId = null;
      }
      if (action.activeView !== 'projects/detail') {
        next.selectedProjectId = null;
      }
      return next;
    }
    case 'set-user-settings-tab':
      return Object.is(action.tab, state.userSettingsTab)
        ? state
        : { ...state, userSettingsTab: action.tab };
    case 'open-user-settings':
      return {
        ...appNavigationReducer(state, { type: 'set-active-view', activeView: 'settings' }),
        userSettingsTab: action.tab,
      };
    case 'set-nullable': {
      const nextValue = resolveAppModuleStateAction(action.value, state[action.key]);
      return Object.is(nextValue, state[action.key])
        ? state
        : { ...state, [action.key]: nextValue };
    }
    case 'set-string': {
      const nextValue = resolveAppModuleStateAction(action.value, state[action.key]);
      return Object.is(nextValue, state[action.key])
        ? state
        : { ...state, [action.key]: nextValue };
    }
  }
};

type NotificationsState = {
  items: Notification[];
  unreadCount: number;
};

type AppLocalState = {
  ldapConfig: LdapConfig;
  generalSettings: GeneralSettingsState;
  branding: AppBranding;
  ssoProviders: SsoProvider[];
  emailConfig: EmailConfig;
  roles: Role[];
  notificationsState: NotificationsState;
  viewingUserAssignmentState: TrackerAssignmentState;
};

const INITIAL_APP_LOCAL_STATE: AppLocalState = {
  ldapConfig: INITIAL_LDAP_CONFIG,
  generalSettings: INITIAL_GENERAL_SETTINGS,
  branding: { companyName: null, logoUrl: null },
  ssoProviders: [],
  emailConfig: INITIAL_EMAIL_CONFIG,
  roles: [],
  notificationsState: { items: [], unreadCount: 0 },
  viewingUserAssignmentState: {
    userId: '',
    assignments: null,
    catalogs: null,
    isLoading: false,
  },
};

const toGeneralSettingsState = (genSettings: IGeneralSettings): GeneralSettingsState => ({
  ...genSettings,
  currency: normalizeCurrency(genSettings.currency),
  geminiApiKey: genSettings.geminiApiKey || '',
  aiProvider: genSettings.aiProvider || 'gemini',
  openrouterApiKey: genSettings.openrouterApiKey || '',
  anthropicApiKey: genSettings.anthropicApiKey || '',
  geminiModelId: genSettings.geminiModelId || '',
  openrouterModelId: genSettings.openrouterModelId || '',
  anthropicModelId: genSettings.anthropicModelId || '',
  defaultLocation: genSettings.defaultLocation || 'remote',
  rilCompanyName: genSettings.rilCompanyName || '',
  rilDefaultStartTime: genSettings.rilDefaultStartTime || DEFAULT_RIL_START_TIME,
  rilDefaultExitTime: genSettings.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME,
  rilLunchBreakMinutes: genSettings.rilLunchBreakMinutes ?? 60,
  rilNoteOptions: normalizeRilNoteOptions(genSettings.rilNoteOptions),
  rilTransferOptions: normalizeRilTransferOptions(genSettings.rilTransferOptions),
});

type AppLocalStateAction = {
  [Key in keyof AppLocalState]: {
    type: 'set';
    key: Key;
    value: React.SetStateAction<AppLocalState[Key]>;
  };
}[keyof AppLocalState];

const appLocalStateReducer = (state: AppLocalState, action: AppLocalStateAction): AppLocalState => {
  const previous = state[action.key] as AppLocalState[keyof AppLocalState];
  const nextValue = resolveAppModuleStateAction(
    action.value as React.SetStateAction<AppLocalState[keyof AppLocalState]>,
    previous,
  );
  return Object.is(nextValue, previous) ? state : { ...state, [action.key]: nextValue };
};

const getCurrencySymbol = (currency: string) => {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return currency;
  }
};

const getModuleFromView = (view: View | '404'): string | null => {
  if (view === '404') return null;
  if (view.startsWith('timesheets/')) return 'timesheets';
  if (view.startsWith('crm/')) return 'crm';
  if (view.startsWith('sales/')) return 'sales';
  if (view.startsWith('catalog/')) return 'catalog';
  if (view.startsWith('hr/')) return 'hr';
  if (view.startsWith('projects/')) return 'projects';
  if (view.startsWith('accounting/')) return 'accounting';
  if (view.startsWith('suppliers/')) return 'suppliers';
  if (view.startsWith('reports/')) return 'reports';
  if (view.startsWith('administration/')) return 'administration';
  if (view === 'settings') return 'settings';
  return null;
};

const isUserScopedTimesheetView = (view: View | '404') =>
  view === 'timesheets/tracker' || view === 'timesheets/ril';

const EMPTY_PERMISSIONS: string[] = [];

type TestEmailResult = { success: boolean; code: string; params?: Record<string, string> };

const updateUserPassword = async (currentPassword: string, newPassword: string) => {
  try {
    await api.settings.updatePassword(currentPassword, newPassword);
  } catch (err) {
    console.error('Failed to update password:', err);
    throw err;
  }
};

const listMcpTokens = () => api.settings.listMcpTokens();

const createMcpToken = (name: string, scope: McpTokenScope) =>
  api.settings.createMcpToken(name, scope);

const revokeMcpToken = (id: string) => api.settings.revokeMcpToken(id);

const testEmail = async (recipientEmail: string): Promise<TestEmailResult> => {
  try {
    const result = await api.email.sendTestEmail(recipientEmail);
    return result;
  } catch (err) {
    console.error('Failed to send test email:', err);
    return {
      success: false,
      code: 'TEST_EMAIL_ERROR',
      params: { error: err instanceof Error ? err.message : 'Failed to send test email' },
    };
  }
};

type TimeEntryDraft = Omit<
  TimeEntry,
  'id' | 'createdAt' | 'version' | 'userId' | 'hourlyCost' | 'cost'
>;

const TrackerModeToggle: React.FC<{
  mode: 'daily' | 'weekly';
  onModeChange: (mode: 'daily' | 'weekly') => void;
}> = ({ mode, onModeChange }) => {
  const { t } = useTranslation('timesheets');

  return (
    <div className="flex justify-center">
      <div className="relative grid grid-cols-2 bg-background border border-border shadow-sm p-1 rounded-full w-full max-w-60">
        <div
          className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-muted rounded-full shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            mode === 'daily' ? 'translate-x-0 left-1' : 'translate-x-full left-1'
          }`}
        ></div>
        <button
          type="button"
          onClick={() => onModeChange('daily')}
          className={`relative z-10 w-full py-2 text-xs font-bold transition-colors duration-300 ${mode === 'daily' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('tracker.mode.daily')}
        </button>
        <button
          type="button"
          onClick={() => onModeChange('weekly')}
          className={`relative z-10 w-full py-2 text-xs font-bold transition-colors duration-300 ${mode === 'weekly' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('tracker.mode.weekly')}
        </button>
      </div>
    </div>
  );
};

const TrackerUserSelector: React.FC<{
  availableUsers: User[];
  currentUser: User;
  viewingUserId: string;
  onViewUserChange: (id: string) => void;
}> = ({ availableUsers, currentUser, viewingUserId, onViewUserChange }) => {
  const { t } = useTranslation('timesheets');
  const viewingUser = availableUsers.find((u) => u.id === viewingUserId);
  const isViewingSelf = viewingUserId === currentUser.id;
  const userOptions = useMemo(
    () =>
      availableUsers.map((u) => ({
        id: u.id,
        name: u.name,
        badge: u.id === currentUser.id ? t('tracker.you') : undefined,
      })),
    [availableUsers, currentUser.id, t],
  );

  if (availableUsers.length <= 1) return null;

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-lg border border-border bg-background shadow-sm p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`size-9 rounded-full flex items-center justify-center font-bold text-xs shadow-sm shrink-0 ${isViewingSelf ? 'bg-praetor/10 text-praetor' : 'bg-amber-500/10 text-amber-600'}`}
          >
            {viewingUser?.avatarInitials}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              {isViewingSelf ? t('tracker.myTimesheet') : t('tracker.managingUser')}
            </p>
            <p className="text-sm font-bold text-foreground truncate">{viewingUser?.name}</p>
          </div>
        </div>
        <div className="w-full sm:w-56 space-y-1.5 shrink-0">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <FieldLabel>{t('tracker.switchUserView')}</FieldLabel>
            {!isViewingSelf && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onViewUserChange(currentUser.id)}
                className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>
                {t('tracker.backToMe')}
              </Button>
            )}
          </div>
          <SelectControl
            options={userOptions}
            value={viewingUserId}
            onChange={(val) => onViewUserChange(val as string)}
            searchable={true}
          />
        </div>
      </div>
    </div>
  );
};

const TrackerActivityTable: React.FC<{
  selectedDate: string;
  entries: TimeEntry[];
  dailyTotal: number;
  dailyGoal: number;
  onEditEntry: (entry: TimeEntry) => void;
  onDeleteEntryClick: (entry: TimeEntry) => void;
}> = ({ selectedDate, entries, dailyTotal, dailyGoal, onEditEntry, onDeleteEntryClick }) => {
  const { t } = useTranslation('timesheets');
  const activityHeaderExtras = useMemo(
    () =>
      selectedDate ? (
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            {t('tracker.dayTotal')}
          </span>
          <span
            className={`text-lg font-black transition-colors ${dailyTotal > dailyGoal ? 'text-destructive' : 'text-praetor'}`}
          >
            {formatDecimal(dailyTotal)} h
          </span>
        </div>
      ) : undefined,
    [dailyGoal, dailyTotal, selectedDate, t],
  );
  const activityColumns = useMemo<Column<TimeEntry>[]>(
    () => [
      { id: 'date', header: t('entry.date'), accessorKey: 'date', hidden: !!selectedDate },
      {
        id: 'client',
        header: t('entry.client'),
        accessorKey: 'clientName',
        cell: ({ row }) => <span className="font-semibold text-zinc-800">{row.clientName}</span>,
      },
      {
        id: 'project',
        header: t('entry.project'),
        accessorKey: 'projectName',
        cell: ({ row }) => <span className="font-semibold text-zinc-800">{row.projectName}</span>,
      },
      {
        id: 'task',
        header: t('entry.task'),
        accessorKey: 'task',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-800">{row.task}</span>
            {row.isPlaceholder && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <i className="fa-solid fa-repeat text-[10px] text-praetor/70" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('entry.recurringTask')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        id: 'location',
        header: t('entry.location'),
        accessorKey: 'location',
        cell: ({ row }) =>
          row.location ? (
            <StatusBadge
              type={row.location}
              label={t(
                `entry.locationTypes.${row.location.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase())}`,
              )}
            />
          ) : (
            <span className="text-zinc-300 text-xs">-</span>
          ),
      },
      {
        id: 'notes',
        header: t('tracker.notes'),
        accessorKey: 'notes',
        className: 'whitespace-normal',
        cell: ({ row }) =>
          row.notes ? (
            <div className="text-zinc-500 text-xs italic leading-relaxed">{row.notes}</div>
          ) : (
            <span className="text-zinc-300 text-xs">-</span>
          ),
      },
      {
        id: 'duration',
        header: t('entry.hours'),
        accessorKey: 'duration',
        cell: ({ row }) => (
          <span className="font-black text-zinc-900">
            {row.isPlaceholder && row.duration === 0 ? '--' : formatDecimal(row.duration)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('common:labels.actions', { defaultValue: 'Actions' }),
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right',
        cell: ({ row }) => (
          <div className="inline-flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditEntry(row);
                    }}
                    className="text-muted-foreground hover:text-praetor"
                  >
                    <i className="fa-solid fa-pen text-xs"></i>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteEntryClick(row);
                    }}
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
    ],
    [selectedDate, t, onEditEntry, onDeleteEntryClick],
  );

  return (
    <StandardTable<TimeEntry>
      title={
        selectedDate
          ? t('tracker.activityFor', {
              date: formatDateOnlyForLocale(selectedDate, undefined, {
                month: 'long',
                day: 'numeric',
              }),
            })
          : t('entry.recentActivity')
      }
      headerExtras={activityHeaderExtras}
      data={entries}
      columns={activityColumns}
      defaultRowsPerPage={10}
      rowClassName={(row) => (row.isPlaceholder ? 'bg-praetor/5 italic' : '')}
      emptyState={
        <div className="px-6 py-20 text-center">
          <i className="fa-solid fa-calendar-day text-4xl text-zinc-100 mb-4 block" />
          <p className="text-zinc-400 font-medium text-sm">{t('tracker.noEntries')}</p>
        </div>
      }
    />
  );
};

const RecurringEntryDeleteModal: React.FC<{
  entry: TimeEntry;
  onAction: (action: 'stop' | 'delete_future' | 'delete_all') => void;
  onCancel: () => void;
}> = ({ entry, onAction, onCancel }) => {
  const { t } = useTranslation('timesheets');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-zinc-100">
          <h3 className="text-lg font-semibold text-zinc-800 flex items-center gap-2">
            <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
            {t('entry.stopRecurringTask')}
          </h3>
          <p className="text-sm text-zinc-500 mt-1">
            {t('entry.howHandleEntries')} <strong className="text-zinc-800">{entry.task}</strong>?
          </p>
        </div>

        <div className="p-4 space-y-3">
          <button
            type="button"
            onClick={() => onAction('stop')}
            className="w-full text-left p-4 rounded-xl border border-zinc-200 hover:border-praetor/30 hover:bg-praetor/5 transition-all group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-zinc-800 group-hover:text-praetor">
                {t('recurring.stopOnly')}
              </span>
              <i className="fa-solid fa-pause text-zinc-300 group-hover:text-praetor"></i>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">{t('recurring.stopOnlyDesc')}</p>
          </button>

          <button
            type="button"
            onClick={() => onAction('delete_future')}
            className="w-full text-left p-4 rounded-xl border border-zinc-200 hover:border-red-300 hover:bg-red-50 transition-all group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-zinc-800 group-hover:text-red-700">
                {t('recurring.deleteFuture')}
              </span>
              <i className="fa-solid fa-forward text-zinc-300 group-hover:text-red-500"></i>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {t('recurring.deleteFutureDesc')}
            </p>
          </button>

          <button
            type="button"
            onClick={() => onAction('delete_all')}
            className="w-full text-left p-4 rounded-xl border border-red-100 bg-red-50/50 hover:bg-red-100 hover:border-red-300 transition-all group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-red-700">{t('recurring.deleteAll')}</span>
              <i className="fa-solid fa-dumpster-fire text-red-400 group-hover:text-red-600"></i>
            </div>
            <p className="text-xs text-red-600/70 leading-relaxed">
              {t('recurring.deleteAllDesc')}
            </p>
          </button>
        </div>

        <div className="p-4 bg-zinc-50 border-t border-zinc-100 text-right">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            {t('entry.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

const TrackerView: React.FC<{
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAddEntry: (entry: TimeEntryDraft) => void;
  onDeleteEntry: (id: string) => void;
  onUpdateEntry: (
    id: string,
    updates: Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>,
  ) => void;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  allowWeekendSelection: boolean;
  onMakeRecurring: (
    taskId: string,
    pattern: 'daily' | 'weekly' | 'monthly' | string,
    startDate?: string,
    endDate?: string,
    duration?: number,
  ) => void | Promise<void>;
  permissions: string[];
  viewingUserId: string;
  onViewUserChange: (id: string) => void;
  availableUsers: User[];
  currentUser: User;
  dailyGoal: number;
  onAddBulkEntries: (entries: TimeEntryDraft[]) => Promise<void>;
  onRecurringAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
  defaultLocation?: TimeEntryLocation;
  onAddCustomTask: (
    name: string,
    projectId: string,
    recurringConfig?: { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' },
    description?: string,
    details?: Pick<
      ProjectTask,
      'monthlyEffort' | 'duration' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => Promise<ProjectTask>;
  currency: string;
}> = ({
  entries,
  clients,
  projects,
  projectTasks,
  onAddEntry,
  onDeleteEntry,
  onUpdateEntry,
  startOfWeek,
  treatSaturdayAsHoliday,
  allowWeekendSelection,
  onMakeRecurring,
  permissions,
  viewingUserId,
  onViewUserChange,
  availableUsers,
  currentUser,
  dailyGoal,
  onAddBulkEntries,
  onRecurringAction,
  defaultLocation = 'remote',
  onAddCustomTask,
  currency,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString());
  const [trackerMode, setTrackerMode] = useState<'daily' | 'weekly'>(() => {
    const saved = localStorage.getItem('trackerMode');
    return saved === 'daily' || saved === 'weekly' ? saved : 'daily';
  });

  useEffect(() => {
    localStorage.setItem('trackerMode', trackerMode);
  }, [trackerMode]);

  const filteredEntries = useMemo(() => {
    if (!selectedDate) return entries;
    return entries.filter((e) => e.date === selectedDate);
  }, [entries, selectedDate]);

  const dailyTotal = useMemo(() => {
    return filteredEntries.reduce((sum, e) => sum + e.duration, 0);
  }, [filteredEntries]);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<TimeEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  const handleDeleteClick = useCallback(
    (entry: TimeEntry) => {
      const task = projectTasks.find(
        (t) => t.name === entry.task && t.projectId === entry.projectId,
      );
      if (entry.isPlaceholder || task?.isRecurring) {
        // Show modal for recurring entries
        // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is an event handler, not a functional state updater.
        setPendingDeleteEntry(entry);
      } else {
        // Direct delete for normal entries
        onDeleteEntry(entry.id);
      }
    },
    [projectTasks, onDeleteEntry],
  );

  const handleRecurringDelete = (action: 'stop' | 'delete_future' | 'delete_all') => {
    if (!pendingDeleteEntry) return;
    const task = projectTasks.find(
      (t) => t.name === pendingDeleteEntry.task && t.projectId === pendingDeleteEntry.projectId,
    );
    if (task) {
      onRecurringAction(task.id, action);
    }
    setPendingDeleteEntry(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <TrackerModeToggle mode={trackerMode} onModeChange={setTrackerMode} />
      <TrackerUserSelector
        availableUsers={availableUsers}
        currentUser={currentUser}
        viewingUserId={viewingUserId}
        onViewUserChange={onViewUserChange}
      />

      {trackerMode === 'weekly' ? (
        <WeeklyView
          entries={entries}
          clients={clients}
          projects={projects}
          projectTasks={projectTasks}
          permissions={permissions}
          currency={currency}
          onAddCustomTask={onAddCustomTask}
          onAddBulkEntries={onAddBulkEntries}
          onUpdateEntry={onUpdateEntry}
          onDeleteEntry={onDeleteEntry}
          viewingUserId={viewingUserId}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
          startOfWeek={startOfWeek}
          treatSaturdayAsHoliday={treatSaturdayAsHoliday}
          allowWeekendSelection={allowWeekendSelection}
          defaultLocation={defaultLocation}
          dailyGoal={dailyGoal}
        />
      ) : (
        <div className="space-y-6">
          <div className="w-full xl:w-[calc(45%+300px+1.5rem)] xl:mx-auto space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start xl:items-stretch">
              <DailyView
                clients={clients}
                projects={projects}
                projectTasks={projectTasks}
                onAdd={onAddEntry}
                selectedDate={selectedDate}
                onMakeRecurring={onMakeRecurring}
                permissions={permissions}
                dailyGoal={dailyGoal}
                currentDayTotal={dailyTotal}
                defaultLocation={defaultLocation}
                onAddCustomTask={onAddCustomTask}
                currency={currency}
              />

              <div className="w-full xl:max-w-[300px] xl:h-full">
                <Calendar
                  selectedDate={selectedDate}
                  onDateSelect={setSelectedDate}
                  entries={entries}
                  startOfWeek={startOfWeek}
                  treatSaturdayAsHoliday={treatSaturdayAsHoliday}
                  dailyGoal={dailyGoal}
                  allowWeekendSelection={allowWeekendSelection}
                  size="compact"
                />
              </div>
            </div>

            <TrackerActivityTable
              selectedDate={selectedDate}
              entries={filteredEntries}
              dailyTotal={dailyTotal}
              dailyGoal={dailyGoal}
              onEditEntry={setEditingEntry}
              onDeleteEntryClick={handleDeleteClick}
            />
          </div>
        </div>
      )}

      <EntryEditDialog
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onSave={onUpdateEntry}
        clients={clients}
        projects={projects}
        projectTasks={projectTasks}
        permissions={permissions}
        currency={currency}
        onAddCustomTask={onAddCustomTask}
      />

      {pendingDeleteEntry && (
        <RecurringEntryDeleteModal
          entry={pendingDeleteEntry}
          onAction={handleRecurringDelete}
          onCancel={() => setPendingDeleteEntry(null)}
        />
      )}
    </div>
  );
};

const handleGeneralSettingsUpdateError = (err: unknown) => {
  console.error('Failed to update general settings:', err);
  toastError('Failed to update settings');
};
const useAppContentController = () => {
  const { t: tApp } = useTranslation(['common', 'reports', 'sales', 'accounting']);

  const [moduleState, dispatchModuleState] = useReducer(
    appModuleStateReducer,
    INITIAL_APP_MODULE_STATE,
  );
  const {
    users,
    mfaExemptionUsers,
    clients,
    projects,
    projectTasks,
    resales,
    resaleCategories,
    resaleOrderOptions,
    products,
    quotes,
    quoteCommunicationChannels,
    clientOffers,
    clientsOrders,
    invoices,
    suppliers,
    supplierQuotes,
    supplierOrders,
    supplierInvoices,
    entries,
    workUnits,
    responsibleUserOptions,
  } = moduleState;
  const setUsers = useCallback<React.Dispatch<React.SetStateAction<User[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'users', value }),
    [],
  );
  const setMfaExemptionUsers = useCallback<
    React.Dispatch<React.SetStateAction<MfaExemptionUser[]>>
  >((value) => dispatchModuleState({ type: 'set', key: 'mfaExemptionUsers', value }), []);
  const setClients = useCallback<React.Dispatch<React.SetStateAction<Client[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'clients', value }),
    [],
  );
  const setProjects = useCallback<React.Dispatch<React.SetStateAction<Project[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'projects', value }),
    [],
  );
  const setProjectTasks = useCallback<React.Dispatch<React.SetStateAction<ProjectTask[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'projectTasks', value }),
    [],
  );
  const setResales = useCallback<React.Dispatch<React.SetStateAction<Resale[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'resales', value }),
    [],
  );
  const setResaleCategories = useCallback<React.Dispatch<React.SetStateAction<ResaleCategory[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'resaleCategories', value }),
    [],
  );
  const setResaleOrderOptions = useCallback<
    React.Dispatch<React.SetStateAction<ResaleOrderOption[]>>
  >((value) => dispatchModuleState({ type: 'set', key: 'resaleOrderOptions', value }), []);
  const setProducts = useCallback<React.Dispatch<React.SetStateAction<Product[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'products', value }),
    [],
  );
  const setQuotes = useCallback<React.Dispatch<React.SetStateAction<Quote[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'quotes', value }),
    [],
  );
  const setQuoteCommunicationChannels = useCallback<
    React.Dispatch<React.SetStateAction<QuoteCommunicationChannel[]>>
  >((value) => dispatchModuleState({ type: 'set', key: 'quoteCommunicationChannels', value }), []);
  const setClientOffers = useCallback<React.Dispatch<React.SetStateAction<ClientOffer[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'clientOffers', value }),
    [],
  );
  const setClientsOrders = useCallback<React.Dispatch<React.SetStateAction<ClientsOrder[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'clientsOrders', value }),
    [],
  );
  const setInvoices = useCallback<React.Dispatch<React.SetStateAction<Invoice[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'invoices', value }),
    [],
  );
  const setSuppliers = useCallback<React.Dispatch<React.SetStateAction<Supplier[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'suppliers', value }),
    [],
  );
  const setSupplierQuotes = useCallback<React.Dispatch<React.SetStateAction<SupplierQuote[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'supplierQuotes', value }),
    [],
  );
  const setSupplierOrders = useCallback<React.Dispatch<React.SetStateAction<SupplierSaleOrder[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'supplierOrders', value }),
    [],
  );
  const setSupplierInvoices = useCallback<React.Dispatch<React.SetStateAction<SupplierInvoice[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'supplierInvoices', value }),
    [],
  );
  const setEntries = useCallback<React.Dispatch<React.SetStateAction<TimeEntry[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'entries', value }),
    [],
  );
  const setWorkUnits = useCallback<React.Dispatch<React.SetStateAction<WorkUnit[]>>>(
    (value) => dispatchModuleState({ type: 'set', key: 'workUnits', value }),
    [],
  );
  const setResponsibleUserOptions = useCallback<
    React.Dispatch<React.SetStateAction<ResponsibleUserOption[]>>
  >((value) => dispatchModuleState({ type: 'set', key: 'responsibleUserOptions', value }), []);
  const taskUpdateQueueStateRef = useRef<TaskUpdateQueueState | null>(null);
  if (taskUpdateQueueStateRef.current === null) {
    taskUpdateQueueStateRef.current = createTaskUpdateQueueState();
  }
  const taskUpdateQueueState = taskUpdateQueueStateRef.current;
  // Bumped on logout/role-switch so in-flight cursor streams stop appending stale rows.
  const entriesStreamTokenRef = useRef(0);
  // Bumped on navigation/auth reset so stale module-load completions cannot commit state.
  const moduleLoadTokenRef = useRef(0);
  const loadedTimesheetsViewRef = useRef<string | null>(null);
  const [localState, dispatchLocalState] = useReducer(
    appLocalStateReducer,
    INITIAL_APP_LOCAL_STATE,
  );
  const {
    ldapConfig,
    generalSettings,
    branding,
    ssoProviders,
    emailConfig,
    roles,
    notificationsState,
    viewingUserAssignmentState,
  } = localState;
  const setLdapConfig = useCallback<React.Dispatch<React.SetStateAction<LdapConfig>>>(
    (value) => dispatchLocalState({ type: 'set', key: 'ldapConfig', value }),
    [],
  );
  const setGeneralSettings = useCallback<
    React.Dispatch<React.SetStateAction<GeneralSettingsState>>
  >((value) => dispatchLocalState({ type: 'set', key: 'generalSettings', value }), []);
  const setBranding = useCallback<React.Dispatch<React.SetStateAction<AppBranding>>>(
    (value) => dispatchLocalState({ type: 'set', key: 'branding', value }),
    [],
  );
  const setSsoProviders = useCallback<React.Dispatch<React.SetStateAction<SsoProvider[]>>>(
    (value) => dispatchLocalState({ type: 'set', key: 'ssoProviders', value }),
    [],
  );
  const setEmailConfig = useCallback<React.Dispatch<React.SetStateAction<EmailConfig>>>(
    (value) => dispatchLocalState({ type: 'set', key: 'emailConfig', value }),
    [],
  );
  const setRoles = useCallback<React.Dispatch<React.SetStateAction<Role[]>>>(
    (value) => dispatchLocalState({ type: 'set', key: 'roles', value }),
    [],
  );
  const setNotificationsState = useCallback<
    React.Dispatch<React.SetStateAction<NotificationsState>>
  >((value) => dispatchLocalState({ type: 'set', key: 'notificationsState', value }), []);
  const setViewingUserAssignmentState = useCallback<
    React.Dispatch<React.SetStateAction<TrackerAssignmentState>>
  >((value) => dispatchLocalState({ type: 'set', key: 'viewingUserAssignmentState', value }), []);
  // Branding is public and must persist across login/logout so the login screen
  // and sidebar stay consistent. clearAuthScopedAppState intentionally leaves it alone.
  const {
    loadedModules,
    moduleLoadErrors,
    isModuleLoaded,
    isModuleLoading,
    loadDatasets,
    markModuleLoaded,
    invalidateModules,
    recordFailures,
    appendFailure,
    reset: resetModuleLoader,
  } = useModuleLoader();
  const hasLoadedGeneralSettingsRef = useRef(false);
  const generalSettingsLoadPromiseRef = useRef<Promise<IGeneralSettings> | null>(null);
  const hasLoadedLdapConfigRef = useRef(false);
  const hasLoadedSsoProvidersRef = useRef(false);
  const hasLoadedEmailConfigRef = useRef(false);
  const hasLoadedGeneralSettings = hasLoadedGeneralSettingsRef.current;

  const hasLoadedRolesRef = useRef(false);

  const loadGeneralSettingsOnce = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      if (hasLoadedGeneralSettingsRef.current) return;
      if (generalSettingsLoadPromiseRef.current === null) {
        generalSettingsLoadPromiseRef.current = api.generalSettings.get().finally(() => {
          generalSettingsLoadPromiseRef.current = null;
        });
      }

      const genSettings = await generalSettingsLoadPromiseRef.current;
      if (!shouldApply() || hasLoadedGeneralSettingsRef.current) return;

      setGeneralSettings(toGeneralSettingsState(genSettings));
      hasLoadedGeneralSettingsRef.current = true;
    },
    [setGeneralSettings],
  );

  // Items and unread count share one state so handlers can derive both from
  // `prev` in a single updater — splitting them races the 60s polling refresh
  // (issue #513).
  const notifications = notificationsState.items;
  const unreadNotificationCount = notificationsState.unreadCount;
  const VALID_VIEWS: View[] = useMemo(
    () => [
      'timesheets/tracker',
      'timesheets/ril',
      'timesheets/recurring',
      'administration/user-management',
      'administration/roles',
      'administration/authentication',
      'administration/general',
      'administration/email',
      'administration/logs',
      'administration/webhooks',
      'crm/clients',
      'crm/suppliers',
      // Sales module
      'sales/client-quotes',
      'sales/client-offers',
      'sales/supplier-quotes',
      // Accounting module
      'accounting/clients-orders',
      'accounting/clients-invoices',
      'accounting/supplier-orders',
      'accounting/supplier-invoices',
      // Catalog module
      'catalog/internal-listing',
      'projects/manage',
      'projects/detail',
      'projects/resales',
      'projects/tasks',
      'hr/internal',
      'hr/external',
      'hr/work-units',
      // Reports module
      'reports/ai-reporting',
      'settings',
      'docs',
      'docs/api',
      'docs/frontend',
    ],
    [],
  );

  // Parsed once at mount: a quick-view link opened in a fresh tab arrives as a
  // deep link (`#/<view>?filterId=<id>`). The view + filter id are seeded into
  // state below so the target page renders pre-filtered with no 404 flash. The
  // hash-sync effect later normalizes the query out of the address bar.
  const initialViewHashRef = useRef<ParsedViewHash | null>(null);
  if (initialViewHashRef.current === null) {
    initialViewHashRef.current = parseViewHash(window.location.hash);
  }
  const initialViewHash = initialViewHashRef.current;

  const [navigationState, dispatchNavigation] = useReducer(
    appNavigationReducer,
    initialViewHash,
    createInitialNavigationState,
  );
  const {
    activeView,
    userSettingsTab,
    clientQuoteFilterId,
    clientOfferFilterId,
    supplierQuoteFilterId,
    supplierOrderFilterId,
    clientsOrderFilterId,
    productFilterId,
    selectedProjectId,
    viewingUserId,
  } = navigationState;
  const setClientQuoteFilterId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => dispatchNavigation({ type: 'set-nullable', key: 'clientQuoteFilterId', value }),
    [],
  );
  const setClientOfferFilterId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => dispatchNavigation({ type: 'set-nullable', key: 'clientOfferFilterId', value }),
    [],
  );
  const setSupplierQuoteFilterId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => dispatchNavigation({ type: 'set-nullable', key: 'supplierQuoteFilterId', value }),
    [],
  );
  const setSupplierOrderFilterId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => dispatchNavigation({ type: 'set-nullable', key: 'supplierOrderFilterId', value }),
    [],
  );
  const setClientsOrderFilterId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => dispatchNavigation({ type: 'set-nullable', key: 'clientsOrderFilterId', value }),
    [],
  );
  const setSelectedProjectId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => dispatchNavigation({ type: 'set-nullable', key: 'selectedProjectId', value }),
    [],
  );
  const setViewingUserId = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => dispatchNavigation({ type: 'set-string', key: 'viewingUserId', value }),
    [],
  );
  const setUserSettingsTab = useCallback((tab: UserSettingsTab) => {
    dispatchNavigation({ type: 'set-user-settings-tab', tab });
  }, []);
  const openRilPreferences = useCallback(() => {
    dispatchNavigation({ type: 'open-user-settings', tab: 'ril' });
  }, []);

  // Navigation-aware setter: clears any *FilterId state that isn't valid for
  // the destination view, batched in the SAME commit as the view change.
  // Combined with the latest-value refs below, this gives two defenses
  // against stale filter IDs after async navigation: the setter clears
  // synchronously on view change, and handler factories read filter IDs via
  // refs so in-flight awaits still observe the latest value.
  const activeViewRef = useLatestRef<View | '404'>(activeView);
  const currentUserRef = useRef<User | null>(null);
  const viewingUserIdRef = useLatestRef(viewingUserId);
  // Short-circuits hashchange events fired by our own writes. See
  // utils/programmaticHashTracker.ts for why this is a counter rather than a
  // single-value marker (issue #623). Also still prevents an infinite rewrite
  // loop if canonicalizeLegacyHash ever becomes non-idempotent (issue #540).
  const programmaticHashTrackerRef = useRef<ProgrammaticHashTracker | null>(null);
  if (programmaticHashTrackerRef.current === null) {
    programmaticHashTrackerRef.current = createProgrammaticHashTracker();
  }
  const programmaticHashTracker = programmaticHashTrackerRef.current;
  const setActiveView = useCallback<React.Dispatch<React.SetStateAction<View | '404'>>>(
    (next) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: View | '404') => View | '404')(activeViewRef.current)
          : next;
      dispatchNavigation({ type: 'set-active-view', activeView: resolved });
      if (resolved !== 'projects/detail') {
        setSelectedProjectId(null);
      }
      const currentUser = currentUserRef.current;
      if (
        currentUser &&
        !isUserScopedTimesheetView(resolved) &&
        viewingUserIdRef.current !== currentUser.id
      ) {
        viewingUserIdRef.current = currentUser.id;
        React.startTransition(() => setViewingUserId(currentUser.id));
      }
    },
    [activeViewRef, setSelectedProjectId, setViewingUserId, viewingUserIdRef],
  );
  const setProjectsViewTab = useCallback(
    (tab: ProjectsViewTab) => setActiveView(tab === 'tasks' ? 'projects/tasks' : 'projects/manage'),
    [setActiveView],
  );

  // Latest-value refs for handler factories. The handlers read these BEFORE
  // and AFTER awaited API calls; getters backed by refs let the memoized
  // factories observe up-to-date state once promises resolve (a navigation can
  // clear `clientQuoteFilterId` mid-await, or a new project can land between
  // factory creation and a `clients.remove()` call, for example).
  const clientQuoteFilterIdRef = useLatestRef(clientQuoteFilterId);
  const clientOfferFilterIdRef = useLatestRef(clientOfferFilterId);
  const supplierQuoteFilterIdRef = useLatestRef(supplierQuoteFilterId);
  const projectsRef = useLatestRef(projects);
  const quotesRef = useLatestRef(quotes);
  const clientOffersRef = useLatestRef(clientOffers);

  const clearAuthScopedAppState = useCallback(() => {
    // Bump cancellation tokens before any setter call so in-flight async
    // commits (module loads, entries pagination) gate out before their
    // continuations can fire — the setters are queued, but these ref
    // writes take effect synchronously.
    moduleLoadTokenRef.current++;
    entriesStreamTokenRef.current++;
    resetModuleLoader();
    const setModuleState = <Key extends keyof AppModuleState>(
      key: Key,
      value: React.SetStateAction<AppModuleState[Key]>,
    ) => {
      dispatchModuleState({ type: 'set', key, value } as AppModuleStateSetAction);
    };
    const setLocalState = <Key extends keyof AppLocalState>(
      key: Key,
      value: React.SetStateAction<AppLocalState[Key]>,
    ) => {
      dispatchLocalState({ type: 'set', key, value } as AppLocalStateAction);
    };
    const setGeneralSettings = (value: React.SetStateAction<GeneralSettingsState>) => {
      setLocalState('generalSettings', value);
    };
    const setLdapConfig = (value: React.SetStateAction<LdapConfig>) => {
      setLocalState('ldapConfig', value);
    };
    const setEmailConfig = (value: React.SetStateAction<EmailConfig>) => {
      setLocalState('emailConfig', value);
    };
    clearAuthScopedState({
      hasLoadedGeneralSettings: () => {
        hasLoadedGeneralSettingsRef.current = false;
        generalSettingsLoadPromiseRef.current = null;
      },
      generalSettings: () => setGeneralSettings(INITIAL_GENERAL_SETTINGS),
      hasLoadedLdapConfig: () => {
        hasLoadedLdapConfigRef.current = false;
      },
      ldapConfig: () => setLdapConfig(INITIAL_LDAP_CONFIG),
      hasLoadedEmailConfig: () => {
        hasLoadedEmailConfigRef.current = false;
      },
      emailConfig: () => setEmailConfig(INITIAL_EMAIL_CONFIG),
      hasLoadedSsoProviders: () => {
        hasLoadedSsoProvidersRef.current = false;
      },
      ssoProviders: () => setLocalState('ssoProviders', []),
      hasLoadedRoles: () => {
        hasLoadedRolesRef.current = false;
      },
      roles: () => setLocalState('roles', []),
      users: () => setModuleState('users', []),
      mfaExemptionUsers: () => setModuleState('mfaExemptionUsers', []),
      clients: () => setModuleState('clients', []),
      projects: () => setModuleState('projects', []),
      projectTasks: () => setModuleState('projectTasks', []),
      resales: () => setModuleState('resales', []),
      resaleCategories: () => setModuleState('resaleCategories', []),
      resaleOrderOptions: () => setModuleState('resaleOrderOptions', []),
      products: () => setModuleState('products', []),
      quotes: () => setModuleState('quotes', []),
      quoteCommunicationChannels: () => setModuleState('quoteCommunicationChannels', []),
      clientOffers: () => setModuleState('clientOffers', []),
      clientsOrders: () => setModuleState('clientsOrders', []),
      invoices: () => setModuleState('invoices', []),
      suppliers: () => setModuleState('suppliers', []),
      supplierQuotes: () => setModuleState('supplierQuotes', []),
      supplierOrders: () => setModuleState('supplierOrders', []),
      supplierInvoices: () => setModuleState('supplierInvoices', []),
      entries: () => setModuleState('entries', []),
      workUnits: () => setModuleState('workUnits', []),
      responsibleUserOptions: () => setModuleState('responsibleUserOptions', []),
      viewingUserAssignmentState: () =>
        setLocalState('viewingUserAssignmentState', {
          userId: '',
          assignments: null,
          catalogs: null,
          isLoading: false,
        }),
    });
  }, [resetModuleLoader]);

  const {
    currentUser,
    isAuthenticated,
    isLoading,
    logoutReason,
    clearLogoutReason,
    userSettings,
    setUserSettings,
    login,
    logout,
    switchRole,
    serverUnreachable,
    dismissServerUnreachable,
  } = useAuth({
    onLogin: (user) => {
      currentUserRef.current = user;
      viewingUserIdRef.current = user.id;
      clearAuthScopedAppState();
      setViewingUserId(user.id);
      const defaultView = getDefaultViewForPermissions(user.permissions || [], VALID_VIEWS);
      const canAccessActive =
        activeView !== '404' ? hasViewAccess(user.permissions || [], activeView as View) : false;
      if (activeView === '404' || !canAccessActive) {
        setActiveView(defaultView);
      }
    },
    onLogout: () => {
      currentUserRef.current = null;
      viewingUserIdRef.current = '';
      clearAuthScopedAppState();
      setViewingUserId('');
    },
  });

  // Read by the hashchange listener (mounted once) so it sees the latest committed user
  // without the effect resubscribing — events fired during teardown are lost.
  useLayoutEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // The inactivity timer is global session state, so load its admin policy once per
  // authenticated session instead of depending on whichever module datasets happen to run.
  useEffect(() => {
    if (!currentUser) return;

    let isCancelled = false;
    loadGeneralSettingsOnce(() => !isCancelled).catch((err) => {
      if (!isCancelled) console.error('Failed to load general settings:', err);
    });

    return () => {
      isCancelled = true;
    };
  }, [currentUser, loadGeneralSettingsOnce]);

  // The login screen always follows the OS/browser color scheme; the signed-in
  // app honors the user's saved theme. applyBrowserTheme() never persists, so a
  // logged-out screen can't clobber the stored preference. useLayoutEffect runs
  // before paint so the correct theme is in place without a flash on toggle.
  // Login additionally self-themes its own scope via useBrowserTheme so it's
  // correct even on a cold, token-less load where this effect runs before Login
  // mounts; the call here keeps the global theme state and any portaled overlays
  // in sync with the OS while logged out — both are intentional, not redundant.
  useLayoutEffect(() => {
    if (isAuthenticated) {
      applyTheme(getTheme());
    } else {
      applyBrowserTheme();
    }
  }, [isAuthenticated]);

  // App-wide branding (company name + logo) is public so the login screen can render it
  // before any user authenticates. Fetched once on mount; failures fall back to the
  // bundled Praetor defaults already held in state.
  useEffect(() => {
    let cancelled = false;
    api.branding
      .getPublic()
      .then((next) => {
        if (!cancelled) setBranding(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setBranding]);

  const handleLogin = login;
  const handleLogout = logout;
  const handleSwitchRole = useCallback(
    async (roleId: string) => {
      try {
        await switchRole(roleId);
      } catch (err) {
        console.error('Failed to switch role:', err);
        toastError(`Failed to switch role: ${getErrorMessage(err)}`);
      }
    },
    [switchRole],
  );

  const notifyClientOfferCreated = useCallback(
    (offerId: string) => {
      toast.success(tApp('sales:clientQuotes.offerCreatedToast'), {
        description: offerId,
        action: {
          label: tApp('sales:clientQuotes.viewOffer'),
          onClick: () => {
            setClientQuoteFilterId(null);
            setClientOfferFilterId(offerId);
            setActiveView('sales/client-offers');
          },
        },
      });
    },
    [setActiveView, setClientQuoteFilterId, setClientOfferFilterId, tApp],
  );

  const notifyClientOrderCreated = useCallback(
    (orderId: string) => {
      toast.success(tApp('accounting:clientsOrders.orderCreatedToast'), {
        description: orderId,
        action: {
          label: tApp('accounting:clientsOrders.viewOrder'),
          onClick: () => {
            setClientsOrderFilterId(orderId);
            setActiveView('accounting/clients-orders');
          },
        },
      });
    },
    [setActiveView, setClientsOrderFilterId, tApp],
  );

  const notifySupplierOrderCreated = useCallback(
    (order: { id: string; supplierName: string }) => {
      toast.success(tApp('accounting:supplierOrders.orderCreatedToast'), {
        description: `${order.id} - ${order.supplierName}`,
        action: {
          label: tApp('accounting:supplierOrders.viewOrder'),
          onClick: () => {
            setSupplierOrderFilterId(order.id);
            setActiveView('accounting/supplier-orders');
          },
        },
      });
    },
    [setActiveView, setSupplierOrderFilterId, tApp],
  );

  const supplierQuoteHandlers = useMemo(
    () =>
      makeSupplierQuoteHandlers({
        // Getter backed by a ref so reads after awaited API calls see the
        // latest value instead of the snapshot captured at factory creation.
        getSupplierQuoteFilterId: () => supplierQuoteFilterIdRef.current,
        setSupplierQuotes,
        setSupplierOrders,
        setSupplierInvoices,
        setSupplierQuoteFilterId,
        setActiveView,
      }),
    [
      setActiveView,
      setSupplierQuotes,
      setSupplierOrders,
      setSupplierInvoices,
      setSupplierQuoteFilterId,
      supplierQuoteFilterIdRef,
    ],
  );

  const quoteHandlers = useMemo(
    () =>
      makeQuoteHandlers({
        // Getters back onto refs so reads after awaited API calls see the
        // latest value instead of the snapshot captured at factory creation.
        getClientQuoteFilterId: () => clientQuoteFilterIdRef.current,
        getClientOfferFilterId: () => clientOfferFilterIdRef.current,
        getQuotes: () => quotesRef.current,
        getClientOffers: () => clientOffersRef.current,
        setQuotes,
        setClientOffers,
        setClientsOrders,
        setInvoices,
        setClientQuoteFilterId,
        setClientOfferFilterId,
        setActiveView,
        refreshSupplierQuoteFlow: supplierQuoteHandlers.refreshSupplierQuoteFlow,
        notifyClientOfferCreated,
        notifyClientOrderCreated,
        notifySupplierOrderCreated,
      }),
    [
      supplierQuoteHandlers.refreshSupplierQuoteFlow,
      setActiveView,
      setQuotes,
      setClientOffers,
      setClientsOrders,
      setInvoices,
      clientOfferFilterIdRef,
      clientOffersRef,
      clientQuoteFilterIdRef,
      quotesRef,
      setClientQuoteFilterId,
      setClientOfferFilterId,
      notifyClientOfferCreated,
      notifyClientOrderCreated,
      notifySupplierOrderCreated,
    ],
  );

  const clientHandlers = useMemo(
    () =>
      makeClientHandlers({
        // Getter backed by a ref so the post-await read of `projects` sees the
        // latest snapshot rather than the one captured at factory creation.
        getProjects: () => projectsRef.current,
        setClients,
        setProjects,
        setProjectTasks,
      }),
    [projectsRef, setClients, setProjects, setProjectTasks],
  );

  const productHandlers = useMemo(() => makeProductHandlers({ setProducts }), [setProducts]);

  const projectHandlers = useMemo(
    () =>
      makeProjectHandlers({
        setProjects,
        setProjectTasks,
        setEntries,
      }),
    [setProjects, setProjectTasks, setEntries],
  );

  const resaleHandlers = useMemo(
    () =>
      makeResaleHandlers({
        setResales,
        setResaleCategories,
      }),
    [setResales, setResaleCategories],
  );

  const entryHandlers = useMemo(
    () =>
      makeEntryHandlers({
        currentUser,
        viewingUserId,
        setEntries,
      }),
    [currentUser, viewingUserId, setEntries],
  );

  const invoiceHandlers = useMemo(() => makeInvoiceHandlers({ setInvoices }), [setInvoices]);

  const ldapHandlers = useMemo(() => makeLdapHandlers({ setLdapConfig }), [setLdapConfig]);

  const refreshMfaExemptionUsers = useCallback(async () => {
    const permissions = currentUser?.permissions || [];
    const canRefreshMfaExemptions =
      hasPermission(permissions, VIEW_PERMISSION_MAP['administration/authentication']) &&
      hasPermission(permissions, 'administration.general.update');
    if (!canRefreshMfaExemptions) return;

    try {
      const options = await api.users.listTotpExemptionOptions();
      setMfaExemptionUsers(options);
    } catch (err) {
      console.error('Failed to refresh MFA exemption users:', err);
    }
  }, [currentUser?.permissions, setMfaExemptionUsers]);
  const supplierHandlers = useMemo(() => makeSupplierHandlers({ setSuppliers }), [setSuppliers]);

  const supplierInvoiceHandlers = useMemo(
    () =>
      makeSupplierInvoiceHandlers({
        setSupplierInvoices,
        setActiveView,
      }),
    [setActiveView, setSupplierInvoices],
  );

  const userHandlers = useMemo(
    () =>
      makeUserHandlers({
        currentUser,
        viewingUserId,
        setUsers,
        setRoles,
        setWorkUnits,
        setViewingUserId,
        refreshMfaExemptionUsers,
      }),
    [
      currentUser,
      viewingUserId,
      setUsers,
      setRoles,
      setWorkUnits,
      setViewingUserId,
      refreshMfaExemptionUsers,
    ],
  );

  const quoteIdsWithOffers = useMemo(() => {
    const ids = new Set<string>();
    clientOffers.forEach((offer) => {
      if (offer.linkedQuoteId) {
        ids.add(offer.linkedQuoteId);
      }
    });
    return ids;
  }, [clientOffers]);

  const quoteOfferStatuses = useMemo(() => {
    const map: Record<string, ClientOffer['status']> = {};
    clientOffers.forEach((offer) => {
      if (offer.linkedQuoteId) {
        map[offer.linkedQuoteId] = offer.status;
      }
    });
    return map;
  }, [clientOffers]);

  const offerIdsWithOrders = useMemo(() => {
    return new Set(
      clientsOrders.map((order) => order.linkedOfferId).filter((id): id is string => Boolean(id)),
    );
  }, [clientsOrders]);

  const orderIdsWithInvoices = useMemo(() => {
    const ids = new Set<string>();
    supplierInvoices.forEach((invoice) => {
      if (invoice.linkedSaleId) {
        ids.add(invoice.linkedSaleId);
      }
    });
    return ids;
  }, [supplierInvoices]);

  const isRouteAccessible = useMemo(() => {
    if (activeView === 'docs' || activeView === 'docs/api' || activeView === 'docs/frontend') {
      return true;
    }
    if (!currentUser) return false;
    if (activeView === '404') return false;
    if (activeView === 'reports/ai-reporting') {
      if (hasLoadedGeneralSettings && !generalSettings.enableAiReporting) return false;
    }

    return hasViewAccess(currentUser.permissions, activeView as View);
  }, [activeView, currentUser, hasLoadedGeneralSettings, generalSettings.enableAiReporting]);
  const activeLoadModuleRef = useLatestRef(
    currentUser && isRouteAccessible ? getModuleFromView(activeView) : null,
  );

  // Redirect to 404 if route is not accessible
  useEffect(() => {
    if (currentUser && !isRouteAccessible && activeView !== '404') {
      React.startTransition(() => setActiveView('404'));
    }
  }, [currentUser, isRouteAccessible, activeView, setActiveView]);

  // Sync hash with activeView
  useEffect(() => {
    if (isLoading) return;
    if (activeView === 'docs/api' || activeView === 'docs/frontend') {
      const targetPath = activeView === 'docs/api' ? '/docs/api' : '/docs/frontend';
      if (window.location.pathname !== targetPath) {
        window.history.replaceState(null, '', targetPath);
      }
      return;
    }
    const nextHash = currentUser ? `#/${activeView}` : '#/login';
    if (window.location.hash !== nextHash) {
      // A quick-view deep link arrives as `#/<view>?filterId=...`; once the view
      // and filter are seeded into state we strip the query from the address bar.
      // When only the query differs from the target view, REPLACE the history
      // entry (no `hashchange` fires, so no programmatic-write to register) rather
      // than pushing — otherwise Back would return to the query-bearing hash, which
      // the live resolver below would treat as an unknown view and route to 404.
      const targetPath = currentUser ? activeView : 'login';
      if (parseViewHash(window.location.hash).path === targetPath) {
        window.history.replaceState(null, '', nextHash);
      } else {
        programmaticHashTracker.registerWrite();
        window.location.hash = nextHash.slice(1);
      }
    }
  }, [activeView, currentUser, isLoading, programmaticHashTracker]);

  // Filter-id cleanup now happens inside `setActiveView` itself - any caller
  // (navigation handlers, hash-change listener, Layout menu) goes through that
  // wrapper, so the four *FilterId values can never outlive a view change.

  // Sync state with hash (for back/forward buttons). Listener is mounted once
  // and reads latest values via refs — resubscribing on every navigation would
  // drop hashchange events that fire between removeEventListener and the next
  // addEventListener call during rapid back/forward clicking.
  const handleHashChange = useEffectEvent(() => {
    if (programmaticHashTracker.consumeIfPending()) return;
    // Strip any deep-link query (`?filterId=...`) before resolving, so a
    // back/forward to a quick-view hash maps to its view instead of a 404.
    const rawHash = parseViewHash(window.location.hash).path;
    const outcome = resolveHashChange({
      rawHash,
      activeView: activeViewRef.current,
      validViews: VALID_VIEWS,
      hasUser: !!currentUserRef.current,
    });
    if (outcome.kind === 'noop') return;
    if (outcome.kind === 'rewrite-hash') {
      // Apply the resolved view in this same call: the follow-up hashchange
      // fired by the rewrite below will be short-circuited by the guard
      // above, so we cannot rely on it to set the view.
      programmaticHashTracker.registerWrite();
      window.location.hash = outcome.newHash.slice(1);
    }
    setActiveView(outcome.view);
  });

  useEffect(() => {
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const generateRecurringEntries = useCallback(async () => {
    if (!currentUser) return;

    const today = new Date();
    const fromDate = getLocalDateString(today);
    const future = new Date(today);
    future.setDate(today.getDate() + 14);
    const toDate = getLocalDateString(future);

    try {
      const result = await api.entries.generateRecurring({ fromDate, toDate });
      if (result.generated.length > 0) {
        setEntries((prev) =>
          [...result.generated, ...prev].sort((a, b) => b.createdAt - a.createdAt),
        );
      }
    } catch (err) {
      console.error('Failed to generate recurring entries:', err);
    }
  }, [currentUser, setEntries]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isRouteAccessible) return;
    const module = getModuleFromView(activeView);
    if (!module) return;
    if (
      isModuleLoaded(module) &&
      (module !== 'timesheets' || loadedTimesheetsViewRef.current === activeView)
    ) {
      return;
    }
    const loadToken = ++moduleLoadTokenRef.current;
    const isCurrentModuleLoad = () =>
      moduleLoadTokenRef.current === loadToken && activeLoadModuleRef.current === module;
    const cancelModuleLoad = () => {
      if (moduleLoadTokenRef.current === loadToken && activeLoadModuleRef.current !== module) {
        moduleLoadTokenRef.current += 1;
      }
    };

    // Clear module-scoped arrays the incoming module isn't going to refresh,
    // so leftover data from a previously-visited module doesn't leak into the
    // new UI before the module's own datasets load. Runs for settings too —
    // settings has no datasets but still represents a module-scope transition.
    const staleKeys = getStaleModuleScopedKeys(module);
    if (staleKeys.includes('entries')) {
      entriesStreamTokenRef.current++;
    }
    dispatchModuleState({ type: 'clear-keys', keys: staleKeys });

    // Drop the previously-visited modules from the loaded set so that revisiting
    // them refetches instead of showing the empty arrays we just cleared.
    invalidateModules(getStaleModulesAfterNavigation(module));

    if (module === 'settings') {
      // Settings has no datasets to load; mark it loaded so we don't re-clear
      // and re-invalidate on every render while the user is on this view.
      if (isCurrentModuleLoad()) markModuleLoaded(module);
      return cancelModuleLoad;
    }

    const loadGeneralSettings = () => loadGeneralSettingsOnce(isCurrentModuleLoad);

    const loadLdapConfig = async () => {
      if (hasLoadedLdapConfigRef.current) return;
      const ldap = await api.ldap.getConfig();
      if (isCurrentModuleLoad()) {
        setLdapConfig(ldap);
        hasLoadedLdapConfigRef.current = true;
      }
    };

    const loadSsoProviders = async () => {
      if (hasLoadedSsoProvidersRef.current) return;
      const providers = await api.sso.listProviders();
      if (isCurrentModuleLoad()) {
        setSsoProviders(providers);
        hasLoadedSsoProvidersRef.current = true;
      }
    };

    const loadAuthenticationConfig = async () => {
      await Promise.all([loadLdapConfig(), loadSsoProviders()]);
    };

    const loadEmailConfig = async () => {
      if (hasLoadedEmailConfigRef.current) return;
      const email = await api.email.getConfig();
      if (isCurrentModuleLoad()) {
        setEmailConfig(email);
        hasLoadedEmailConfigRef.current = true;
      }
    };

    const loadRoles = async () => {
      if (hasLoadedRolesRef.current) return;
      const rolesData = await api.roles.list();
      if (isCurrentModuleLoad()) {
        setRoles(rolesData);
        hasLoadedRolesRef.current = true;
      }
    };

    const loadOptionalDataset = async (
      moduleName: string,
      dataset: string,
      load: () => Promise<void>,
      failures: string[],
    ) => {
      if (!isCurrentModuleLoad()) return;
      try {
        await load();
      } catch (err) {
        if (!isCurrentModuleLoad()) return;
        failures.push(dataset);
        console.error(
          `Failed to load ${moduleName} dataset "${dataset}": ${getErrorMessage(err)}`,
          err,
        );
      }
    };

    const loadModuleData = async () => {
      let failedDatasets: string[] = [];

      try {
        if (!isCurrentModuleLoad()) return;
        const permissions = currentUser.permissions || [];
        const canViewTimesheets = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('timesheets.tracker', 'view'),
          buildPermission('timesheets.ril', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canViewHr = hasAnyPermission(permissions, [
          buildPermission('hr.internal', 'view'),
          buildPermission('hr.external', 'view'),
          ...equivalentPermissionsFor('hr.work_units', 'view'),
        ]);
        const canViewConfiguration = hasAnyPermission(permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('administration.roles', 'view'),
          buildPermission('administration.authentication', 'view'),
          buildPermission('administration.general', 'view'),
          buildPermission('administration.email', 'view'),
        ]);
        const canViewCrm = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('crm.clients', 'view'),
          ...equivalentPermissionsFor('crm.suppliers', 'view'),
        ]);
        const canViewSales = hasAnyPermission(permissions, [
          buildPermission('sales.client_quotes', 'view'),
          buildPermission('sales.client_offers', 'view'),
          buildPermission('sales.supplier_quotes', 'view'),
        ]);
        const canViewCatalog = hasPermission(
          permissions,
          buildPermission('catalog.internal_listing', 'view'),
        );
        const canViewAccounting = hasAnyPermission(permissions, [
          buildPermission('accounting.clients_orders', 'view'),
          buildPermission('accounting.clients_invoices', 'view'),
          buildPermission('accounting.supplier_orders', 'view'),
          buildPermission('accounting.supplier_invoices', 'view'),
        ]);
        const canViewProjects = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('projects.manage', 'view'),
          ...equivalentPermissionsFor('projects.tasks', 'view'),
          buildPermission('projects.resales', 'view'),
        ]);
        const canViewSuppliersModule = hasPermission(
          permissions,
          buildPermission('sales.supplier_quotes', 'view'),
        );
        const canListEntries = hasViewAccess(permissions, 'timesheets/tracker');

        const canListClients = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('crm.clients', 'view'),
          ...equivalentPermissionsFor('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
          ...equivalentPermissionsFor('projects.manage', 'view'),
          ...equivalentPermissionsFor('projects.tasks', 'view'),
          buildPermission('projects.resales', 'view'),
          buildPermission('sales.client_quotes', 'view'),
          buildPermission('sales.client_offers', 'view'),
          // Supplier quotes carry an optional Cliente link (#759), so this view needs the client
          // list too. The backend /clients list route already authorizes this permission.
          buildPermission('sales.supplier_quotes', 'view'),
          buildPermission('accounting.clients_orders', 'view'),
          buildPermission('accounting.clients_invoices', 'view'),
          buildPermission('catalog.internal_listing', 'view'),
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management', 'update'),
        ]);
        const canListProjects = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('projects.manage', 'view'),
          ...equivalentPermissionsFor('projects.tasks', 'view'),
          buildPermission('projects.resales', 'view'),
          ...equivalentPermissionsFor('timesheets.tracker', 'view'),
          buildPermission('timesheets.ril', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canListTasks = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('projects.tasks', 'view'),
          ...equivalentPermissionsFor('projects.manage', 'view'),
          ...equivalentPermissionsFor('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canListUsers = hasAnyPermission(permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('hr.internal', 'view'),
          buildPermission('hr.external', 'view'),
          ...equivalentPermissionsFor('timesheets.tracker', 'view'),
          buildPermission('timesheets.ril', 'view'),
          ...equivalentPermissionsFor('projects.manage', 'view'),
          ...equivalentPermissionsFor('projects.tasks', 'view'),
          buildPermission('projects.resales', 'view'),
          ...equivalentPermissionsFor('hr.work_units', 'view'),
        ]);
        const canListQuotes = hasPermission(
          permissions,
          buildPermission('sales.client_quotes', 'view'),
        );
        const canListClientOffers = hasPermission(
          permissions,
          buildPermission('sales.client_offers', 'view'),
        );
        const canListProducts = hasAnyPermission(permissions, [
          buildPermission('catalog.internal_listing', 'view'),
          buildPermission('sales.supplier_quotes', 'view'),
          buildPermission('sales.client_offers', 'view'),
          buildPermission('accounting.supplier_orders', 'view'),
          buildPermission('accounting.supplier_invoices', 'view'),
        ]);
        const canListSuppliers = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('crm.suppliers', 'view'),
          buildPermission('sales.supplier_quotes', 'view'),
          buildPermission('accounting.supplier_orders', 'view'),
          buildPermission('accounting.supplier_invoices', 'view'),
        ]);
        const canListSupplierQuotes = hasPermission(
          permissions,
          buildPermission('sales.supplier_quotes', 'view'),
        );
        const canListOrders = hasPermission(
          permissions,
          buildPermission('accounting.clients_orders', 'view'),
        );
        const canListProjectOrderOptions = hasAnyPermission(permissions, [
          ...equivalentPermissionsFor('projects.manage', 'view'),
          ...equivalentPermissionsFor('projects.manage', 'create'),
          ...equivalentPermissionsFor('projects.manage', 'update'),
        ]);
        const canListInvoices = hasPermission(
          permissions,
          buildPermission('accounting.clients_invoices', 'view'),
        );
        const canListSupplierOrders = hasPermission(
          permissions,
          buildPermission('accounting.supplier_orders', 'view'),
        );
        const canListSupplierInvoices = hasPermission(
          permissions,
          buildPermission('accounting.supplier_invoices', 'view'),
        );
        const canListWorkUnits = hasViewAccess(permissions, 'hr/work-units');
        const canListResponsibleUsers = hasAnyPermission(permissions, [
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('hr.external', 'create'),
          buildPermission('hr.internal', 'update'),
          buildPermission('hr.external', 'update'),
        ]);
        const canManageEmployeeAssignments = hasPermission(
          permissions,
          buildPermission('hr.employee_assignments', 'update'),
        );
        const canViewUserManagement = hasAnyPermission(permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('administration.user_management', 'create'),
          buildPermission('administration.user_management_all', 'view'),
        ]);
        const canViewRoles = hasPermission(
          permissions,
          buildPermission('administration.roles', 'view'),
        );
        const canViewAuthentication = hasPermission(
          permissions,
          buildPermission('administration.authentication', 'view'),
        );
        const canManageMfa = hasPermission(
          permissions,
          buildPermission('administration.general', 'update'),
        );
        const canViewEmail = hasPermission(
          permissions,
          buildPermission('administration.email', 'view'),
        );
        const canViewCrmClients = hasViewAccess(permissions, 'crm/clients');
        const canViewCrmSuppliers = hasViewAccess(permissions, 'crm/suppliers');
        const canViewCatalogInternal = hasPermission(
          permissions,
          buildPermission('catalog.internal_listing', 'view'),
        );
        const canListResales = hasPermission(
          permissions,
          buildPermission('projects.resales', 'view'),
        );

        switch (module) {
          case 'timesheets': {
            if (!canViewTimesheets) return;
            const requirements = getTimesheetLoadRequirements(activeView);
            // Merge incoming entries with existing state so an in-flight
            // optimistic insert (handleAddEntry / handleAddBulkEntries) isn't
            // dropped when the pager finally resolves. Preserve `prev`'s
            // order: streamed continuation pages arrive older-than-prev (cursor
            // is `<` on `created_at DESC`), so newer rows MUST stay on top —
            // prepending page would reverse chunk order for any user with more
            // than 500 entries. Server still wins on id collisions because
            // matching prev rows are replaced with the page version in place.
            //
            // Drop prev entries that fall inside this page's authoritative
            // (createdAt, id) window but weren't returned — those were deleted
            // on the server (issue #519). Window bounds:
            //   upper: inputCursor exclusive (continuation page); the page's
            //          newest entry inclusive on the first page (preserves
            //          concurrent optimistic inserts whose createdAt is newer
            //          than the snapshot).
            //   lower: the page's oldest entry inclusive when more pages
            //          follow; -Infinity on the last page (page covered
            //          everything older).
            //
            // Comparisons use ms-precision only. pg-node truncates each
            // entry's `createdAt` to a JS Date (ms), but cursors and the
            // server-side row ordering use the column's µs precision. When
            // an entry's ms matches a window-boundary's ms, the µs ordering
            // is unrecoverable on the client — treat the entry as OUTSIDE
            // the window (keep it in prev) rather than rely on an id
            // tiebreaker that may disagree with the server at sub-ms
            // resolution. Trade: a deletion sitting exactly at a sub-ms
            // boundary waits until the next full reload, but we never
            // wrongly drop a row that the server placed on the other side
            // of the cursor.
            const mergeById = (
              prev: TimeEntry[],
              pageEntries: TimeEntry[],
              inputCursor: string | null,
              nextCursor: string | null,
            ): TimeEntry[] => {
              const incoming = new Map(pageEntries.map((entry) => [entry.id, entry]));
              const upperBound = decodeEntriesCursor(inputCursor);
              const newestInPage = pageEntries[0] ?? null;
              const oldestInPage = pageEntries[pageEntries.length - 1] ?? null;
              const hasMorePages = nextCursor !== null;
              const isWithinPageWindow = (entry: TimeEntry): boolean => {
                if (!newestInPage || !oldestInPage) return false;
                if (upperBound) {
                  if (entry.createdAt >= upperBound.createdAt) return false;
                } else if (entry.createdAt >= newestInPage.createdAt) {
                  return false;
                }
                if (hasMorePages && entry.createdAt <= oldestInPage.createdAt) return false;
                return true;
              };
              const seen = new Set<string>();
              const merged: TimeEntry[] = [];
              let changed = false;
              for (const entry of prev) {
                const replacement = incoming.get(entry.id);
                if (replacement) {
                  merged.push(replacement);
                  seen.add(entry.id);
                  if (replacement !== entry) changed = true;
                } else if (!isWithinPageWindow(entry)) {
                  merged.push(entry);
                } else {
                  changed = true;
                }
              }
              for (const entry of pageEntries) {
                if (!seen.has(entry.id)) {
                  merged.push(entry);
                  changed = true;
                }
              }
              return changed ? merged : prev;
            };
            const streamRemainingEntries = async (cursor: string | null, token: number) => {
              const isCancelled = () =>
                !isCurrentModuleLoad() || entriesStreamTokenRef.current !== token;
              while (cursor) {
                const pageCursor = cursor;
                let result: Awaited<ReturnType<typeof api.entries.listPage>> | null;
                try {
                  result = await retryTransient(
                    () => api.entries.listPage({ cursor: pageCursor, limit: 500 }),
                    { isCancelled },
                  );
                } catch (err) {
                  if (isCancelled()) return;
                  console.error('Failed to stream remaining entries:', err);
                  appendFailure(module, 'additional entries');
                  toastError(
                    'Some time entries could not be loaded. Displayed data may be incomplete.',
                  );
                  return;
                }
                if (result === null) return;
                // Bind to a const so TS narrowing survives into the setState closure.
                const page = result;
                setEntries((prev) => mergeById(prev, page.entries, pageCursor, page.nextCursor));
                cursor = page.nextCursor;
              }
            };
            // RIL owns its entry fetch, so it skips the global entries dataset below. Start
            // recurring materialization alongside the remaining preload, then await it before
            // RilView mounts and requests the selected month.
            const rilRecurringGeneration =
              activeView === 'timesheets/ril' &&
              hasPermission(permissions, buildPermission('timesheets.recurring', 'create'))
                ? generateRecurringEntries()
                : null;
            failedDatasets = await loadDatasets(
              module,
              [
                {
                  dataset: 'entries',
                  enabled: requirements.entries && canListEntries,
                  load: () => api.entries.listPage({ limit: 500 }),
                  apply: (page) => {
                    const token = ++entriesStreamTokenRef.current;
                    setEntries((prev) => mergeById(prev, page.entries, null, page.nextCursor));
                    void generateRecurringEntries();
                    if (page.nextCursor) void streamRemainingEntries(page.nextCursor, token);
                  },
                },
                listRequest(
                  'clients',
                  requirements.clients && canListClients,
                  () => api.clients.list(),
                  setClients,
                ),
                listRequest(
                  'projects',
                  requirements.projects && canListProjects,
                  () => api.projects.list(),
                  setProjects,
                ),
                listRequest(
                  'tasks',
                  requirements.tasks && canListTasks,
                  () => api.tasks.list(),
                  setProjectTasks,
                ),
                listRequest(
                  'users',
                  requirements.users && canListUsers,
                  () => api.users.list(),
                  setUsers,
                ),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            if (rilRecurringGeneration) await rilRecurringGeneration;
            // Recurring generation fetches from the server independently of
            // local entries, so still run it when the initial entries fetch fails.
            if (failedDatasets.includes('entries')) {
              void generateRecurringEntries();
            }
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'hr': {
            if (!canViewHr) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest('users', canListUsers, () => api.users.list(), setUsers),
                listRequest(
                  'responsible users',
                  canListResponsibleUsers,
                  () => api.users.getResponsibleOptions(),
                  setResponsibleUserOptions,
                ),
                listRequest(
                  'competence centers',
                  canListWorkUnits,
                  () => api.workUnits.list(),
                  setWorkUnits,
                ),
                listRequest(
                  'clients',
                  canManageEmployeeAssignments && canListClients,
                  () => api.clients.list(),
                  setClients,
                ),
                listRequest(
                  'projects',
                  canManageEmployeeAssignments && canListProjects,
                  () => api.projects.list(),
                  setProjects,
                ),
                listRequest(
                  'tasks',
                  canManageEmployeeAssignments && canListTasks,
                  () => api.tasks.list(),
                  setProjectTasks,
                ),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'administration': {
            if (!canViewConfiguration) return;
            const shouldLoadUsers = canViewUserManagement;
            const shouldLoadMfaExemptionUsers = canViewAuthentication && canManageMfa;
            const shouldLoadRoles = canViewRoles || canViewAuthentication || canViewUserManagement;

            failedDatasets = await loadDatasets(
              module,
              [
                listRequest(
                  'users',
                  shouldLoadUsers && canListUsers,
                  () => api.users.list(),
                  setUsers,
                ),
                listRequest(
                  'MFA exemption users',
                  shouldLoadMfaExemptionUsers,
                  () => api.users.listTotpExemptionOptions(),
                  setMfaExemptionUsers,
                ),
              ],
              { shouldApply: isCurrentModuleLoad },
            );

            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            if (shouldLoadRoles) {
              await loadOptionalDataset(module, 'roles', loadRoles, failedDatasets);
            }
            if (canViewAuthentication) {
              await loadOptionalDataset(
                module,
                'authentication',
                loadAuthenticationConfig,
                failedDatasets,
              );
            }
            if (canViewEmail) {
              await loadOptionalDataset(module, 'email settings', loadEmailConfig, failedDatasets);
            }
            break;
          }
          case 'crm': {
            if (!canViewCrm) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest(
                  'clients',
                  canViewCrmClients && canListClients,
                  () => api.clients.list(),
                  setClients,
                ),
                listRequest(
                  'suppliers',
                  canViewCrmSuppliers && canListSuppliers,
                  () => api.suppliers.list(),
                  setSuppliers,
                ),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'sales': {
            if (!canViewSales) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest('quotes', canListQuotes, () => api.quotes.list(), setQuotes),
                listRequest(
                  'quote communication channels',
                  canListQuotes || canListSupplierQuotes,
                  () => api.quoteCommunicationChannels.list(),
                  setQuoteCommunicationChannels,
                ),
                listRequest(
                  'client offers',
                  canListClientOffers,
                  () => api.clientOffers.list(),
                  setClientOffers,
                ),
                listRequest(
                  'supplier quotes',
                  canListSupplierQuotes,
                  () => api.supplierQuotes.list(),
                  setSupplierQuotes,
                ),
                listRequest('clients', canListClients, () => api.clients.list(), setClients),
                listRequest(
                  'suppliers',
                  canListSuppliers,
                  () => api.suppliers.list(),
                  setSuppliers,
                ),
                listRequest('products', canListProducts, () => api.products.list(), setProducts),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'accounting': {
            if (!canViewAccounting) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest(
                  'client orders',
                  canListOrders,
                  () => api.clientsOrders.list(),
                  setClientsOrders,
                ),
                listRequest('invoices', canListInvoices, () => api.invoices.list(), setInvoices),
                listRequest(
                  'supplier orders',
                  canListSupplierOrders,
                  () => api.supplierOrders.list(),
                  setSupplierOrders,
                ),
                listRequest(
                  'supplier invoices',
                  canListSupplierInvoices,
                  () => api.supplierInvoices.list(),
                  setSupplierInvoices,
                ),
                listRequest('clients', canListClients, () => api.clients.list(), setClients),
                listRequest(
                  'suppliers',
                  canListSuppliers,
                  () => api.suppliers.list(),
                  setSuppliers,
                ),
                listRequest('products', canListProducts, () => api.products.list(), setProducts),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'catalog': {
            if (!canViewCatalog) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest(
                  'products',
                  canListProducts && canViewCatalogInternal,
                  () => api.products.list(),
                  setProducts,
                ),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'projects': {
            if (!canViewProjects) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest('projects', canListProjects, () => api.projects.list(), setProjects),
                listRequest('tasks', canListTasks, () => api.tasks.list(), setProjectTasks),
                listRequest('resales', canListResales, () => api.resales.list(), setResales),
                listRequest(
                  'resale categories',
                  canListResales,
                  () => api.resales.listCategories(),
                  setResaleCategories,
                ),
                listRequest(
                  'resale order options',
                  canListResales,
                  () => api.resales.listOrderOptions(),
                  setResaleOrderOptions,
                ),
                listRequest('clients', canListClients, () => api.clients.list(), setClients),
                listRequest('users', canListUsers, () => api.users.list(), setUsers),
                listRequest(
                  'competence centers',
                  canListWorkUnits,
                  () => api.workUnits.list(),
                  setWorkUnits,
                ),
                listRequest(
                  'client orders',
                  canListProjectOrderOptions,
                  () => api.projects.listOrderOptions(),
                  setClientsOrders,
                ),
                listRequest(
                  'client offers',
                  canListClientOffers,
                  () => api.clientOffers.list(),
                  setClientOffers,
                ),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            break;
          }
          case 'suppliers': {
            if (!canViewSuppliersModule) return;
            failedDatasets = await loadDatasets(
              module,
              [
                listRequest(
                  'suppliers',
                  canListSuppliers,
                  () => api.suppliers.list(),
                  setSuppliers,
                ),
                listRequest(
                  'supplier quotes',
                  canListSupplierQuotes,
                  () => api.supplierQuotes.list(),
                  setSupplierQuotes,
                ),
                listRequest('products', canListProducts, () => api.products.list(), setProducts),
              ],
              { shouldApply: isCurrentModuleLoad },
            );
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
          case 'reports': {
            // Reports pages fetch their own data as needed, but they still depend on global settings
            // (e.g. AI Reporting enablement).
            await loadOptionalDataset(
              module,
              'general settings',
              loadGeneralSettings,
              failedDatasets,
            );
            break;
          }
        }
      } catch (err) {
        if (!isCurrentModuleLoad()) return;
        console.error('Failed to load module data:', err);
        failedDatasets.push('module data');
      } finally {
        if (isCurrentModuleLoad()) {
          const uniqueFailures = Array.from(new Set(failedDatasets));
          recordFailures(module, uniqueFailures);
          if (module === 'timesheets') loadedTimesheetsViewRef.current = activeView;
          markModuleLoaded(module);
        }
      }
    };

    void loadModuleData();
    return cancelModuleLoad;
  }, [
    activeView,
    activeLoadModuleRef,
    currentUser,
    isRouteAccessible,
    isModuleLoaded,
    loadDatasets,
    markModuleLoaded,
    invalidateModules,
    recordFailures,
    appendFailure,
    generateRecurringEntries,
    setEntries,
    setClients,
    setProjects,
    setProjectTasks,
    setUsers,
    setMfaExemptionUsers,
    setWorkUnits,
    setSuppliers,
    setQuotes,
    setQuoteCommunicationChannels,
    setClientOffers,
    setSupplierQuotes,
    setProducts,
    setClientsOrders,
    setInvoices,
    setSupplierOrders,
    setSupplierInvoices,
    setResales,
    setResaleCategories,
    setResaleOrderOptions,
    loadGeneralSettingsOnce,
    setLdapConfig,
    setSsoProviders,
    setEmailConfig,
    setRoles,
    setResponsibleUserOptions,
  ]);

  // Load target user assignments when the timesheet user switcher changes.
  useEffect(() => {
    if (!currentUser || !viewingUserId) return;
    if (activeView !== 'timesheets/tracker') return;

    let isCancelled = false;

    const loadAssignments = async () => {
      if (viewingUserId === currentUser.id) {
        setViewingUserAssignmentState({
          userId: viewingUserId,
          assignments: null,
          catalogs: null,
          isLoading: false,
        });
        return;
      }

      try {
        const canViewAssignments = hasAnyPermission(currentUser.permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('hr.employee_assignments', 'update'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.tracker_all', 'view'),
        ]);

        setViewingUserAssignmentState({
          userId: viewingUserId,
          assignments: null,
          catalogs: null,
          isLoading: true,
        });

        if (!canViewAssignments) {
          if (!isCancelled) {
            setViewingUserAssignmentState({
              userId: viewingUserId,
              assignments: null,
              catalogs: null,
              isLoading: false,
            });
          }
          return;
        }

        const [assignments, catalogs] = await Promise.all([
          api.users.getAssignments(viewingUserId),
          api.users.getTrackerCatalogs(viewingUserId),
        ]);
        if (!isCancelled) {
          setViewingUserAssignmentState({
            userId: viewingUserId,
            assignments: assignments as TrackerAssignments,
            catalogs,
            isLoading: false,
          });
        }
      } catch (err) {
        console.error('Failed to load user assignments:', err);
        if (!isCancelled) {
          setViewingUserAssignmentState({
            userId: viewingUserId,
            assignments: null,
            catalogs: null,
            isLoading: false,
          });
        }
      }
    };

    loadAssignments();

    return () => {
      isCancelled = true;
    };
  }, [activeView, currentUser, viewingUserId, setViewingUserAssignmentState]);

  // Update viewingUserId when currentUser changes
  useEffect(() => {
    if (currentUser) {
      React.startTransition(() => setViewingUserId(currentUser.id));
    }
  }, [currentUser, setViewingUserId]);

  // Load notifications for permitted users
  useEffect(() => {
    if (
      !currentUser ||
      !hasPermission(currentUser.permissions, buildPermission('notifications', 'view'))
    ) {
      setNotificationsState({ items: [], unreadCount: 0 });
      return;
    }

    let isCancelled = false;

    const loadNotifications = async () => {
      try {
        const data = await api.notifications.list();
        if (isCancelled) return;
        setNotificationsState({ items: data.notifications, unreadCount: data.unreadCount });
      } catch (err) {
        if (isCancelled) return;
        console.error('Failed to load notifications:', err);
      }
    };

    // Load immediately and then poll every 60 seconds
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [currentUser, setNotificationsState]);

  // Notification handlers
  const handleMarkNotificationAsRead = useCallback(
    async (id: string) => {
      try {
        await api.notifications.markAsRead(id);
        setNotificationsState((prev) => {
          const target = prev.items.find((n) => n.id === id);
          const wasUnread = !!target && !target.isRead;
          return {
            items: prev.items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
            unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
          };
        });
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    },
    [setNotificationsState],
  );

  const handleMarkAllNotificationsAsRead = useCallback(async () => {
    try {
      await api.notifications.markAllAsRead();
      setNotificationsState((prev) => ({
        items: prev.items.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }));
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, [setNotificationsState]);

  const handleDeleteNotification = useCallback(
    async (id: string) => {
      try {
        await api.notifications.delete(id);
        setNotificationsState((prev) => {
          const target = prev.items.find((n) => n.id === id);
          const wasUnread = !!target && !target.isRead;
          return {
            items: prev.items.filter((n) => n.id !== id),
            unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
          };
        });
      } catch (err) {
        console.error('Failed to delete notification:', err);
      }
    },
    [setNotificationsState],
  );

  // `users` comes from GET /api/users, which is already scoped server-side to
  // what the caller is allowed to see (self, managed work-unit members,
  // visible internal/external employees, or all users for admins). The server
  // also re-validates every downstream action (view/create/update/delete of
  // entries, assignments, tracker catalogs), so we trust the scoped list here
  // rather than re-filtering by `currentUser.permissions` — a client-side
  // filter cannot tell which users the caller manages and would regress
  // managers who don't have `_all` permissions. Fall back to [currentUser]
  // when /api/users wasn't loaded.
  const availableUsers = useMemo(() => {
    if (!currentUser) return [];
    if (users.length > 0) return users;
    return [currentUser];
  }, [users, currentUser]);

  const trackerCatalogs = useMemo(
    () =>
      filterTrackerCatalogs({
        clients,
        projects,
        projectTasks,
        currentUserId: currentUser?.id ?? '',
        viewingUserId,
        assignmentState: viewingUserAssignmentState,
      }),
    [clients, projects, projectTasks, currentUser, viewingUserId, viewingUserAssignmentState],
  );

  const taskHandlers = useMemo(
    () =>
      makeTaskHandlers({
        projectTasks,
        setProjectTasks,
        setEntries,
        generateRecurringEntries,
        taskUpdateQueueState,
      }),
    [projectTasks, setProjectTasks, setEntries, generateRecurringEntries, taskUpdateQueueState],
  );

  const handleAddEntry = entryHandlers.add;
  const handleAddBulkEntries = entryHandlers.addBulk;
  const handleDeleteEntry = entryHandlers.delete;
  const handleUpdateEntry = entryHandlers.update;

  const handleUpdateTask = taskHandlers.update;
  const handleMakeRecurring = taskHandlers.makeRecurring;
  const handleRecurringAction = taskHandlers.recurringAction;
  const handleDeleteProjectTask = useCallback(
    async (id: string) => {
      try {
        await api.tasks.delete(id);
        setProjectTasks((prev) => prev.filter((task) => task.id !== id));
      } catch (err) {
        console.error('Failed to delete task:', err);
      }
    },
    [setProjectTasks],
  );
  const handleDeleteProjectTaskWithToast = useCallback(
    async (id: string) => {
      try {
        await api.tasks.delete(id);
        setProjectTasks((prev) => prev.filter((task) => task.id !== id));
      } catch (err) {
        console.error('Failed to delete task:', err);
        toastError('Failed to delete task');
      }
    },
    [setProjectTasks],
  );

  const addClient = clientHandlers.add;
  const addClientsBulk = clientHandlers.addBulk;
  const handleUpdateClient = clientHandlers.update;
  const handleDeleteClient = clientHandlers.delete;
  const handleCreateClientProfileOption = clientHandlers.createProfileOption;
  const handleUpdateClientProfileOption = clientHandlers.updateProfileOption;
  const handleDeleteClientProfileOption = clientHandlers.deleteProfileOption;

  const addProduct = productHandlers.add;
  const handleUpdateProduct = productHandlers.update;
  const handleDeleteProduct = productHandlers.delete;
  const handleCreateInternalCategory = productHandlers.createInternalCategory;
  const handleUpdateInternalCategory = productHandlers.updateInternalCategory;
  const handleDeleteInternalCategory = productHandlers.deleteInternalCategory;
  const handleCreateInternalSubcategory = productHandlers.createInternalSubcategory;
  const handleRenameInternalSubcategory = productHandlers.renameInternalSubcategory;
  const handleDeleteInternalSubcategory = productHandlers.deleteInternalSubcategory;
  const handleCreateProductType = productHandlers.createProductType;
  const handleUpdateProductType = productHandlers.updateProductType;
  const handleDeleteProductType = productHandlers.deleteProductType;

  const refreshQuoteCommunicationChannels = useCallback(async () => {
    const channels = await api.quoteCommunicationChannels.list();
    setQuoteCommunicationChannels(channels);
    return channels;
  }, [setQuoteCommunicationChannels]);

  const handleCreateQuoteCommunicationChannel = useCallback(
    async (data: { name: string; icon: QuoteCommunicationChannelIcon }) => {
      await api.quoteCommunicationChannels.create(data);
      await refreshQuoteCommunicationChannels();
    },
    [refreshQuoteCommunicationChannels],
  );

  const handleUpdateQuoteCommunicationChannel = useCallback(
    async (id: string, updates: { name: string; icon: QuoteCommunicationChannelIcon }) => {
      await api.quoteCommunicationChannels.update(id, updates);
      await refreshQuoteCommunicationChannels();
    },
    [refreshQuoteCommunicationChannels],
  );

  const handleDeleteQuoteCommunicationChannel = useCallback(
    async (id: string) => {
      await api.quoteCommunicationChannels.delete(id);
      await refreshQuoteCommunicationChannels();
    },
    [refreshQuoteCommunicationChannels],
  );
  const canManageQuoteCommunicationChannels = hasAnyPermission(currentUser?.permissions || [], [
    'sales.client_quotes.create',
    'sales.client_quotes.update',
    'sales.client_quotes.delete',
    'sales.supplier_quotes.create',
    'sales.supplier_quotes.update',
    'sales.supplier_quotes.delete',
  ]);

  const addQuote = quoteHandlers.addQuote;
  const handleUpdateQuote = quoteHandlers.updateQuote;
  const handleDeleteQuote = quoteHandlers.deleteQuote;
  const handleUpdateClientOffer = quoteHandlers.updateClientOffer;
  const handleRevertClientOfferToDraft = quoteHandlers.revertClientOfferToDraft;
  const handleDeleteClientOffer = quoteHandlers.deleteClientOffer;
  const handleCreateClientOfferFromLegacyQuote = quoteHandlers.createClientOfferFromLegacyQuote;
  const handlePromoteQuoteCandidate = quoteHandlers.promoteQuoteCandidate;
  const handleRollbackQuotePromotion = quoteHandlers.rollbackQuotePromotion;
  const handleUpdateClientsOrder = quoteHandlers.updateClientsOrder;
  const handleDeleteClientsOrder = quoteHandlers.deleteClientsOrder;
  const handleCreateClientsOrderFromOffer = quoteHandlers.createClientsOrderFromOffer;

  const addInvoice = invoiceHandlers.add;
  const handleUpdateInvoice = invoiceHandlers.update;
  const handleDeleteInvoice = invoiceHandlers.delete;

  const addSupplier = supplierHandlers.add;
  const addSuppliersBulk = supplierHandlers.addBulk;
  const handleUpdateSupplier = supplierHandlers.update;
  const handleDeleteSupplier = supplierHandlers.delete;

  const addSupplierQuote = supplierQuoteHandlers.addSupplierQuote;
  const handleUpdateSupplierQuote = supplierQuoteHandlers.updateSupplierQuote;
  const handleDeleteSupplierQuote = supplierQuoteHandlers.deleteSupplierQuote;
  const handleUpdateSupplierOrder = supplierQuoteHandlers.updateSupplierOrder;
  const handleDeleteSupplierOrder = supplierQuoteHandlers.deleteSupplierOrder;
  const handleCreateSupplierOrderFromQuote = supplierQuoteHandlers.createSupplierOrderFromQuote;
  const refreshSupplierOrderFlow = supplierQuoteHandlers.refreshSupplierOrderFlow;

  const handleUpdateSupplierInvoice = supplierInvoiceHandlers.update;
  const handleDeleteSupplierInvoice = supplierInvoiceHandlers.delete;
  const handleCreateSupplierInvoiceFromOrder = supplierInvoiceHandlers.createFromOrder;

  const addInternalEmployee = userHandlers.addInternalEmployee;
  const addExternalEmployee = userHandlers.addExternalEmployee;
  const handleUpdateEmployee = userHandlers.updateEmployee;
  const handleDeleteEmployee = userHandlers.deleteEmployee;

  const addProject = projectHandlers.add;
  const addProjectTask = projectHandlers.addTask;
  const handleUpdateProject = projectHandlers.update;
  const handleDeleteProject = projectHandlers.delete;

  const addResale = resaleHandlers.create;
  const handleDeleteResale = resaleHandlers.delete;
  const handleAddResaleActivity = resaleHandlers.createActivity;
  const handleUpdateResaleActivity = resaleHandlers.updateActivity;
  const handleDeleteResaleActivity = resaleHandlers.deleteActivity;
  const handleCreateResaleCategory = resaleHandlers.createCategory;
  const handleUpdateResaleCategory = resaleHandlers.updateCategory;
  const handleDeleteResaleCategory = resaleHandlers.deleteCategory;

  const handleUpdateUser = userHandlers.updateUser;
  const handleUpdateUserRoles = userHandlers.updateUserRoles;
  const handleUpdateUserAuthMethod = userHandlers.updateUserAuthMethod;

  const handleBrandingChange = (next: AppBranding) => {
    setBranding(next);
  };

  const applyGeneralSettingsUpdate = (updated: IGeneralSettings) => {
    setGeneralSettings({
      ...updated,
      currency: normalizeCurrency(updated.currency),
      geminiApiKey: updated.geminiApiKey || '',
      aiProvider: updated.aiProvider || 'gemini',
      openrouterApiKey: updated.openrouterApiKey || '',
      anthropicApiKey: updated.anthropicApiKey || '',
      geminiModelId: updated.geminiModelId || '',
      openrouterModelId: updated.openrouterModelId || '',
      anthropicModelId: updated.anthropicModelId || '',
      defaultLocation: updated.defaultLocation || 'remote',
      rilCompanyName: updated.rilCompanyName || '',
      rilDefaultStartTime: updated.rilDefaultStartTime || DEFAULT_RIL_START_TIME,
      rilDefaultExitTime: updated.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME,
      rilLunchBreakMinutes: updated.rilLunchBreakMinutes ?? 60,
      rilNoteOptions: normalizeRilNoteOptions(updated.rilNoteOptions),
      rilTransferOptions: normalizeRilTransferOptions(updated.rilTransferOptions),
    });
  };

  const updateGeneralSettings = async (updates: Partial<IGeneralSettings>) => {
    const updated = await api.generalSettings.update(updates);
    applyGeneralSettingsUpdate(updated);
    return updated;
  };

  const handleUpdateGeneralSettings = async (updates: Partial<IGeneralSettings>) => {
    try {
      await updateGeneralSettings(updates);
    } catch (err) {
      handleGeneralSettingsUpdateError(err);
    }
  };

  const handleUpdateGeneralSettingsStrict = async (updates: Partial<IGeneralSettings>) => {
    try {
      await updateGeneralSettings(updates);
    } catch (err) {
      handleGeneralSettingsUpdateError(err);
      throw err;
    }
  };

  const handleUpdateUserSettings = async (updates: Partial<Settings>) => {
    try {
      const updated = await api.settings.update(updates);
      setUserSettings((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      console.error('Failed to update user settings:', err);
      toastError('Failed to update settings');
      throw err;
    }
  };

  const handleUpdateUserPassword = updateUserPassword;
  const handleListMcpTokens = listMcpTokens;
  const handleCreateMcpToken = createMcpToken;
  const handleRevokeMcpToken = revokeMcpToken;

  const handleGetPersonalAccessToken = useCallback(
    async (): Promise<PersonalAccessToken> => api.settings.getPersonalAccessToken(),
    [],
  );

  const handleRenewPersonalAccessToken = useCallback(
    async (): Promise<PersonalAccessToken> => api.settings.renewPersonalAccessToken(),
    [],
  );

  const handleNotFoundReturn = () => {
    setActiveView(getNotFoundReturnView(currentUser?.permissions || [], VALID_VIEWS));
  };

  const handleSaveLdapConfig = ldapHandlers.saveConfig;

  const handleLdapUsersSynced = useCallback(() => {
    const permissions = currentUser?.permissions || [];
    const canRefreshUserManagement = hasViewAccess(permissions, 'administration/user-management');

    if (canRefreshUserManagement) {
      void api.users
        .list()
        .then(setUsers)
        .catch((err) => {
          console.error('Failed to refresh users after LDAP sync:', err);
        });
    }

    void refreshMfaExemptionUsers();
  }, [currentUser?.permissions, refreshMfaExemptionUsers, setUsers]);

  const handleSaveSsoProvider = async (provider: Partial<SsoProvider>) => {
    try {
      const updated = provider.id
        ? await api.sso.updateProvider(provider.id, provider)
        : await api.sso.createProvider(provider);
      setSsoProviders((current) => {
        const exists = current.some((item) => item.id === updated.id);
        return exists
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : [...current, updated];
      });
      return updated;
    } catch (err) {
      console.error('Failed to save SSO provider:', err);
      throw err;
    }
  };

  const handleDeleteSsoProvider = async (id: string) => {
    try {
      await api.sso.deleteProvider(id);
      setSsoProviders((current) => current.filter((provider) => provider.id !== id));
    } catch (err) {
      console.error('Failed to delete SSO provider:', err);
      throw err;
    }
  };

  const handleSaveEmailConfig = async (config: EmailConfig) => {
    try {
      const updated = await api.email.updateConfig(config);
      setEmailConfig(updated);
    } catch (err) {
      console.error('Failed to save email config:', err);
      throw err;
    }
  };

  const handleTestEmail = testEmail;

  const handleAddUser = userHandlers.addUser;
  const handleDeleteUser = userHandlers.deleteUser;
  const addWorkUnit = userHandlers.addWorkUnit;
  const updateWorkUnit = userHandlers.updateWorkUnit;
  const deleteWorkUnit = userHandlers.deleteWorkUnit;
  const fetchWorkUnits = userHandlers.fetchWorkUnits;
  const handleCreateRole = userHandlers.createRole;
  const handleRenameRole = userHandlers.renameRole;
  const handleUpdateRolePermissions = userHandlers.updateRolePermissions;
  const handleDeleteRole = userHandlers.deleteRole;

  const activeModule = activeView === '404' ? null : getModuleFromView(activeView);
  const activeModuleLoadFailures = activeModule ? (moduleLoadErrors[activeModule] ?? []) : [];
  const reportsSettingsFailed =
    activeView === 'reports/ai-reporting' &&
    !hasLoadedGeneralSettings &&
    activeModuleLoadFailures.includes('general settings');
  // Until generalSettings is loaded we don't yet know whether enableAiReporting
  // is true; keep the route in the generic pending state so ai-reporting chrome
  // doesn't flash before the 404 redirect fires.
  const isActiveModulePending =
    Boolean(
      activeModule &&
        activeModule !== 'settings' &&
        (!loadedModules.has(activeModule) ||
          isModuleLoading(activeModule) ||
          (activeModule === 'timesheets' && loadedTimesheetsViewRef.current !== activeView)),
    ) ||
    (activeView === 'reports/ai-reporting' && !hasLoadedGeneralSettings && !reportsSettingsFailed);

  return {
    tApp,
    users,
    mfaExemptionUsers,
    clients,
    projects,
    projectTasks,
    resales,
    resaleCategories,
    resaleOrderOptions,
    products,
    quotes,
    quoteCommunicationChannels,
    clientOffers,
    clientsOrders,
    invoices,
    suppliers,
    supplierQuotes,
    supplierOrders,
    supplierInvoices,
    entries,
    workUnits,
    responsibleUserOptions,
    setQuotes,
    setClientOffers,
    setClientsOrders,
    setSupplierQuotes,
    ldapConfig,
    generalSettings,
    branding,
    ssoProviders,
    emailConfig,
    roles,
    hasLoadedGeneralSettings,
    notifications,
    unreadNotificationCount,
    activeView,
    userSettingsTab,
    clientQuoteFilterId,
    clientOfferFilterId,
    supplierQuoteFilterId,
    supplierOrderFilterId,
    clientsOrderFilterId,
    productFilterId,
    selectedProjectId,
    viewingUserId,
    setClientQuoteFilterId,
    setClientOfferFilterId,
    setSupplierQuoteFilterId,
    setClientsOrderFilterId,
    setSelectedProjectId,
    setViewingUserId,
    setActiveView,
    setUserSettingsTab,
    openRilPreferences,
    setProjectsViewTab,
    currentUser,
    isLoading,
    logoutReason,
    clearLogoutReason,
    userSettings,
    serverUnreachable,
    dismissServerUnreachable,
    handleLogin,
    handleLogout,
    handleSwitchRole,
    supplierQuoteHandlers,
    quoteIdsWithOffers,
    quoteOfferStatuses,
    offerIdsWithOrders,
    orderIdsWithInvoices,
    isRouteAccessible,
    handleMarkNotificationAsRead,
    handleMarkAllNotificationsAsRead,
    handleDeleteNotification,
    availableUsers,
    trackerCatalogs,
    handleAddEntry,
    handleAddBulkEntries,
    handleDeleteEntry,
    handleUpdateEntry,
    handleUpdateTask,
    handleMakeRecurring,
    handleRecurringAction,
    handleDeleteProjectTask,
    handleDeleteProjectTaskWithToast,
    addClient,
    addClientsBulk,
    handleUpdateClient,
    handleDeleteClient,
    handleCreateClientProfileOption,
    handleUpdateClientProfileOption,
    handleDeleteClientProfileOption,
    addProduct,
    handleUpdateProduct,
    handleDeleteProduct,
    handleCreateInternalCategory,
    handleUpdateInternalCategory,
    handleDeleteInternalCategory,
    handleCreateInternalSubcategory,
    handleRenameInternalSubcategory,
    handleDeleteInternalSubcategory,
    handleCreateProductType,
    handleUpdateProductType,
    handleDeleteProductType,
    handleCreateQuoteCommunicationChannel,
    handleUpdateQuoteCommunicationChannel,
    handleDeleteQuoteCommunicationChannel,
    canManageQuoteCommunicationChannels,
    addQuote,
    handleUpdateQuote,
    handleDeleteQuote,
    handleUpdateClientOffer,
    handleRevertClientOfferToDraft,
    handleDeleteClientOffer,
    handleCreateClientOfferFromLegacyQuote,
    handlePromoteQuoteCandidate,
    handleRollbackQuotePromotion,
    handleUpdateClientsOrder,
    handleDeleteClientsOrder,
    handleCreateClientsOrderFromOffer,
    addInvoice,
    handleUpdateInvoice,
    handleDeleteInvoice,
    addSupplier,
    addSuppliersBulk,
    handleUpdateSupplier,
    handleDeleteSupplier,
    addSupplierQuote,
    handleUpdateSupplierQuote,
    handleDeleteSupplierQuote,
    handleUpdateSupplierOrder,
    handleDeleteSupplierOrder,
    handleCreateSupplierOrderFromQuote,
    refreshSupplierOrderFlow,
    handleUpdateSupplierInvoice,
    handleDeleteSupplierInvoice,
    handleCreateSupplierInvoiceFromOrder,
    addInternalEmployee,
    addExternalEmployee,
    handleUpdateEmployee,
    handleDeleteEmployee,
    addProject,
    addProjectTask,
    handleUpdateProject,
    handleDeleteProject,
    addResale,
    handleDeleteResale,
    handleAddResaleActivity,
    handleUpdateResaleActivity,
    handleDeleteResaleActivity,
    handleCreateResaleCategory,
    handleUpdateResaleCategory,
    handleDeleteResaleCategory,
    handleUpdateUser,
    handleUpdateUserRoles,
    handleUpdateUserAuthMethod,
    handleBrandingChange,
    handleUpdateGeneralSettings,
    handleUpdateGeneralSettingsStrict,
    handleUpdateUserSettings,
    handleUpdateUserPassword,
    handleListMcpTokens,
    handleCreateMcpToken,
    handleRevokeMcpToken,
    handleGetPersonalAccessToken,
    handleRenewPersonalAccessToken,
    handleNotFoundReturn,
    handleSaveLdapConfig,
    handleLdapUsersSynced,
    handleSaveSsoProvider,
    handleDeleteSsoProvider,
    handleSaveEmailConfig,
    handleTestEmail,
    handleAddUser,
    handleDeleteUser,
    addWorkUnit,
    updateWorkUnit,
    deleteWorkUnit,
    fetchWorkUnits,
    handleCreateRole,
    handleRenameRole,
    handleUpdateRolePermissions,
    handleDeleteRole,
    activeModuleLoadFailures,
    reportsSettingsFailed,
    isActiveModulePending,
  };
};

type AppContentController = ReturnType<typeof useAppContentController>;
type AuthenticatedAppContentController = AppContentController & { currentUser: User };

const isAuthenticatedAppContentController = (
  controller: AppContentController,
): controller is AuthenticatedAppContentController => Boolean(controller.currentUser);

const AppContent: React.FC = () => {
  const controller = useAppContentController();
  return <AppContentView controller={controller} />;
};

const AppContentView: React.FC<{ controller: AppContentController }> = ({ controller }) => {
  const { activeView, currentUser, isLoading } = controller;

  if (isLoading) return <AppLoadingScreen />;
  if (activeView === 'docs/api') return <TechnicalDocsRoute controller={controller} view="api" />;
  if (activeView === 'docs/frontend') {
    return <TechnicalDocsRoute controller={controller} view="frontend" />;
  }
  if (!currentUser) return <LoginRoute controller={controller} />;

  return <AuthenticatedAppShell controller={controller} />;
};

const AppLoadingScreen: React.FC = () => {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center">
      <div className="text-center">
        <i className="fa-solid fa-circle-notch fa-spin text-4xl text-praetor mb-4"></i>
        <p className="text-zinc-600 font-medium">{t('common:states.loading')}</p>
      </div>
    </div>
  );
};

const TechnicalDocsRoute: React.FC<{
  controller: AppContentController;
  view: 'api' | 'frontend';
}> = ({ controller, view }) => (
  <>
    {controller.currentUser && (
      <SessionTimeoutHandler
        onLogout={() => controller.handleLogout('inactivity')}
        sessionIdleTimeoutMinutes={controller.generalSettings.sessionIdleTimeoutMinutes}
      />
    )}
    <Suspense fallback={<AppLoadingScreen />}>
      {view === 'api' ? <ApiDocsView /> : <FrontendDocsView />}
    </Suspense>
  </>
);

const LoginRoute: React.FC<{ controller: AppContentController }> = ({ controller }) => {
  const {
    branding,
    clearLogoutReason,
    dismissServerUnreachable,
    handleLogin,
    logoutReason,
    serverUnreachable,
  } = controller;
  return (
    <Login
      onLogin={handleLogin}
      logoutReason={logoutReason}
      onClearLogoutReason={clearLogoutReason}
      serverUnreachable={serverUnreachable}
      onDismissServerUnreachable={dismissServerUnreachable}
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
    />
  );
};

const AuthenticatedAppShell: React.FC<{ controller: AppContentController }> = ({ controller }) => {
  if (!isAuthenticatedAppContentController(controller)) return null;

  const {
    activeView,
    branding,
    currentUser,
    generalSettings,
    handleDeleteNotification,
    handleLogout,
    handleMarkAllNotificationsAsRead,
    handleMarkNotificationAsRead,
    handleSwitchRole,
    hasLoadedGeneralSettings,
    isRouteAccessible,
    notifications,
    openRilPreferences,
    roles,
    setActiveView,
    unreadNotificationCount,
  } = controller;

  return (
    <CurrentUserIdProvider userId={currentUser.id}>
      <SessionTimeoutHandler
        onLogout={() => handleLogout('inactivity')}
        sessionIdleTimeoutMinutes={generalSettings.sessionIdleTimeoutMinutes}
      />
      <Layout
        activeView={!isRouteAccessible ? 'timesheets/tracker' : (activeView as View)}
        onViewChange={setActiveView}
        currentUser={currentUser}
        onLogout={handleLogout}
        onSwitchRole={handleSwitchRole}
        roles={roles}
        isNotFound={!isRouteAccessible}
        isAiReportingEnabled={hasLoadedGeneralSettings && generalSettings.enableAiReporting}
        companyName={branding.companyName}
        logoUrl={branding.logoUrl}
        notifications={notifications}
        unreadNotificationCount={unreadNotificationCount}
        onMarkNotificationAsRead={handleMarkNotificationAsRead}
        onMarkAllNotificationsAsRead={handleMarkAllNotificationsAsRead}
        onDeleteNotification={handleDeleteNotification}
        onOpenRilPreferences={
          hasViewAccess(currentUser.permissions, 'timesheets/ril') ? openRilPreferences : undefined
        }
      >
        <AuthenticatedRouteContent controller={controller} />
      </Layout>
    </CurrentUserIdProvider>
  );
};

const AuthenticatedRouteContent: React.FC<{
  controller: AuthenticatedAppContentController;
}> = ({ controller }) => {
  const {
    activeModuleLoadFailures,
    activeView,
    handleNotFoundReturn,
    isActiveModulePending,
    isRouteAccessible,
  } = controller;

  if (!isRouteAccessible) return <NotFound onReturn={handleNotFoundReturn} />;
  if (isActiveModulePending) return <ModulePendingScreen />;

  return (
    <>
      <ModuleFailureBanner failures={activeModuleLoadFailures} />
      {activeView === 'docs' && <DocsHubView />}
      <TimesheetRoutes controller={controller} />
      <CustomerAndCatalogRoutes controller={controller} />
      <SalesRoutes controller={controller} />
      <AccountingRoutes controller={controller} />
      <HrRoutes controller={controller} />
      <ProjectRoutes controller={controller} />
      <AdministrationRoutes controller={controller} />
      <SettingsAndReportsRoutes controller={controller} />
    </>
  );
};

const ModulePendingScreen: React.FC = () => {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[420px] items-center justify-center rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <div className="text-center">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-primary mb-3" />
        <p className="text-sm font-medium text-muted-foreground">{t('common:states.loading')}</p>
      </div>
    </div>
  );
};

const ModuleFailureBanner: React.FC<{ failures: string[] }> = ({ failures }) => {
  if (failures.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <div className="flex items-start gap-3">
        <i className="fa-solid fa-triangle-exclamation mt-0.5 text-amber-500" />
        <p className="font-medium">Failed to load: {failures.join(', ')}.</p>
      </div>
    </div>
  );
};

const TimesheetRoutes: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const {
    activeView,
    addProjectTask,
    availableUsers,
    clients,
    currentUser,
    entries,
    generalSettings,
    handleAddBulkEntries,
    handleAddEntry,
    handleDeleteEntry,
    handleMakeRecurring,
    handleRecurringAction,
    handleUpdateEntry,
    projects,
    projectTasks,
    setViewingUserId,
    trackerCatalogs,
    userSettings,
    viewingUserId,
  } = controller;

  return (
    <>
      {activeView === 'timesheets/tracker' && (
        <TrackerView
          entries={entries.filter((e) => e.userId === viewingUserId)}
          clients={trackerCatalogs.clients}
          projects={trackerCatalogs.projects}
          projectTasks={trackerCatalogs.projectTasks}
          onAddEntry={handleAddEntry}
          onDeleteEntry={handleDeleteEntry}
          onUpdateEntry={handleUpdateEntry}
          startOfWeek={generalSettings.startOfWeek}
          treatSaturdayAsHoliday={generalSettings.treatSaturdayAsHoliday}
          allowWeekendSelection={true}
          onMakeRecurring={handleMakeRecurring}
          permissions={currentUser.permissions || []}
          viewingUserId={viewingUserId}
          onViewUserChange={setViewingUserId}
          availableUsers={availableUsers}
          currentUser={currentUser}
          dailyGoal={generalSettings.dailyLimit}
          onAddBulkEntries={handleAddBulkEntries}
          onRecurringAction={handleRecurringAction}
          defaultLocation={generalSettings.defaultLocation}
          onAddCustomTask={addProjectTask}
          currency={generalSettings.currency}
        />
      )}
      {activeView === 'timesheets/ril' && (
        <RilView
          currentUser={currentUser}
          availableUsers={availableUsers}
          viewingUserId={viewingUserId}
          onViewUserChange={setViewingUserId}
          settings={generalSettings}
          weekdayTransferDefaults={userSettings.rilWeekdayTransferDefaults}
        />
      )}
      {activeView === 'timesheets/recurring' && (
        <RecurringManager
          tasks={projectTasks}
          projects={projects}
          clients={clients}
          onAction={handleRecurringAction}
          onUpdate={handleMakeRecurring}
        />
      )}
    </>
  );
};

const CustomerAndCatalogRoutes: React.FC<{
  controller: AuthenticatedAppContentController;
}> = ({ controller }) => {
  const {
    activeView,
    addClient,
    addClientsBulk,
    addProduct,
    addSupplier,
    addSuppliersBulk,
    clients,
    currentUser,
    generalSettings,
    handleCreateClientProfileOption,
    handleCreateInternalCategory,
    handleCreateInternalSubcategory,
    handleCreateProductType,
    handleDeleteClient,
    handleDeleteClientProfileOption,
    handleDeleteInternalCategory,
    handleDeleteInternalSubcategory,
    handleDeleteProduct,
    handleDeleteProductType,
    handleDeleteSupplier,
    handleRenameInternalSubcategory,
    handleUpdateClient,
    handleUpdateClientProfileOption,
    handleUpdateInternalCategory,
    handleUpdateProduct,
    handleUpdateProductType,
    handleUpdateSupplier,
    productFilterId,
    products,
    supplierOrders,
    suppliers,
  } = controller;

  return (
    <>
      {hasViewAccess(currentUser.permissions, 'crm/clients') && activeView === 'crm/clients' && (
        <ClientsView
          clients={clients}
          onAddClient={addClient}
          onAddClientsBulk={addClientsBulk}
          onUpdateClient={handleUpdateClient}
          onDeleteClient={handleDeleteClient}
          onCreateClientProfileOption={handleCreateClientProfileOption}
          onUpdateClientProfileOption={handleUpdateClientProfileOption}
          onDeleteClientProfileOption={handleDeleteClientProfileOption}
          permissions={currentUser.permissions || []}
        />
      )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['catalog/internal-listing']) &&
        activeView === 'catalog/internal-listing' && (
          <InternalListingView
            products={products}
            productFilterId={productFilterId}
            onAddProduct={addProduct}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            currency={generalSettings.currency}
            onCreateInternalCategory={handleCreateInternalCategory}
            onUpdateInternalCategory={handleUpdateInternalCategory}
            onDeleteInternalCategory={handleDeleteInternalCategory}
            onCreateInternalSubcategory={handleCreateInternalSubcategory}
            onRenameInternalSubcategory={handleRenameInternalSubcategory}
            onDeleteInternalSubcategory={handleDeleteInternalSubcategory}
            onCreateProductType={handleCreateProductType}
            onUpdateProductType={handleUpdateProductType}
            onDeleteProductType={handleDeleteProductType}
          />
        )}
      {hasViewAccess(currentUser.permissions, 'crm/suppliers') &&
        activeView === 'crm/suppliers' && (
          <SuppliersView
            suppliers={suppliers}
            supplierOrders={supplierOrders}
            currency={generalSettings.currency}
            onAddSupplier={addSupplier}
            onAddSuppliersBulk={addSuppliersBulk}
            onUpdateSupplier={handleUpdateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            permissions={currentUser.permissions || []}
          />
        )}
    </>
  );
};

const SalesRoutes: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const {
    activeView,
    addQuote,
    addSupplierQuote,
    canManageQuoteCommunicationChannels,
    clientOfferFilterId,
    clientOffers,
    clientQuoteFilterId,
    clients,
    currentUser,
    generalSettings,
    handleCreateClientOfferFromLegacyQuote,
    handlePromoteQuoteCandidate,
    handleRollbackQuotePromotion,
    handleCreateClientsOrderFromOffer,
    handleCreateQuoteCommunicationChannel,
    handleCreateSupplierOrderFromQuote,
    handleDeleteClientOffer,
    handleDeleteQuote,
    handleDeleteQuoteCommunicationChannel,
    handleDeleteSupplierQuote,
    handleRevertClientOfferToDraft,
    handleUpdateClientOffer,
    handleUpdateQuote,
    handleUpdateQuoteCommunicationChannel,
    handleUpdateSupplierQuote,
    offerIdsWithOrders,
    products,
    quoteCommunicationChannels,
    quoteIdsWithOffers,
    quoteOfferStatuses,
    quotes,
    setActiveView,
    setClientOfferFilterId,
    setClientQuoteFilterId,
    setClientOffers,
    setClientsOrders,
    setQuotes,
    setSupplierQuoteFilterId,
    setSupplierQuotes,
    supplierQuoteFilterId,
    supplierQuoteHandlers,
    supplierQuotes,
    suppliers,
  } = controller;

  return (
    <>
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['sales/client-quotes']) &&
        activeView === 'sales/client-quotes' && (
          <ClientQuotesView
            quotes={quotes}
            clients={clients}
            products={products}
            supplierQuotes={supplierQuotes}
            communicationChannels={quoteCommunicationChannels}
            canManageCommunicationChannels={canManageQuoteCommunicationChannels}
            onCreateCommunicationChannel={handleCreateQuoteCommunicationChannel}
            onUpdateCommunicationChannel={handleUpdateQuoteCommunicationChannel}
            onDeleteCommunicationChannel={handleDeleteQuoteCommunicationChannel}
            onAddQuote={addQuote}
            onUpdateQuote={handleUpdateQuote}
            onQuoteRestored={async (restored) => {
              // Captured before the patch: a restore that REMOVES the last sourced line drops
              // the now-unsourced supplier quote back to draft server-side, so the pre-restore
              // sourcing also matters — not just the restored snapshot's lines (#779 follow-up).
              const wasSourcing = sourcesSupplierQuote(quotes.find((q) => q.id === restored.id));
              // Patch the restored quote eagerly so the modal reflects it instantly,
              // then refetch the whole flow because restore can also delete draft
              // linked sales server-side.
              setQuotes((prev) => prev.map((q) => (q.id === restored.id ? restored : q)));
              const [quotesData, offersData, ordersData] = await Promise.all([
                api.quotes.list(),
                api.clientOffers.list(),
                api.clientsOrders.list(),
              ]);
              setQuotes(quotesData);
              setClientOffers(offersData);
              setClientsOrders(ordersData);
              // A restore rewrites the snapshot's lines/status, so a supplier quote those
              // lines source (or USED to source) has a mirrored derived status that can change
              // too (#779 follow-up: linkage is line-sourced). Best-effort: a refresh failure
              // must not fail the completed restore.
              if (wasSourcing || sourcesSupplierQuote(restored)) {
                try {
                  await supplierQuoteHandlers.refreshSupplierQuoteFlow();
                } catch (refreshErr) {
                  console.error('Failed to refresh supplier data:', refreshErr);
                }
              }
            }}
            onDeleteQuote={handleDeleteQuote}
            onCreateOfferFromLegacyQuote={handleCreateClientOfferFromLegacyQuote}
            onPromoteCandidate={handlePromoteQuoteCandidate}
            onRollbackPromotion={handleRollbackQuotePromotion}
            offers={clientOffers}
            onViewOffer={(offerId) => {
              setClientQuoteFilterId(null);
              setClientOfferFilterId(offerId);
              setActiveView('sales/client-offers');
            }}
            quoteFilterId={clientQuoteFilterId}
            quoteIdsWithOffers={quoteIdsWithOffers}
            quoteOfferStatuses={quoteOfferStatuses}
            currency={generalSettings.currency}
            canViewSupplierQuotes={hasViewAccess(currentUser.permissions, 'sales/supplier-quotes')}
            canViewInternalListing={hasViewAccess(
              currentUser.permissions,
              'catalog/internal-listing',
            )}
            onViewOffers={(quoteId) => {
              setClientOfferFilterId(null);
              setClientQuoteFilterId(quoteId);
              setActiveView('sales/client-offers');
            }}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['sales/client-offers']) &&
        activeView === 'sales/client-offers' && (
          <ClientOffersView
            offers={clientOffers}
            clients={clients}
            products={products}
            supplierQuotes={supplierQuotes}
            offerIdsWithOrders={offerIdsWithOrders}
            onUpdateOffer={handleUpdateClientOffer}
            onRevertOfferToDraft={handleRevertClientOfferToDraft}
            canRevertTerminalStatus={
              currentUser.role === TOP_MANAGER_ROLE_ID || currentUser.role === ADMIN_ROLE_ID
            }
            onOfferRestored={async () => {
              setClientOffers(await api.clientOffers.list());
            }}
            onDeleteOffer={handleDeleteClientOffer}
            onCreateClientsOrder={handleCreateClientsOrderFromOffer}
            onViewQuote={(quoteId) => {
              setClientOfferFilterId(null);
              setClientQuoteFilterId(quoteId);
              setActiveView('sales/client-quotes');
            }}
            currency={generalSettings.currency}
            canViewSupplierQuotes={hasViewAccess(currentUser.permissions, 'sales/supplier-quotes')}
            canViewInternalListing={hasViewAccess(
              currentUser.permissions,
              'catalog/internal-listing',
            )}
            quoteFilterId={clientQuoteFilterId}
            offerFilterId={clientOfferFilterId}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['sales/supplier-quotes']) &&
        activeView === 'sales/supplier-quotes' && (
          <SupplierQuotesView
            quotes={supplierQuotes}
            suppliers={suppliers}
            clients={clients}
            products={products}
            communicationChannels={quoteCommunicationChannels}
            canManageCommunicationChannels={canManageQuoteCommunicationChannels}
            onCreateCommunicationChannel={handleCreateQuoteCommunicationChannel}
            onUpdateCommunicationChannel={handleUpdateQuoteCommunicationChannel}
            onDeleteCommunicationChannel={handleDeleteQuoteCommunicationChannel}
            onAddQuote={addSupplierQuote}
            onUpdateQuote={handleUpdateSupplierQuote}
            onQuoteRestored={(restored) => {
              // Patch the restored quote eagerly so the modal reflects it instantly.
              // No linked-order refetch needed: restore is rejected when an order exists.
              setSupplierQuotes((prev) => prev.map((q) => (q.id === restored.id ? restored : q)));
            }}
            onDeleteQuote={handleDeleteSupplierQuote}
            onCreateOrder={handleCreateSupplierOrderFromQuote}
            quoteFilterId={supplierQuoteFilterId}
            currency={generalSettings.currency}
            onViewOrders={(quoteId) => {
              setSupplierQuoteFilterId(quoteId);
              setActiveView('accounting/supplier-orders');
            }}
          />
        )}
    </>
  );
};

const AccountingRoutes: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const {
    activeView,
    addInvoice,
    clientOfferFilterId,
    clients,
    clientsOrderFilterId,
    clientsOrders,
    currentUser,
    generalSettings,
    handleCreateSupplierInvoiceFromOrder,
    handleDeleteClientsOrder,
    handleDeleteInvoice,
    handleDeleteSupplierInvoice,
    handleDeleteSupplierOrder,
    handleUpdateClientsOrder,
    handleUpdateInvoice,
    handleUpdateSupplierInvoice,
    handleUpdateSupplierOrder,
    invoices,
    orderIdsWithInvoices,
    products,
    refreshSupplierOrderFlow,
    setActiveView,
    setClientOfferFilterId,
    setClientQuoteFilterId,
    setClientsOrders,
    setSupplierQuoteFilterId,
    supplierInvoices,
    supplierOrderFilterId,
    supplierOrders,
    supplierQuoteFilterId,
    suppliers,
  } = controller;

  return (
    <>
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['accounting/clients-orders']) &&
        activeView === 'accounting/clients-orders' && (
          <ClientsOrdersView
            orders={clientsOrders}
            clients={clients}
            products={products}
            supplierOrders={supplierOrders}
            onUpdateClientsOrder={handleUpdateClientsOrder}
            onDeleteClientsOrder={handleDeleteClientsOrder}
            onOrderRestored={(restored) => {
              setClientsOrders((prev) => prev.map((o) => (o.id === restored.id ? restored : o)));
            }}
            currency={generalSettings.currency}
            canViewInternalListing={hasViewAccess(
              currentUser.permissions,
              'catalog/internal-listing',
            )}
            canViewSupplierOrders={hasViewAccess(
              currentUser.permissions,
              'accounting/supplier-orders',
            )}
            onViewOffer={(offerId) => {
              setClientQuoteFilterId(null);
              setClientOfferFilterId(offerId);
              setActiveView('sales/client-offers');
            }}
            offerFilterId={clientOfferFilterId}
            orderFilterId={clientsOrderFilterId}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['accounting/clients-invoices']) &&
        activeView === 'accounting/clients-invoices' && (
          <ClientsInvoicesView
            invoices={invoices}
            clients={clients}
            products={products}
            onAddInvoice={addInvoice}
            onUpdateInvoice={handleUpdateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            currency={generalSettings.currency}
            canViewInternalListing={hasViewAccess(
              currentUser.permissions,
              'catalog/internal-listing',
            )}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['accounting/supplier-orders']) &&
        activeView === 'accounting/supplier-orders' && (
          <SupplierOrdersView
            orders={supplierOrders}
            suppliers={suppliers}
            products={products}
            orderIdsWithInvoices={orderIdsWithInvoices}
            onUpdateOrder={handleUpdateSupplierOrder}
            onDeleteOrder={handleDeleteSupplierOrder}
            onCreateInvoice={handleCreateSupplierInvoiceFromOrder}
            onViewQuote={(quoteId) => {
              setSupplierQuoteFilterId(quoteId);
              setActiveView('sales/supplier-quotes');
            }}
            onOrderRestored={refreshSupplierOrderFlow}
            currency={generalSettings.currency}
            quoteFilterId={supplierQuoteFilterId}
            orderFilterId={supplierOrderFilterId}
          />
        )}
      {hasPermission(
        currentUser.permissions,
        VIEW_PERMISSION_MAP['accounting/supplier-invoices'],
      ) &&
        activeView === 'accounting/supplier-invoices' && (
          <SupplierInvoicesView
            invoices={supplierInvoices}
            suppliers={suppliers}
            products={products}
            onUpdateInvoice={handleUpdateSupplierInvoice}
            onDeleteInvoice={handleDeleteSupplierInvoice}
            currency={generalSettings.currency}
          />
        )}
    </>
  );
};

const HrRoutes: React.FC<{ controller: AuthenticatedAppContentController }> = ({ controller }) => {
  const {
    activeView,
    addExternalEmployee,
    addInternalEmployee,
    addWorkUnit,
    clients,
    currentUser,
    deleteWorkUnit,
    fetchWorkUnits,
    generalSettings,
    handleDeleteEmployee,
    handleUpdateEmployee,
    projectTasks,
    projects,
    updateWorkUnit,
    users,
    workUnits,
    responsibleUserOptions,
  } = controller;

  return (
    <>
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['hr/internal']) &&
        activeView === 'hr/internal' && (
          <InternalEmployeesView
            users={users}
            clients={clients}
            projects={projects}
            tasks={projectTasks}
            workUnits={workUnits}
            responsibleUserOptions={responsibleUserOptions}
            onAddEmployee={addInternalEmployee}
            onUpdateEmployee={handleUpdateEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            currency={generalSettings.currency}
            permissions={currentUser.permissions || []}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['hr/external']) &&
        activeView === 'hr/external' && (
          <ExternalEmployeesView
            users={users}
            clients={clients}
            projects={projects}
            tasks={projectTasks}
            workUnits={workUnits}
            responsibleUserOptions={responsibleUserOptions}
            onAddEmployee={addExternalEmployee}
            onUpdateEmployee={handleUpdateEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            currency={generalSettings.currency}
            permissions={currentUser.permissions || []}
          />
        )}
      {hasViewAccess(currentUser.permissions, 'hr/work-units') &&
        activeView === 'hr/work-units' && (
          <WorkUnitsView
            workUnits={workUnits}
            users={users}
            permissions={currentUser.permissions || []}
            onAddWorkUnit={addWorkUnit}
            onUpdateWorkUnit={updateWorkUnit}
            onDeleteWorkUnit={deleteWorkUnit}
            refreshWorkUnits={fetchWorkUnits}
          />
        )}
    </>
  );
};

const ProjectRoutes: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const { activeView, currentUser } = controller;

  return (
    <>
      {(activeView === 'projects/manage' || activeView === 'projects/tasks') &&
        hasViewAccess(currentUser.permissions, activeView) && (
          <ProjectsListRoute
            controller={controller}
            activeTab={activeView === 'projects/tasks' ? 'tasks' : 'commissions'}
          />
        )}
      {hasViewAccess(currentUser.permissions, 'projects/detail') &&
        activeView === 'projects/detail' && <ProjectDetailRoute controller={controller} />}
      {hasViewAccess(currentUser.permissions, 'projects/resales') &&
        activeView === 'projects/resales' && <ProjectResalesRoute controller={controller} />}
    </>
  );
};

const ProjectsListRoute: React.FC<{
  controller: AuthenticatedAppContentController;
  activeTab: ProjectsViewTab;
}> = ({ activeTab, controller }) => {
  const {
    addProject,
    addProjectTask,
    availableUsers,
    clientOffers,
    clients,
    clientsOrders,
    currentUser,
    generalSettings,
    handleDeleteProject,
    handleDeleteProjectTaskWithToast,
    handleUpdateProject,
    handleUpdateTask,
    projectTasks,
    projects,
    roles,
    setActiveView,
    setClientsOrderFilterId,
    setSelectedProjectId,
    setProjectsViewTab,
  } = controller;

  return (
    <ProjectsView
      projects={projects}
      clients={clients}
      orders={clientsOrders}
      offers={clientOffers}
      currency={generalSettings.currency}
      permissions={currentUser.permissions || []}
      users={availableUsers}
      roles={roles}
      tasks={projectTasks}
      onAddProject={addProject}
      onUpdateProject={handleUpdateProject}
      onDeleteProject={handleDeleteProject}
      onAddTask={addProjectTask}
      onUpdateTask={handleUpdateTask}
      onDeleteTask={handleDeleteProjectTaskWithToast}
      activeTab={activeTab}
      onTabChange={setProjectsViewTab}
      onViewOrder={(orderId) => {
        setClientsOrderFilterId(orderId);
        setActiveView('accounting/clients-orders');
      }}
      onNavigateToProject={(projectId) => {
        setSelectedProjectId(projectId);
        setActiveView('projects/detail');
      }}
    />
  );
};

const ProjectDetailRoute: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const {
    addProject,
    addProjectTask,
    availableUsers,
    clientOffers,
    clients,
    clientsOrders,
    currentUser,
    generalSettings,
    handleDeleteProject,
    handleDeleteProjectTask,
    handleDeleteProjectTaskWithToast,
    handleUpdateProject,
    handleUpdateTask,
    projectTasks,
    projects,
    roles,
    selectedProjectId,
    setActiveView,
    setClientsOrderFilterId,
    setSelectedProjectId,
    setProjectsViewTab,
  } = controller;
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : undefined;

  if (!selectedProject) {
    // Project unavailable (e.g. just deleted, or refresh) — fall back to list.
    return (
      <ProjectsView
        projects={projects}
        clients={clients}
        orders={clientsOrders}
        offers={clientOffers}
        currency={generalSettings.currency}
        permissions={currentUser.permissions || EMPTY_PERMISSIONS}
        users={availableUsers}
        roles={roles}
        tasks={projectTasks}
        onAddProject={addProject}
        onUpdateProject={handleUpdateProject}
        onDeleteProject={handleDeleteProject}
        onAddTask={addProjectTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteProjectTaskWithToast}
        activeTab="commissions"
        onTabChange={setProjectsViewTab}
        onViewOrder={(orderId) => {
          setClientsOrderFilterId(orderId);
          setActiveView('accounting/clients-orders');
        }}
        onNavigateToProject={(projectId) => {
          setSelectedProjectId(projectId);
          setActiveView('projects/detail');
        }}
      />
    );
  }

  return (
    // key={selectedProject.id} remounts the component on project switch
    // so all local state (form fields, entries fetch, assignments) resets
    // cleanly without an in-component prop-sync useEffect.
    // Suspense fallback covers the lazy() chunk fetch the first time the
    // user enters the detail page.
    <Suspense fallback={null}>
      <ProjectDetailView
        key={selectedProject.id}
        project={selectedProject}
        clients={clients}
        orders={clientsOrders}
        offers={clientOffers}
        users={availableUsers}
        roles={roles}
        permissions={currentUser.permissions || EMPTY_PERMISSIONS}
        currency={generalSettings.currency}
        tasks={projectTasks}
        onBack={() => setActiveView('projects/manage')}
        onUpdateProject={handleUpdateProject}
        onDeleteProject={handleDeleteProject}
        onAddTask={addProjectTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteProjectTask}
        onViewOrder={(orderId) => {
          setClientsOrderFilterId(orderId);
          setActiveView('accounting/clients-orders');
        }}
      />
    </Suspense>
  );
};

const ProjectResalesRoute: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const {
    addResale,
    currentUser,
    generalSettings,
    handleAddResaleActivity,
    handleCreateResaleCategory,
    handleDeleteResale,
    handleDeleteResaleActivity,
    handleDeleteResaleCategory,
    handleUpdateResaleActivity,
    handleUpdateResaleCategory,
    resaleCategories,
    resaleOrderOptions,
    resales,
  } = controller;

  return (
    <ResalesView
      resales={resales}
      categories={resaleCategories}
      orderOptions={resaleOrderOptions}
      permissions={currentUser.permissions || EMPTY_PERMISSIONS}
      currency={generalSettings.currency}
      onAddResale={addResale}
      onDeleteResale={handleDeleteResale}
      onAddActivity={handleAddResaleActivity}
      onUpdateActivity={handleUpdateResaleActivity}
      onDeleteActivity={handleDeleteResaleActivity}
      onCreateCategory={handleCreateResaleCategory}
      onUpdateCategory={handleUpdateResaleCategory}
      onDeleteCategory={handleDeleteResaleCategory}
    />
  );
};

const AdministrationRoutes: React.FC<{ controller: AuthenticatedAppContentController }> = ({
  controller,
}) => {
  const {
    activeView,
    branding,
    clients,
    currentUser,
    emailConfig,
    generalSettings,
    handleAddUser,
    handleBrandingChange,
    handleCreateRole,
    handleDeleteRole,
    handleDeleteSsoProvider,
    handleDeleteUser,
    handleRenameRole,
    handleSaveEmailConfig,
    handleSaveLdapConfig,
    handleLdapUsersSynced,
    handleSaveSsoProvider,
    handleTestEmail,
    handleUpdateGeneralSettings,
    handleUpdateGeneralSettingsStrict,
    handleUpdateRolePermissions,
    handleUpdateUser,
    handleUpdateUserAuthMethod,
    handleUpdateUserRoles,
    ldapConfig,
    projectTasks,
    projects,
    roles,
    ssoProviders,
    users,
    mfaExemptionUsers,
  } = controller;

  return (
    <>
      {hasViewAccess(currentUser.permissions, 'administration/user-management') &&
        activeView === 'administration/user-management' && (
          <UserManagement
            clients={clients}
            projects={projects}
            tasks={projectTasks}
            users={users}
            onAddUser={handleAddUser}
            onDeleteUser={handleDeleteUser}
            onUpdateUser={handleUpdateUser}
            onUpdateUserRoles={handleUpdateUserRoles}
            onUpdateUserAuthMethod={handleUpdateUserAuthMethod}
            onResetUserTotp={(userId) => api.users.resetTotp(userId).then(() => undefined)}
            currentUserId={currentUser.id}
            permissions={currentUser.permissions || []}
            roles={roles}
            ssoProviders={ssoProviders}
            currency={getCurrencySymbol(generalSettings.currency)}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/general']) &&
        activeView === 'administration/general' && (
          <GeneralSettings
            settings={generalSettings}
            onUpdate={handleUpdateGeneralSettings}
            branding={branding}
            onBrandingChange={handleBrandingChange}
          />
        )}
      {hasPermission(
        currentUser.permissions,
        VIEW_PERMISSION_MAP['administration/authentication'],
      ) &&
        activeView === 'administration/authentication' && (
          <AuthSettings
            config={ldapConfig}
            onSave={handleSaveLdapConfig}
            onLdapUsersSynced={handleLdapUsersSynced}
            roles={roles}
            users={mfaExemptionUsers}
            ssoProviders={ssoProviders}
            onSaveSsoProvider={handleSaveSsoProvider}
            onDeleteSsoProvider={handleDeleteSsoProvider}
            enableTotp={generalSettings.enableTotp}
            onSetEnableTotp={(value) => handleUpdateGeneralSettings({ enableTotp: value })}
            enforceTotp={generalSettings.enforceTotp}
            onSetEnforceTotp={(value) => handleUpdateGeneralSettings({ enforceTotp: value })}
            enforcedRoleIds={generalSettings.totpEnforcedRoleIds}
            onSetEnforcedRoleIds={(value) =>
              handleUpdateGeneralSettings({ totpEnforcedRoleIds: value })
            }
            exemptRoleIds={generalSettings.totpExemptRoleIds}
            exemptUserIds={generalSettings.totpExemptUserIds}
            onSetExemptRoleIds={(value) =>
              handleUpdateGeneralSettings({ totpExemptRoleIds: value })
            }
            onSetExemptUserIds={(value) =>
              handleUpdateGeneralSettings({ totpExemptUserIds: value })
            }
            sessionIdleTimeoutMinutes={generalSettings.sessionIdleTimeoutMinutes}
            onSetSessionIdleTimeoutMinutes={(value) =>
              handleUpdateGeneralSettingsStrict({ sessionIdleTimeoutMinutes: value })
            }
            canManageMfa={hasPermission(currentUser.permissions, 'administration.general.update')}
            canManageSession={hasPermission(
              currentUser.permissions,
              'administration.general.update',
            )}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/roles']) &&
        activeView === 'administration/roles' && (
          <RolesView
            roles={roles}
            permissions={currentUser.permissions || []}
            onCreateRole={handleCreateRole}
            onRenameRole={handleRenameRole}
            onUpdateRolePermissions={handleUpdateRolePermissions}
            onDeleteRole={handleDeleteRole}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/webhooks']) &&
        activeView === 'administration/webhooks' && (
          <WebhooksView permissions={currentUser.permissions || []} />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/logs']) &&
        activeView === 'administration/logs' && (
          <LogsView
            startOfWeek={generalSettings.startOfWeek}
            treatSaturdayAsHoliday={generalSettings.treatSaturdayAsHoliday}
          />
        )}
      {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/email']) &&
        activeView === 'administration/email' && (
          <EmailSettings
            config={emailConfig}
            onSave={handleSaveEmailConfig}
            onTestEmail={handleTestEmail}
          />
        )}
    </>
  );
};

const SettingsAndReportsRoutes: React.FC<{
  controller: AuthenticatedAppContentController;
}> = ({ controller }) => {
  const {
    activeView,
    currentUser,
    generalSettings,
    handleCreateMcpToken,
    handleGetPersonalAccessToken,
    handleListMcpTokens,
    handleRenewPersonalAccessToken,
    handleRevokeMcpToken,
    handleUpdateUserPassword,
    handleUpdateUserSettings,
    reportsSettingsFailed,
    setUserSettingsTab,
    tApp,
    userSettingsTab,
    userSettings,
  } = controller;

  return (
    <>
      {activeView === 'settings' && (
        <UserSettings
          settings={userSettings}
          authMethod={currentUser.authMethod ?? 'local'}
          authProviderName={currentUser.authProviderName ?? null}
          rilTransferOptions={
            hasViewAccess(currentUser.permissions, 'timesheets/ril')
              ? generalSettings.rilTransferOptions
              : []
          }
          selectedTab={userSettingsTab}
          onSelectedTabChange={setUserSettingsTab}
          onUpdate={handleUpdateUserSettings}
          onUpdatePassword={handleUpdateUserPassword}
          onTotpSetup={(password: string) => api.auth.totpSetup(undefined, password)}
          onTotpConfirm={(code) => api.auth.totpConfirm(code).then(() => undefined)}
          onTotpDisable={(payload) => api.auth.totpDisable(payload).then(() => undefined)}
          onRegenerateTotpBackupCodes={(code) => api.auth.regenerateTotpBackupCodes(code)}
          onGetTotpStatus={() => api.auth.getTotpStatus()}
          onListMcpTokens={handleListMcpTokens}
          onCreateMcpToken={handleCreateMcpToken}
          onRevokeMcpToken={handleRevokeMcpToken}
          onGetPersonalAccessToken={handleGetPersonalAccessToken}
          onRenewPersonalAccessToken={handleRenewPersonalAccessToken}
        />
      )}
      {activeView === 'reports/ai-reporting' &&
        (reportsSettingsFailed ? (
          <ReportsSettingsError message={tApp('reports:aiReporting.settingsFailedToLoad')} />
        ) : (
          <AiReportingView
            key={`${currentUser.id}|${generalSettings.enableAiReporting ? 'enabled' : 'disabled'}`}
            currentUserId={currentUser.id}
            permissions={currentUser.permissions || []}
            enableAiReporting={generalSettings.enableAiReporting}
          />
        ))}
    </>
  );
};

const ReportsSettingsError: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex h-[calc(100vh-180px)] min-h-[560px] items-center justify-center">
    <div className="text-center">
      <i className="fa-solid fa-triangle-exclamation text-3xl text-amber-500 mb-3" />
      <p className="text-zinc-700 font-medium">{message}</p>
    </div>
  </div>
);

const App: React.FC = () => (
  <>
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
    {/* Outside the boundary so toasts keep rendering if the boundary trips. */}
    <Toaster richColors closeButton position="top-right" />
  </>
);

export default App;
