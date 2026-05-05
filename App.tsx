import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import ClientsView from './components/CRM/ClientsView';
import SuppliersView from './components/CRM/SuppliersView';
import InternalListingView from './components/catalog/InternalListingView';
import ApiDocsView from './components/docs/ApiDocsView';
import FrontendDocsView from './components/docs/FrontendDocsView';
import ExternalEmployeesView from './components/HR/ExternalEmployeesView';
import InternalEmployeesView from './components/HR/InternalEmployeesView';
import Layout from './components/Layout';
import Login from './components/Login';
import NotFound from './components/NotFound';
import ProjectsView from './components/projects/ProjectsView';
import TasksView from './components/projects/TasksView';
import RecurringManager from './components/RecurringManager';
import AiReportingView from './components/reports/AiReportingView';
import SessionTimeoutHandler from './components/SessionTimeoutHandler';
import ClientOffersView from './components/sales/ClientOffersView';
import ClientQuotesView from './components/sales/ClientQuotesView';
import SupplierQuotesView from './components/sales/SupplierQuotesView';
import Calendar from './components/shared/Calendar';
import CustomSelect from './components/shared/CustomSelect';
import StandardTable, { type Column } from './components/shared/StandardTable';
import StatusBadge from './components/shared/StatusBadge';
import Tooltip from './components/shared/Tooltip';
import DailyView from './components/timesheet/DailyView';
import WeeklyView from './components/timesheet/WeeklyView';
import UserSettings from './components/UserSettings';
import WorkUnitsView from './components/WorkUnitsView';
import { makeClientHandlers } from './hooks/handlers/clientHandlers';
import { makeEntryHandlers } from './hooks/handlers/entryHandlers';
import { makeInvoiceHandlers } from './hooks/handlers/invoiceHandlers';
import { makeProductHandlers } from './hooks/handlers/productHandlers';
import { makeProjectHandlers } from './hooks/handlers/projectHandlers';
import { makeQuoteHandlers } from './hooks/handlers/quoteHandlers';
import { makeSupplierHandlers } from './hooks/handlers/supplierHandlers';
import { makeSupplierInvoiceHandlers } from './hooks/handlers/supplierInvoiceHandlers';
import { makeSupplierQuoteHandlers } from './hooks/handlers/supplierQuoteHandlers';
import { makeTaskHandlers } from './hooks/handlers/taskHandlers';
import { makeUserHandlers } from './hooks/handlers/userHandlers';
import { useAuth } from './hooks/useAuth';
import { listRequest, useModuleLoader } from './hooks/useModuleLoader';
import api, { type Settings } from './services/api';
import type {
  Client,
  ClientOffer,
  ClientsOrder,
  EmailConfig,
  GeneralSettings as IGeneralSettings,
  Invoice,
  LdapConfig,
  Notification,
  Product,
  Project,
  ProjectTask,
  Quote,
  Role,
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
import {
  dateOnlyStringToLocalDate,
  formatDateOnlyForLocale,
  getLocalDateString,
} from './utils/date';
import { getErrorMessage } from './utils/errors';
import { isItalianHoliday } from './utils/holidays';
import {
  buildPermission,
  hasAnyPermission,
  hasPermission,
  VIEW_PERMISSION_MAP,
} from './utils/permissions';
import { applyTheme, getTheme } from './utils/theme';

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

const canonicalizeLegacyHash = (hash: string) => {
  if (hash === 'suppliers/manage') return 'crm/suppliers';
  if (hash === 'suppliers/quotes') return 'sales/supplier-quotes';
  if (hash === 'sales/supplier-offers') return 'sales/supplier-quotes';
  if (hash === 'administration/work-units') return 'hr/work-units';
  return hash;
};

const TrackerView: React.FC<{
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAddEntry: (entry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>) => void;
  onDeleteEntry: (id: string) => void;
  onUpdateEntry: (id: string, updates: Partial<TimeEntry>) => void;
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
  onAddBulkEntries: (entries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => Promise<void>;
  onRecurringAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
  defaultLocation?: TimeEntryLocation;
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
}) => {
  const { t } = useTranslation('timesheets');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString());
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

  const handleDeleteClick = useCallback(
    (entry: TimeEntry) => {
      const task = projectTasks.find(
        (t) => t.name === entry.task && t.projectId === entry.projectId,
      );
      if (entry.isPlaceholder || task?.isRecurring) {
        // Show modal for recurring entries
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

  const viewingUser = availableUsers.find((u) => u.id === viewingUserId);
  const isViewingSelf = viewingUserId === currentUser.id;

  const userOptions = useMemo(
    () => availableUsers.map((u) => ({ id: u.id, name: u.name })),
    [availableUsers],
  );

  const activityColumns = useMemo<Column<TimeEntry>[]>(
    () => [
      {
        id: 'date',
        header: t('entry.date'),
        accessorKey: 'date',
        hidden: !!selectedDate,
      },
      {
        id: 'client',
        header: t('entry.client'),
        accessorKey: 'clientName',
        cell: ({ row }) => <span className="font-semibold text-slate-800">{row.clientName}</span>,
      },
      {
        id: 'project',
        header: t('entry.project'),
        accessorKey: 'projectName',
        cell: ({ row }) => <span className="font-semibold text-slate-800">{row.projectName}</span>,
      },
      {
        id: 'task',
        header: t('entry.task'),
        accessorKey: 'task',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{row.task}</span>
            {row.isPlaceholder && (
              <Tooltip label={t('entry.recurringTask')}>
                {() => <i className="fa-solid fa-repeat text-[10px] text-indigo-400" />}
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
            <span className="text-slate-300 text-xs">-</span>
          ),
      },
      {
        id: 'notes',
        header: t('tracker.notes'),
        accessorKey: 'notes',
        className: 'whitespace-normal',
        cell: ({ row }) =>
          row.notes ? (
            <div className="text-slate-500 text-xs italic leading-relaxed">{row.notes}</div>
          ) : (
            <span className="text-slate-300 text-xs">-</span>
          ),
      },
      {
        id: 'duration',
        header: t('entry.hours'),
        accessorKey: 'duration',
        align: 'right',
        cell: ({ row }) => (
          <span className="font-black text-slate-900">
            {row.isPlaceholder && row.duration === 0 ? '--' : row.duration.toFixed(2)}
          </span>
        ),
      },
      {
        id: 'delete',
        header: t('common:labels.actions', { defaultValue: 'Actions' }),
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right',
        cell: ({ row }) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick(row);
            }}
            className="text-slate-200 hover:text-red-500 transition-colors p-1"
          >
            <i className="fa-solid fa-trash-can text-xs" />
          </button>
        ),
      },
    ],
    [selectedDate, t, handleDeleteClick],
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      {/* Top Middle Toggle */}
      <div className="flex justify-center">
        <div className="relative grid grid-cols-2 bg-slate-200/50 p-1 rounded-full w-full max-w-60">
          <div
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-full shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
              trackerMode === 'daily' ? 'translate-x-0 left-1' : 'translate-x-full left-1'
            }`}
          ></div>
          <button
            onClick={() => setTrackerMode('daily')}
            className={`relative z-10 w-full py-2 text-xs font-bold transition-colors duration-300 ${trackerMode === 'daily' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t('tracker.mode.daily')}
          </button>
          <button
            onClick={() => setTrackerMode('weekly')}
            className={`relative z-10 w-full py-2 text-xs font-bold transition-colors duration-300 ${trackerMode === 'weekly' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t('tracker.mode.weekly')}
          </button>
        </div>
      </div>

      {trackerMode === 'weekly' ? (
        <WeeklyView
          entries={entries}
          clients={clients}
          projects={projects}
          projectTasks={projectTasks}
          onDeleteEntry={onDeleteEntry}
          onUpdateEntry={onUpdateEntry}
          viewingUserId={viewingUserId}
          availableUsers={availableUsers}
          onViewUserChange={onViewUserChange}
          onAddBulkEntries={onAddBulkEntries}
          startOfWeek={startOfWeek}
          treatSaturdayAsHoliday={treatSaturdayAsHoliday}
          allowWeekendSelection={allowWeekendSelection}
          defaultLocation={defaultLocation}
        />
      ) : (
        <div className="space-y-6">
          {/* Manager Selection Header */}
          {availableUsers.length > 1 && (
            <div className="max-w-xl mx-auto">
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shadow-sm shrink-0 ${isViewingSelf ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}
                  >
                    {viewingUser?.avatarInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      {isViewingSelf ? t('tracker.myTimesheet') : t('tracker.managingUser')}
                    </p>
                    <p className="text-sm font-bold text-slate-800 truncate">{viewingUser?.name}</p>
                  </div>
                </div>
                <div className="w-full sm:w-56 shrink-0">
                  <CustomSelect
                    options={userOptions}
                    value={viewingUserId}
                    onChange={(val) => onViewUserChange(val as string)}
                    label={t('tracker.switchUserView')}
                    searchable={true}
                  />
                </div>
              </div>
            </div>
          )}

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
              headerExtras={
                selectedDate ? (
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">
                      {t('tracker.dayTotal')}
                    </p>
                    <p
                      className={`text-lg font-black transition-colors ${dailyTotal > dailyGoal ? 'text-red-600' : 'text-praetor'}`}
                    >
                      {dailyTotal.toFixed(2)} h
                    </p>
                  </div>
                ) : undefined
              }
              data={filteredEntries}
              columns={activityColumns}
              defaultRowsPerPage={10}
              rowClassName={(row) => (row.isPlaceholder ? 'bg-indigo-50/30 italic' : '')}
              emptyState={
                <div className="px-6 py-20 text-center">
                  <i className="fa-solid fa-calendar-day text-4xl text-slate-100 mb-4 block" />
                  <p className="text-slate-400 font-medium text-sm">{t('tracker.noEntries')}</p>
                </div>
              }
            />
          </div>
        </div>
      )}

      {/* Recurring Delete Modal */}
      {pendingDeleteEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                {t('entry.stopRecurringTask')}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {t('entry.howHandleEntries')}{' '}
                <strong className="text-slate-800">{pendingDeleteEntry.task}</strong>?
              </p>
            </div>

            <div className="p-4 space-y-3">
              <button
                onClick={() => handleRecurringDelete('stop')}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 group-hover:text-indigo-700">
                    {t('recurring.stopOnly')}
                  </span>
                  <i className="fa-solid fa-pause text-slate-300 group-hover:text-indigo-500"></i>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t('recurring.stopOnlyDesc')}
                </p>
              </button>

              <button
                onClick={() => handleRecurringDelete('delete_future')}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 group-hover:text-red-700">
                    {t('recurring.deleteFuture')}
                  </span>
                  <i className="fa-solid fa-forward text-slate-300 group-hover:text-red-500"></i>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t('recurring.deleteFutureDesc')}
                </p>
              </button>

              <button
                onClick={() => handleRecurringDelete('delete_all')}
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

            <div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
              <button
                onClick={() => setPendingDeleteEntry(null)}
                className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                {t('entry.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  useLayoutEffect(() => {
    applyTheme(getTheme());
  }, []);

  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clientOffers, setClientOffers] = useState<ClientOffer[]>([]);
  const [clientsOrders, setClientsOrders] = useState<ClientsOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuotes, setSupplierQuotes] = useState<SupplierQuote[]>([]);
  const [supplierOrders, setSupplierOrders] = useState<SupplierSaleOrder[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoice[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  // Bumped on logout/role-switch so in-flight cursor streams stop appending stale rows.
  const entriesStreamTokenRef = useRef(0);
  const [ldapConfig, setLdapConfig] = useState<LdapConfig>({
    enabled: false,
    serverUrl: 'ldap://ldap.example.com:389',
    baseDn: 'dc=example,dc=com',
    bindDn: 'cn=read-only-admin,dc=example,dc=com',
    bindPassword: '',
    userFilter: '(uid={0})',
    groupBaseDn: 'ou=groups,dc=example,dc=com',
    groupFilter: '(member={0})',
    roleMappings: [],
  });
  const [generalSettings, setGeneralSettings] = useState({
    currency: '€',
    dailyLimit: 8,
    startOfWeek: 'Monday' as 'Monday' | 'Sunday',
    treatSaturdayAsHoliday: true,
    allowWeekendSelection: true,
    enableAiReporting: false,
    geminiApiKey: '',
    aiProvider: 'gemini' as 'gemini' | 'openrouter',
    openrouterApiKey: '',
    geminiModelId: '',
    openrouterModelId: '',
    defaultLocation: 'remote' as TimeEntryLocation,
  });
  const {
    loadedModules,
    moduleLoadErrors,
    loadDatasets,
    markModuleLoaded,
    recordFailures,
    reset: resetModuleLoader,
  } = useModuleLoader();
  const [hasLoadedGeneralSettings, setHasLoadedGeneralSettings] = useState(false);
  const [hasLoadedLdapConfig, setHasLoadedLdapConfig] = useState(false);
  const [hasLoadedEmailConfig, setHasLoadedEmailConfig] = useState(false);
  const [emailConfig, setEmailConfig] = useState<EmailConfig>({
    enabled: false,
    smtpHost: '',
    smtpPort: 587,
    smtpEncryption: 'tls',
    smtpRejectUnauthorized: true,
    smtpUser: '',
    smtpPassword: '',
    fromEmail: '',
    fromName: 'Praetor',
  });

  const [workUnits, setWorkUnits] = useState<WorkUnit[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [hasLoadedRoles, setHasLoadedRoles] = useState(false);

  // Notifications state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const [viewingUserId, setViewingUserId] = useState<string>('');
  const [viewingUserAssignments, setViewingUserAssignments] = useState<{
    clientIds: string[];
    projectIds: string[];
    taskIds: string[];
  } | null>(null);
  const VALID_VIEWS: View[] = useMemo(
    () => [
      'timesheets/tracker',
      'timesheets/recurring',
      'administration/user-management',
      'administration/roles',
      'administration/authentication',
      'administration/general',
      'administration/email',
      'administration/logs',
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
      'projects/tasks',
      'hr/internal',
      'hr/external',
      'hr/work-units',
      // Reports module
      'reports/ai-reporting',
      'settings',
      'docs/api',
      'docs/frontend',
    ],
    [],
  );

  const [activeView, setActiveView] = useState<View | '404'>(() => {
    const pathname = window.location.pathname;
    if (pathname.startsWith('/docs/api')) {
      return 'docs/api';
    }
    if (pathname.startsWith('/docs/frontend')) {
      return 'docs/frontend';
    }
    const rawHash = window.location.hash.replace('#/', '').replace('#', '');
    // We can't use the memoized VALID_VIEWS here because this runs before the initial render
    // So we define the list once for initialization
    const validViews: View[] = [
      'timesheets/tracker',
      'timesheets/recurring',
      'administration/user-management',
      'administration/roles',
      'administration/authentication',
      'administration/general',
      'administration/email',
      'administration/logs',
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
      'projects/tasks',
      'hr/internal',
      'hr/external',
      'hr/work-units',
      // Reports module
      'reports/ai-reporting',
      'settings',
      'docs/api',
      'docs/frontend',
    ];
    const canonicalHash = canonicalizeLegacyHash(rawHash);
    const hash = canonicalHash as View;
    return validViews.includes(hash)
      ? hash
      : canonicalHash === '' || canonicalHash === 'login'
        ? 'timesheets/tracker'
        : '404';
  });
  const [clientQuoteFilterId, setClientQuoteFilterId] = useState<string | null>(null);
  const [clientOfferFilterId, setClientOfferFilterId] = useState<string | null>(null);
  const [supplierQuoteFilterId, setSupplierQuoteFilterId] = useState<string | null>(null);
  const [clientsOrderFilterId, setClientsOrderFilterId] = useState<string | null>(null);

  const clearAuthScopedAppState = useCallback(() => {
    resetModuleLoader();
    setHasLoadedGeneralSettings(false);
    setHasLoadedLdapConfig(false);
    setHasLoadedEmailConfig(false);
    setHasLoadedRoles(false);
    setRoles([]);
    setUsers([]);
    setClients([]);
    setProjects([]);
    setProjectTasks([]);
    setProducts([]);
    setQuotes([]);
    setClientOffers([]);
    setClientsOrders([]);
    setInvoices([]);
    setSuppliers([]);
    setSupplierQuotes([]);
    setSupplierOrders([]);
    setSupplierInvoices([]);
    setEntries([]);
    entriesStreamTokenRef.current++;
    setWorkUnits([]);
  }, [resetModuleLoader]);

  const {
    currentUser,
    isLoading,
    logoutReason,
    clearLogoutReason,
    userSettings,
    setUserSettings,
    login,
    logout,
    switchRole,
  } = useAuth({
    onLogin: (user) => {
      clearAuthScopedAppState();
      setViewingUserId(user.id);
      const defaultView = getDefaultViewForPermissions(user.permissions || []);
      const activePermission =
        activeView !== '404' ? VIEW_PERMISSION_MAP[activeView as View] : undefined;
      const canAccessActive = activePermission
        ? hasPermission(user.permissions || [], activePermission)
        : false;
      if (activeView === '404' || !canAccessActive) {
        setActiveView(defaultView);
      }
    },
    onLogout: () => {
      clearAuthScopedAppState();
      setViewingUserId('');
    },
  });

  const handleLogin = login;
  const handleLogout = logout;
  const handleSwitchRole = useCallback(
    async (roleId: string) => {
      try {
        await switchRole(roleId);
      } catch (err) {
        console.error('Failed to switch role:', err);
        alert('Failed to switch role: ' + (err as Error).message);
      }
    },
    [switchRole],
  );

  const supplierQuoteHandlers = useMemo(
    () =>
      makeSupplierQuoteHandlers({
        supplierQuoteFilterId,
        setSupplierQuotes,
        setSupplierOrders,
        setSupplierInvoices,
        setSupplierQuoteFilterId,
        setActiveView,
      }),
    [supplierQuoteFilterId],
  );

  const quoteHandlers = useMemo(
    () =>
      makeQuoteHandlers({
        quotes,
        clientQuoteFilterId,
        clientOfferFilterId,
        setQuotes,
        setClientOffers,
        setClientsOrders,
        setInvoices,
        setClientQuoteFilterId,
        setClientOfferFilterId,
        setActiveView,
        refreshSupplierQuoteFlow: supplierQuoteHandlers.refreshSupplierQuoteFlow,
      }),
    [
      quotes,
      clientQuoteFilterId,
      clientOfferFilterId,
      supplierQuoteHandlers.refreshSupplierQuoteFlow,
    ],
  );

  const clientHandlers = useMemo(
    () =>
      makeClientHandlers({
        projects,
        setClients,
        setProjects,
        setProjectTasks,
      }),
    [projects],
  );

  const productHandlers = useMemo(() => makeProductHandlers({ setProducts }), []);

  const projectHandlers = useMemo(
    () =>
      makeProjectHandlers({
        projects,
        clientsOrders,
        setProjects,
        setProjectTasks,
        setEntries,
      }),
    [projects, clientsOrders],
  );

  const entryHandlers = useMemo(
    () =>
      makeEntryHandlers({
        currentUser,
        viewingUserId,
        setEntries,
      }),
    [currentUser, viewingUserId],
  );

  const invoiceHandlers = useMemo(() => makeInvoiceHandlers({ setInvoices }), []);

  const supplierHandlers = useMemo(() => makeSupplierHandlers({ setSuppliers }), []);

  const supplierInvoiceHandlers = useMemo(
    () =>
      makeSupplierInvoiceHandlers({
        setSupplierInvoices,
        setActiveView,
      }),
    [],
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
      }),
    [currentUser, viewingUserId],
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
    if (activeView === 'docs/api' || activeView === 'docs/frontend') return true;
    if (!currentUser) return false;
    if (activeView === '404') return false;
    if (activeView === 'reports/ai-reporting') {
      if (hasLoadedGeneralSettings && !generalSettings.enableAiReporting) return false;
    }

    const permission = VIEW_PERMISSION_MAP[activeView as View];
    return permission ? hasPermission(currentUser.permissions, permission) : false;
  }, [activeView, currentUser, hasLoadedGeneralSettings, generalSettings.enableAiReporting]);

  // Redirect to 404 if route is not accessible
  useEffect(() => {
    if (currentUser && !isRouteAccessible && activeView !== '404') {
      React.startTransition(() => setActiveView('404'));
    }
  }, [currentUser, isRouteAccessible, activeView]);

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
    if (!currentUser) {
      if (window.location.hash !== '#/login') window.location.hash = '/login';
      return;
    }
    window.location.hash = '/' + activeView;
  }, [activeView, currentUser, isLoading]);

  useEffect(() => {
    if (
      activeView !== 'sales/client-quotes' &&
      activeView !== 'sales/client-offers' &&
      clientQuoteFilterId
    ) {
      React.startTransition(() => setClientQuoteFilterId(null));
    }
    if (
      activeView !== 'sales/supplier-quotes' &&
      activeView !== 'accounting/supplier-orders' &&
      supplierQuoteFilterId
    ) {
      React.startTransition(() => setSupplierQuoteFilterId(null));
    }
    if (activeView !== 'accounting/clients-orders' && clientsOrderFilterId) {
      React.startTransition(() => setClientsOrderFilterId(null));
    }
  }, [activeView, clientQuoteFilterId, supplierQuoteFilterId, clientsOrderFilterId]);

  // Sync state with hash (for back/forward buttons)
  useEffect(() => {
    const handleHashChange = () => {
      const rawHash = window.location.hash.replace('#/', '').replace('#', '');
      if (rawHash === 'login') {
        if (currentUser) {
          setActiveView('timesheets/tracker');
        }
        return;
      }
      const canonicalHash = canonicalizeLegacyHash(rawHash);
      if (canonicalHash !== rawHash) {
        window.location.hash = `/${canonicalHash}`;
        return;
      }
      const hash = canonicalHash as View;
      const nextView = VALID_VIEWS.includes(hash)
        ? hash
        : canonicalHash === ''
          ? 'timesheets/tracker'
          : '404';
      if (nextView !== activeView) {
        setActiveView(nextView);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeView, VALID_VIEWS, currentUser]);

  // Reset viewingUserId when navigating away from tracker
  useEffect(() => {
    if (activeView !== 'timesheets/tracker' && currentUser && viewingUserId !== currentUser.id) {
      React.startTransition(() => setViewingUserId(currentUser.id));
    }
  }, [activeView, currentUser, viewingUserId]);

  useEffect(() => {
    if (activeView !== 'sales/client-offers' && activeView !== 'accounting/clients-orders') {
      setClientOfferFilterId(null);
    }
  }, [activeView]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isRouteAccessible) return;
    const module = getModuleFromView(activeView);
    if (!module || module === 'settings') return;
    if (loadedModules.has(module)) return;

    const loadGeneralSettings = async () => {
      if (hasLoadedGeneralSettings) return;
      const genSettings = await api.generalSettings.get();
      if (genSettings.currency === 'USD') {
        genSettings.currency = '$';
      }
      setGeneralSettings({
        ...genSettings,
        geminiApiKey: genSettings.geminiApiKey || '',
        aiProvider: genSettings.aiProvider || 'gemini',
        openrouterApiKey: genSettings.openrouterApiKey || '',
        geminiModelId: genSettings.geminiModelId || '',
        openrouterModelId: genSettings.openrouterModelId || '',
        defaultLocation: genSettings.defaultLocation || 'remote',
      });
      setHasLoadedGeneralSettings(true);
    };

    const loadLdapConfig = async () => {
      if (hasLoadedLdapConfig) return;
      const ldap = await api.ldap.getConfig();
      setLdapConfig(ldap);
      setHasLoadedLdapConfig(true);
    };

    const loadEmailConfig = async () => {
      if (hasLoadedEmailConfig) return;
      const email = await api.email.getConfig();
      setEmailConfig(email);
      setHasLoadedEmailConfig(true);
    };

    const loadRoles = async () => {
      if (hasLoadedRoles) return;
      const rolesData = await api.roles.list();
      setRoles(rolesData);
      setHasLoadedRoles(true);
    };

    const loadOptionalDataset = async (
      moduleName: string,
      dataset: string,
      load: () => Promise<void>,
      failures: string[],
    ) => {
      try {
        await load();
      } catch (err) {
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
        const permissions = currentUser.permissions || [];
        const canViewTimesheets = hasAnyPermission(permissions, [
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canViewHr = hasAnyPermission(permissions, [
          buildPermission('hr.internal', 'view'),
          buildPermission('hr.external', 'view'),
          buildPermission('hr.work_units', 'view'),
          buildPermission('hr.work_units_all', 'view'),
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
          buildPermission('crm.clients', 'view'),
          buildPermission('crm.clients_all', 'view'),
          buildPermission('crm.suppliers', 'view'),
          buildPermission('crm.suppliers_all', 'view'),
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
          buildPermission('projects.manage', 'view'),
          buildPermission('projects.tasks', 'view'),
        ]);
        const canViewSuppliersModule = hasPermission(
          permissions,
          buildPermission('sales.supplier_quotes', 'view'),
        );

        const canListClients = hasAnyPermission(permissions, [
          buildPermission('crm.clients', 'view'),
          buildPermission('crm.clients_all', 'view'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
          buildPermission('projects.manage', 'view'),
          buildPermission('projects.tasks', 'view'),
          buildPermission('sales.client_quotes', 'view'),
          buildPermission('sales.client_offers', 'view'),
          buildPermission('accounting.clients_orders', 'view'),
          buildPermission('accounting.clients_invoices', 'view'),
          buildPermission('catalog.internal_listing', 'view'),
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management', 'update'),
        ]);
        const canListProjects = hasAnyPermission(permissions, [
          buildPermission('projects.manage', 'view'),
          buildPermission('projects.tasks', 'view'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canListTasks = hasAnyPermission(permissions, [
          buildPermission('projects.tasks', 'view'),
          buildPermission('projects.manage', 'view'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canListUsers = hasAnyPermission(permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('hr.internal', 'view'),
          buildPermission('hr.external', 'view'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('projects.manage', 'view'),
          buildPermission('projects.tasks', 'view'),
          buildPermission('hr.work_units', 'view'),
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
          buildPermission('crm.suppliers', 'view'),
          buildPermission('crm.suppliers_all', 'view'),
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
        const canListWorkUnits = hasAnyPermission(permissions, [
          buildPermission('hr.work_units', 'view'),
          buildPermission('hr.work_units_all', 'view'),
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
        const canViewEmail = hasPermission(
          permissions,
          buildPermission('administration.email', 'view'),
        );
        const canViewCrmClients = hasAnyPermission(permissions, [
          buildPermission('crm.clients', 'view'),
          buildPermission('crm.clients_all', 'view'),
        ]);
        const canViewCrmSuppliers = hasAnyPermission(permissions, [
          buildPermission('crm.suppliers', 'view'),
          buildPermission('crm.suppliers_all', 'view'),
        ]);
        const canViewCatalogInternal = hasPermission(
          permissions,
          buildPermission('catalog.internal_listing', 'view'),
        );

        switch (module) {
          case 'timesheets': {
            if (!canViewTimesheets) return;
            const streamRemainingEntries = async (cursor: string | null, token: number) => {
              while (cursor) {
                if (entriesStreamTokenRef.current !== token) return;
                try {
                  const page = await api.entries.listPage({ cursor, limit: 500 });
                  if (entriesStreamTokenRef.current !== token) return;
                  setEntries((prev) => [...prev, ...page.entries]);
                  cursor = page.nextCursor;
                } catch (err) {
                  console.error('Failed to stream remaining entries:', err);
                  return;
                }
              }
            };
            failedDatasets = await loadDatasets(module, [
              {
                dataset: 'entries',
                enabled: true,
                load: () => api.entries.listPage({ limit: 500 }),
                apply: (page) => {
                  const token = ++entriesStreamTokenRef.current;
                  setEntries(page.entries);
                  if (page.nextCursor) void streamRemainingEntries(page.nextCursor, token);
                },
              },
              listRequest('clients', canListClients, () => api.clients.list(), setClients),
              listRequest('projects', canListProjects, () => api.projects.list(), setProjects),
              listRequest('tasks', canListTasks, () => api.tasks.list(), setProjectTasks),
              listRequest('users', canListUsers, () => api.users.list(), setUsers),
            ]);
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
            failedDatasets = await loadDatasets(module, [
              listRequest('users', canListUsers, () => api.users.list(), setUsers),
              listRequest('work units', canListWorkUnits, () => api.workUnits.list(), setWorkUnits),
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
            ]);
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
            const shouldLoadRoles = canViewRoles || canViewAuthentication || canViewUserManagement;

            failedDatasets = await loadDatasets(module, [
              listRequest(
                'users',
                shouldLoadUsers && canListUsers,
                () => api.users.list(),
                setUsers,
              ),
            ]);

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
              await loadOptionalDataset(module, 'authentication', loadLdapConfig, failedDatasets);
            }
            if (canViewEmail) {
              await loadOptionalDataset(module, 'email settings', loadEmailConfig, failedDatasets);
            }
            break;
          }
          case 'crm': {
            if (!canViewCrm) return;
            failedDatasets = await loadDatasets(module, [
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
            ]);
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
            failedDatasets = await loadDatasets(module, [
              listRequest('quotes', canListQuotes, () => api.quotes.list(), setQuotes),
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
              listRequest('suppliers', canListSuppliers, () => api.suppliers.list(), setSuppliers),
              listRequest('products', canListProducts, () => api.products.list(), setProducts),
            ]);
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
            failedDatasets = await loadDatasets(module, [
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
              listRequest('suppliers', canListSuppliers, () => api.suppliers.list(), setSuppliers),
              listRequest('products', canListProducts, () => api.products.list(), setProducts),
            ]);
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
            failedDatasets = await loadDatasets(module, [
              listRequest(
                'products',
                canListProducts && canViewCatalogInternal,
                () => api.products.list(),
                setProducts,
              ),
            ]);
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
            failedDatasets = await loadDatasets(module, [
              listRequest('projects', canListProjects, () => api.projects.list(), setProjects),
              listRequest('tasks', canListTasks, () => api.tasks.list(), setProjectTasks),
              listRequest('clients', canListClients, () => api.clients.list(), setClients),
              listRequest('users', canListUsers, () => api.users.list(), setUsers),
              listRequest('work units', canListWorkUnits, () => api.workUnits.list(), setWorkUnits),
              listRequest(
                'client orders',
                canListOrders,
                () => api.clientsOrders.list(),
                setClientsOrders,
              ),
            ]);
            break;
          }
          case 'suppliers': {
            if (!canViewSuppliersModule) return;
            failedDatasets = await loadDatasets(module, [
              listRequest('suppliers', canListSuppliers, () => api.suppliers.list(), setSuppliers),
              listRequest(
                'supplier quotes',
                canListSupplierQuotes,
                () => api.supplierQuotes.list(),
                setSupplierQuotes,
              ),
              listRequest('products', canListProducts, () => api.products.list(), setProducts),
            ]);
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
        console.error('Failed to load module data:', err);
        failedDatasets.push('module data');
      } finally {
        const uniqueFailures = Array.from(new Set(failedDatasets));
        recordFailures(module, uniqueFailures);
        markModuleLoaded(module);
      }
    };

    loadModuleData();
  }, [
    activeView,
    currentUser,
    isRouteAccessible,
    loadedModules,
    hasLoadedGeneralSettings,
    hasLoadedLdapConfig,
    hasLoadedEmailConfig,
    hasLoadedRoles,
  ]);

  // Load entries and assignments when viewing user changes
  useEffect(() => {
    if (!currentUser || !viewingUserId) return;

    const loadAssignments = async () => {
      try {
        const canViewAssignments = hasAnyPermission(currentUser.permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('hr.employee_assignments', 'update'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.tracker_all', 'view'),
        ]);

        // If permitted user is viewing another user, fetch that user's assignments to filter the dropdowns
        if (canViewAssignments && viewingUserId !== currentUser.id) {
          const assignments = await api.users.getAssignments(viewingUserId);
          setViewingUserAssignments(assignments);
        } else {
          setViewingUserAssignments(null);
        }
      } catch (err) {
        console.error('Failed to load user assignments:', err);
      }
    };

    loadAssignments();
  }, [currentUser, viewingUserId]);

  // Update viewingUserId when currentUser changes
  useEffect(() => {
    if (currentUser) {
      React.startTransition(() => setViewingUserId(currentUser.id));
    }
  }, [currentUser]);

  // Load notifications for permitted users
  useEffect(() => {
    if (
      !currentUser ||
      !hasPermission(currentUser.permissions, buildPermission('notifications', 'view'))
    ) {
      // Use queueMicrotask to avoid synchronous setState warning
      queueMicrotask(() => {
        setNotifications([]);
        setUnreadNotificationCount(0);
      });
      return;
    }

    const loadNotifications = async () => {
      try {
        const data = await api.notifications.list();
        setNotifications(data.notifications);
        setUnreadNotificationCount(data.unreadCount);
      } catch (err) {
        console.error('Failed to load notifications:', err);
      }
    };

    // Load immediately and then poll every 60 seconds
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Notification handlers
  const handleMarkNotificationAsRead = useCallback(async (id: string) => {
    try {
      await api.notifications.markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadNotificationCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, []);

  const handleMarkAllNotificationsAsRead = useCallback(async () => {
    try {
      await api.notifications.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadNotificationCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, []);

  const handleDeleteNotification = useCallback(
    async (id: string) => {
      try {
        const notification = notifications.find((n) => n.id === id);
        await api.notifications.delete(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        if (notification && !notification.isRead) {
          setUnreadNotificationCount((prev) => Math.max(0, prev - 1));
        }
      } catch (err) {
        console.error('Failed to delete notification:', err);
      }
    },
    [notifications],
  );

  // Determine available users for the dropdown based on permissions
  const availableUsers = useMemo(() => {
    if (!currentUser) return [];
    if (users.length > 0) return users;
    return [currentUser];
  }, [users, currentUser]);

  const generateRecurringEntries = useCallback(async () => {
    const today = new Date();
    // Default future limit for entries without an end date
    const defaultFutureLimit = new Date();
    defaultFutureLimit.setDate(today.getDate() + 14);

    const newEntries: TimeEntry[] = [];

    for (const task of projectTasks.filter((t) => t.isRecurring)) {
      const project = projects.find((p) => p.id === task.projectId);
      const client = project ? clients.find((c) => c.id === project.clientId) : null;
      if (!project || !client) continue;

      const startDate = task.recurrenceStart
        ? dateOnlyStringToLocalDate(task.recurrenceStart)
        : new Date();
      // Use recurrence end date if specified, otherwise use default 14-day limit
      const taskEndDate = task.recurrenceEnd ? dateOnlyStringToLocalDate(task.recurrenceEnd) : null;
      const futureLimit =
        taskEndDate && taskEndDate > defaultFutureLimit ? taskEndDate : defaultFutureLimit;

      for (let d = new Date(startDate); d <= futureLimit; d.setDate(d.getDate() + 1)) {
        if (taskEndDate && d > taskEndDate) break;

        // Skip disabled days: Sundays, Saturdays (if configured), and holidays
        const isSunday = d.getDay() === 0;
        const isSaturday = d.getDay() === 6;
        const holidayName = isItalianHoliday(d);
        const isDisabledDay =
          isSunday || (generalSettings.treatSaturdayAsHoliday && isSaturday) || !!holidayName;
        if (isDisabledDay) continue;

        const dateStr = getLocalDateString(d);

        let matches = false;
        if (task.recurrencePattern === 'daily') matches = true;
        if (task.recurrencePattern === 'weekly' && d.getDay() === startDate.getDay())
          matches = true;
        if (task.recurrencePattern === 'monthly' && d.getDate() === startDate.getDate())
          matches = true;

        // Custom patterns: monthly:first:X or monthly:last:X
        if (
          typeof task.recurrencePattern === 'string' &&
          task.recurrencePattern.startsWith('monthly:')
        ) {
          const parts = task.recurrencePattern.split(':');
          if (parts.length === 3) {
            const type = parts[1]; // 'first' or 'last'
            const targetDay = parseInt(parts[2], 10); // 0-6 (Sun-Sat) or 1-7 depending on UI, my modal uses 0=Sun, 1=Mon... match JS getDay()

            // Adjust for UI mapping: My modal uses 0=Sun, 1=Mon...6=Sat which matches getDay() perfectly.
            // Wait, in modal I used 0=Sunday, 1=Monday. JS getDay() returns 0=Sunday, 1=Monday. So it matches.

            if (d.getDay() === targetDay) {
              if (type === 'first') {
                // First: dates 1-7
                if (d.getDate() <= 7) matches = true;
              } else if (type === 'second') {
                // Second: dates 8-14
                if (d.getDate() > 7 && d.getDate() <= 14) matches = true;
              } else if (type === 'third') {
                // Third: dates 15-21
                if (d.getDate() > 14 && d.getDate() <= 21) matches = true;
              } else if (type === 'fourth') {
                // Fourth: dates 22-28
                if (d.getDate() > 21 && d.getDate() <= 28) matches = true;
              } else if (type === 'last') {
                // Last: adding 7 days puts us next month
                const nextWeek = new Date(d);
                nextWeek.setDate(d.getDate() + 7);
                if (nextWeek.getMonth() !== d.getMonth()) matches = true;
              }
            }
          }
        }
        if (matches) {
          const exists = entries.some(
            (e) => e.date === dateStr && e.projectId === task.projectId && e.task === task.name,
          );
          if (!exists) {
            try {
              const entry = await api.entries.create({
                date: dateStr,
                userId: currentUser?.id || '',
                clientId: client.id,
                clientName: client.name,
                projectId: task.projectId,
                projectName: project.name,
                task: task.name,
                duration: task.recurrenceDuration || 0,
                isPlaceholder: true,
                hourlyCost: currentUser?.costPerHour || 0,
              });
              newEntries.push(entry);
            } catch (err) {
              console.error('Failed to create recurring entry:', err);
            }
          }
        }
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...newEntries, ...prev].sort((a, b) => b.createdAt - a.createdAt));
    }
  }, [projectTasks, entries, projects, clients, currentUser, generalSettings]);

  // ... (rest of the logic remains validation which we don't need to change but need for context)

  // Filtered lists for TrackerView
  const filteredClients = useMemo(() => {
    const activeClients = clients.filter((c) => !c.isDisabled);
    if (!viewingUserAssignments) return activeClients;
    return activeClients.filter((c) => viewingUserAssignments.clientIds.includes(c.id));
  }, [clients, viewingUserAssignments]);

  const filteredProjects = useMemo(() => {
    const activeProjects = projects.filter((p) => {
      if (p.isDisabled) return false;
      const client = clients.find((c) => c.id === p.clientId);
      return !client?.isDisabled;
    });
    if (!viewingUserAssignments) return activeProjects;
    return activeProjects.filter((p) => viewingUserAssignments.projectIds.includes(p.id));
  }, [projects, clients, viewingUserAssignments]);

  const filteredTasks = useMemo(() => {
    const activeTasks = projectTasks.filter((t) => {
      if (t.isDisabled) return false;
      const project = projects.find((p) => p.id === t.projectId);
      if (!project || project.isDisabled) return false;
      const client = clients.find((c) => c.id === project.clientId);
      return !client?.isDisabled;
    });
    if (!viewingUserAssignments) return activeTasks;
    return activeTasks.filter((t) => viewingUserAssignments.taskIds.includes(t.id));
  }, [projectTasks, projects, clients, viewingUserAssignments]);

  useEffect(() => {
    if (!currentUser) return;
    const timer = setTimeout(() => {
      generateRecurringEntries();
    }, 100);
    return () => clearTimeout(timer);
  }, [generateRecurringEntries, currentUser]);

  const taskHandlers = useMemo(
    () =>
      makeTaskHandlers({
        projectTasks,
        setProjectTasks,
        setEntries,
        generateRecurringEntries,
      }),
    [projectTasks, generateRecurringEntries],
  );

  const handleAddEntry = entryHandlers.add;
  const handleAddBulkEntries = entryHandlers.addBulk;
  const handleDeleteEntry = entryHandlers.delete;
  const handleUpdateEntry = entryHandlers.update;

  const handleUpdateTask = taskHandlers.update;
  const handleMakeRecurring = taskHandlers.makeRecurring;
  const handleRecurringAction = taskHandlers.recurringAction;

  const addClient = clientHandlers.add;
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

  const addQuote = quoteHandlers.addQuote;
  const handleUpdateQuote = quoteHandlers.updateQuote;
  const handleDeleteQuote = quoteHandlers.deleteQuote;
  const handleUpdateClientOffer = quoteHandlers.updateClientOffer;
  const handleDeleteClientOffer = quoteHandlers.deleteClientOffer;
  const handleCreateClientOfferFromQuote = quoteHandlers.createClientOfferFromQuote;
  const handleUpdateClientsOrder = quoteHandlers.updateClientsOrder;
  const handleDeleteClientsOrder = quoteHandlers.deleteClientsOrder;
  const handleCreateClientsOrderFromOffer = quoteHandlers.createClientsOrderFromOffer;

  const addInvoice = invoiceHandlers.add;
  const handleUpdateInvoice = invoiceHandlers.update;
  const handleDeleteInvoice = invoiceHandlers.delete;

  const addSupplier = supplierHandlers.add;
  const handleUpdateSupplier = supplierHandlers.update;
  const handleDeleteSupplier = supplierHandlers.delete;

  const addSupplierQuote = supplierQuoteHandlers.addSupplierQuote;
  const handleUpdateSupplierQuote = supplierQuoteHandlers.updateSupplierQuote;
  const handleDeleteSupplierQuote = supplierQuoteHandlers.deleteSupplierQuote;
  const handleUpdateSupplierOrder = supplierQuoteHandlers.updateSupplierOrder;
  const handleDeleteSupplierOrder = supplierQuoteHandlers.deleteSupplierOrder;
  const handleCreateSupplierOrderFromQuote = supplierQuoteHandlers.createSupplierOrderFromQuote;

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

  const handleUpdateUser = userHandlers.updateUser;
  const handleUpdateUserRoles = userHandlers.updateUserRoles;

  const handleUpdateGeneralSettings = async (updates: Partial<IGeneralSettings>) => {
    try {
      const updated = await api.generalSettings.update(updates);
      setGeneralSettings({
        ...updated,
        geminiApiKey: updated.geminiApiKey || '',
        aiProvider: updated.aiProvider || 'gemini',
        openrouterApiKey: updated.openrouterApiKey || '',
        geminiModelId: updated.geminiModelId || '',
        openrouterModelId: updated.openrouterModelId || '',
        defaultLocation: updated.defaultLocation || 'remote',
      });
    } catch (err) {
      console.error('Failed to update general settings:', err);
      alert('Failed to update settings');
    }
  };

  const handleUpdateUserSettings = async (updates: Partial<Settings>) => {
    try {
      const updated = await api.settings.update(updates);
      setUserSettings({
        ...userSettings,
        ...updated,
      });
    } catch (err) {
      console.error('Failed to update user settings:', err);
      alert('Failed to update settings');
      throw err;
    }
  };

  const handleUpdateUserPassword = async (currentPassword: string, newPassword: string) => {
    try {
      await api.settings.updatePassword(currentPassword, newPassword);
    } catch (err) {
      console.error('Failed to update password:', err);
      throw err;
    }
  };

  const getDefaultViewForPermissions = (permissions: string[]): View => {
    const allowedView = VALID_VIEWS.find((view) => {
      const permission = VIEW_PERMISSION_MAP[view];
      return permission ? hasPermission(permissions, permission) : false;
    });
    return allowedView || 'timesheets/tracker';
  };

  const handleSaveLdapConfig = async (config: LdapConfig) => {
    try {
      const updated = await api.ldap.updateConfig(config);
      setLdapConfig(updated);
    } catch (err) {
      console.error('Failed to save LDAP config:', err);
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

  const handleTestEmail = async (
    recipientEmail: string,
  ): Promise<{ success: boolean; code: string; params?: Record<string, string> }> => {
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl text-praetor mb-4"></i>
          <p className="text-slate-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (activeView === 'docs/api') {
    return (
      <>
        {currentUser && <SessionTimeoutHandler onLogout={() => handleLogout('inactivity')} />}
        <ApiDocsView />
      </>
    );
  }

  if (activeView === 'docs/frontend') {
    return (
      <>
        {currentUser && <SessionTimeoutHandler onLogout={() => handleLogout('inactivity')} />}
        <FrontendDocsView />
      </>
    );
  }

  if (!currentUser)
    return (
      <Login
        users={users}
        onLogin={handleLogin}
        logoutReason={logoutReason}
        onClearLogoutReason={clearLogoutReason}
      />
    );

  return (
    <>
      <SessionTimeoutHandler onLogout={() => handleLogout('inactivity')} />
      <Layout
        activeView={!isRouteAccessible ? 'timesheets/tracker' : (activeView as View)}
        onViewChange={setActiveView}
        currentUser={currentUser}
        onLogout={handleLogout}
        onSwitchRole={handleSwitchRole}
        roles={roles}
        isNotFound={!isRouteAccessible}
        isAiReportingEnabled={!hasLoadedGeneralSettings || generalSettings.enableAiReporting}
        notifications={notifications}
        unreadNotificationCount={unreadNotificationCount}
        onMarkNotificationAsRead={handleMarkNotificationAsRead}
        onMarkAllNotificationsAsRead={handleMarkAllNotificationsAsRead}
        onDeleteNotification={handleDeleteNotification}
      >
        {!isRouteAccessible ? (
          <NotFound onReturn={() => setActiveView('timesheets/tracker')} />
        ) : (
          <>
            {activeModuleLoadFailures.length > 0 && (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
                <div className="flex items-start gap-3">
                  <i className="fa-solid fa-triangle-exclamation mt-0.5 text-amber-500" />
                  <p className="font-medium">
                    Failed to load: {activeModuleLoadFailures.join(', ')}.
                  </p>
                </div>
              </div>
            )}
            {activeView === 'timesheets/tracker' && (
              <TrackerView
                entries={entries.filter((e) => e.userId === viewingUserId)}
                clients={filteredClients}
                projects={filteredProjects}
                projectTasks={filteredTasks}
                onAddEntry={handleAddEntry}
                onDeleteEntry={handleDeleteEntry}
                onUpdateEntry={handleUpdateEntry}
                startOfWeek={generalSettings.startOfWeek}
                treatSaturdayAsHoliday={generalSettings.treatSaturdayAsHoliday}
                allowWeekendSelection={generalSettings.allowWeekendSelection}
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
              />
            )}
            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['crm/clients']) &&
              activeView === 'crm/clients' && (
                <ClientsView
                  clients={clients}
                  onAddClient={addClient}
                  onUpdateClient={handleUpdateClient}
                  onDeleteClient={handleDeleteClient}
                  onCreateClientProfileOption={handleCreateClientProfileOption}
                  onUpdateClientProfileOption={handleUpdateClientProfileOption}
                  onDeleteClientProfileOption={handleDeleteClientProfileOption}
                  permissions={currentUser.permissions || []}
                />
              )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['catalog/internal-listing'],
            ) &&
              activeView === 'catalog/internal-listing' && (
                <InternalListingView
                  products={products}
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

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['sales/client-quotes']) &&
              activeView === 'sales/client-quotes' && (
                <ClientQuotesView
                  quotes={quotes}
                  clients={clients}
                  products={products}
                  supplierQuotes={supplierQuotes}
                  onAddQuote={addQuote}
                  onUpdateQuote={handleUpdateQuote}
                  onDeleteQuote={handleDeleteQuote}
                  onCreateOffer={handleCreateClientOfferFromQuote}
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
                  onDeleteOffer={handleDeleteClientOffer}
                  onCreateClientsOrder={handleCreateClientsOrderFromOffer}
                  onViewQuote={(quoteId) => {
                    setClientOfferFilterId(null);
                    setClientQuoteFilterId(quoteId);
                    setActiveView('sales/client-quotes');
                  }}
                  currency={generalSettings.currency}
                  quoteFilterId={clientQuoteFilterId}
                  offerFilterId={clientOfferFilterId}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['sales/supplier-quotes']) &&
              activeView === 'sales/supplier-quotes' && (
                <SupplierQuotesView
                  quotes={supplierQuotes}
                  suppliers={suppliers}
                  products={products}
                  onAddQuote={addSupplierQuote}
                  onUpdateQuote={handleUpdateSupplierQuote}
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

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['accounting/clients-orders'],
            ) &&
              activeView === 'accounting/clients-orders' && (
                <ClientsOrdersView
                  orders={clientsOrders}
                  clients={clients}
                  products={products}
                  onUpdateClientsOrder={handleUpdateClientsOrder}
                  onDeleteClientsOrder={handleDeleteClientsOrder}
                  currency={generalSettings.currency}
                  onViewOffer={(offerId) => {
                    setClientQuoteFilterId(null);
                    setClientOfferFilterId(offerId);
                    setActiveView('sales/client-offers');
                  }}
                  offerFilterId={clientOfferFilterId}
                  orderFilterId={clientsOrderFilterId}
                />
              )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['accounting/clients-invoices'],
            ) &&
              activeView === 'accounting/clients-invoices' && (
                <ClientsInvoicesView
                  invoices={invoices}
                  clients={clients}
                  products={products}
                  onAddInvoice={addInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onDeleteInvoice={handleDeleteInvoice}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['accounting/supplier-orders'],
            ) &&
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
                  currency={generalSettings.currency}
                  quoteFilterId={supplierQuoteFilterId}
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

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['crm/suppliers']) &&
              activeView === 'crm/suppliers' && (
                <SuppliersView
                  suppliers={suppliers}
                  supplierOrders={supplierOrders}
                  currency={generalSettings.currency}
                  onAddSupplier={addSupplier}
                  onUpdateSupplier={handleUpdateSupplier}
                  onDeleteSupplier={handleDeleteSupplier}
                  permissions={currentUser.permissions || []}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['hr/internal']) &&
              activeView === 'hr/internal' && (
                <InternalEmployeesView
                  users={users}
                  clients={clients}
                  projects={projects}
                  tasks={projectTasks}
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
                  onAddEmployee={addExternalEmployee}
                  onUpdateEmployee={handleUpdateEmployee}
                  onDeleteEmployee={handleDeleteEmployee}
                  currency={generalSettings.currency}
                  permissions={currentUser.permissions || []}
                />
              )}

            {activeView === 'projects/manage' && (
              <ProjectsView
                projects={projects}
                clients={clients}
                orders={clientsOrders}
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
                onDeleteTask={async (id) => {
                  try {
                    await api.tasks.delete(id);
                    setProjectTasks((prev) => prev.filter((t) => t.id !== id));
                  } catch (err) {
                    console.error('Failed to delete task:', err);
                  }
                }}
                onViewOrder={(orderId) => {
                  setClientsOrderFilterId(orderId);
                  setActiveView('accounting/clients-orders');
                }}
              />
            )}

            {activeView === 'projects/tasks' && (
              <TasksView
                tasks={projectTasks}
                projects={projects}
                clients={clients}
                permissions={currentUser.permissions || []}
                users={availableUsers}
                roles={roles}
                currency={generalSettings.currency}
                onAddTask={addProjectTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={async (id) => {
                  try {
                    await api.tasks.delete(id);
                    setProjectTasks((prev) => prev.filter((t) => t.id !== id));
                  } catch (err) {
                    console.error('Failed to delete task:', err);
                    alert('Failed to delete task');
                  }
                }}
                onViewOrder={(orderId) => {
                  setClientsOrderFilterId(orderId);
                  setActiveView('accounting/clients-orders');
                }}
              />
            )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['administration/user-management'],
            ) &&
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
                  currentUserId={currentUser.id}
                  permissions={currentUser.permissions || []}
                  roles={roles}
                  currency={getCurrencySymbol(generalSettings.currency)}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['hr/work-units']) &&
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

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['administration/general'],
            ) &&
              activeView === 'administration/general' && (
                <GeneralSettings
                  settings={generalSettings}
                  onUpdate={handleUpdateGeneralSettings}
                />
              )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['administration/authentication'],
            ) &&
              activeView === 'administration/authentication' && (
                <AuthSettings config={ldapConfig} onSave={handleSaveLdapConfig} roles={roles} />
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

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/logs']) &&
              activeView === 'administration/logs' && <LogsView />}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['administration/email']) &&
              activeView === 'administration/email' && (
                <EmailSettings
                  config={emailConfig}
                  onSave={handleSaveEmailConfig}
                  onTestEmail={handleTestEmail}
                />
              )}

            {activeView === 'timesheets/recurring' && (
              <RecurringManager
                tasks={projectTasks}
                projects={projects}
                clients={clients}
                onAction={handleRecurringAction}
              />
            )}
            {activeView === 'settings' && (
              <UserSettings
                settings={userSettings}
                onUpdate={handleUpdateUserSettings}
                onUpdatePassword={handleUpdateUserPassword}
              />
            )}
            {activeView === 'reports/ai-reporting' &&
              (!hasLoadedGeneralSettings ? (
                reportsSettingsFailed ? (
                  <div className="flex h-[calc(100vh-180px)] min-h-[560px] items-center justify-center">
                    <div className="text-center">
                      <i className="fa-solid fa-triangle-exclamation text-3xl text-amber-500 mb-3" />
                      <p className="text-slate-700 font-medium">
                        AI reporting settings failed to load.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[calc(100vh-180px)] min-h-[560px] items-center justify-center">
                    <div className="text-center">
                      <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor mb-3" />
                      <p className="text-slate-600 font-medium">Loading...</p>
                    </div>
                  </div>
                )
              ) : (
                <AiReportingView
                  currentUserId={currentUser.id}
                  permissions={currentUser.permissions || []}
                  enableAiReporting={generalSettings.enableAiReporting}
                />
              ))}
          </>
        )}
      </Layout>
    </>
  );
};

export default App;
