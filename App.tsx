import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ClientsInvoicesView from './components/accounting/ClientsInvoicesView';
import ClientsOrdersView from './components/accounting/ClientsOrdersView';
import AuthSettings from './components/administration/AuthSettings';
import EmailSettings from './components/administration/EmailSettings';
import GeneralSettings from './components/administration/GeneralSettings';
import RolesView from './components/administration/RolesView';
import UserManagement from './components/administration/UserManagement';
import ClientsView from './components/CRM/ClientsView';
import SuppliersView from './components/CRM/SuppliersView';
import ExternalListingView from './components/catalog/ExternalListingView';
import InternalListingView from './components/catalog/InternalListingView';
import SpecialBidsView from './components/catalog/SpecialBidsView';
import ApiDocsView from './components/docs/ApiDocsView';
import FrontendDocsView from './components/docs/FrontendDocsView';
import ExpensesView from './components/ExpensesView';
import ExternalEmployeesView from './components/HR/ExternalEmployeesView';
import InternalEmployeesView from './components/HR/InternalEmployeesView';
import Layout from './components/Layout';
import Login from './components/Login';
import NotFound from './components/NotFound';
import PaymentsView from './components/PaymentsView';
import ProjectsView from './components/projects/ProjectsView';
import TasksView from './components/projects/TasksView';
import RecurringManager from './components/RecurringManager';
import ClientQuotesView from './components/Sales/ClientQuotesView';
import SessionTimeoutHandler from './components/SessionTimeoutHandler';
import SupplierQuotesView from './components/SupplierQuotesView';
import Calendar from './components/shared/Calendar';
import CustomSelect from './components/shared/CustomSelect';
import Tooltip from './components/shared/Tooltip';
import DailyView from './components/timesheet/DailyView';
import WeeklyView from './components/timesheet/WeeklyView';
import UserSettings from './components/UserSettings';
import WorkUnitsView from './components/WorkUnitsView';
import { COLORS } from './constants';
import i18n from './i18n';
import api, { getAuthToken, type Settings, setAuthToken } from './services/api';
import type {
  Client,
  ClientsOrder,
  EmailConfig,
  Expense,
  GeneralSettings as IGeneralSettings,
  Invoice,
  LdapConfig,
  Notification,
  Payment,
  Product,
  Project,
  ProjectTask,
  Quote,
  Role,
  SpecialBid,
  Supplier,
  SupplierQuote,
  TimeEntry,
  TimeEntryLocation,
  User,
  View,
  WorkUnit,
} from './types';
import { getLocalDateString } from './utils/date';
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
  if (view.startsWith('finances/')) return 'finances';
  if (view.startsWith('suppliers/')) return 'suppliers';
  if (view.startsWith('administration/')) return 'administration';
  if (view === 'settings') return 'settings';
  return null;
};

const TrackerView: React.FC<{
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAddEntry: (entry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>) => void;
  onDeleteEntry: (id: string) => void;
  insights: string;
  isInsightLoading: boolean;
  onRefreshInsights: () => void;
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
  enableAiInsights: boolean;
  onRecurringAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
  defaultLocation?: TimeEntryLocation;
}> = ({
  entries,
  clients,
  projects,
  projectTasks,
  onAddEntry,
  onDeleteEntry,
  insights,
  isInsightLoading,
  onRefreshInsights,
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
  enableAiInsights,
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

  const handleDeleteClick = (entry: TimeEntry) => {
    const task = projectTasks.find((t) => t.name === entry.task && t.projectId === entry.projectId);
    if (entry.isPlaceholder || task?.isRecurring) {
      // Show modal for recurring entries
      setPendingDeleteEntry(entry);
    } else {
      // Direct delete for normal entries
      onDeleteEntry(entry.id);
    }
  };

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
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1 space-y-6">
            {/* Manager Selection Header */}
            {availableUsers.length > 1 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-sm ${isViewingSelf ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}
                  >
                    {viewingUser?.avatarInitials}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {isViewingSelf ? t('tracker.myTimesheet') : t('tracker.managingUser')}
                    </p>
                    <p className="text-sm font-bold text-slate-800">{viewingUser?.name}</p>
                  </div>
                </div>
                <div className="w-64">
                  <CustomSelect
                    options={userOptions}
                    value={viewingUserId}
                    onChange={(val) => onViewUserChange(val as string)}
                    label={t('tracker.switchUserView')}
                    searchable={true}
                  />
                </div>
              </div>
            )}

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
              enableAiInsights={enableAiInsights}
              defaultLocation={defaultLocation}
            />

            <div className="space-y-4">
              <div className="flex justify-between items-end px-2">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                    {selectedDate
                      ? t('tracker.activityFor', {
                          date: new Date(selectedDate).toLocaleDateString(undefined, {
                            month: 'long',
                            day: 'numeric',
                          }),
                        })
                      : t('entry.recentActivity')}
                  </h3>
                  {selectedDate && (
                    <p className="text-xs text-slate-400 font-medium">{t('tracker.logsForDate')}</p>
                  )}
                </div>
                {selectedDate && (
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
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {!selectedDate && (
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">
                          {t('entry.date')}
                        </th>
                      )}
                      <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">
                        {t('tracker.clientProject')}
                      </th>
                      <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">
                        {t('entry.task')}
                      </th>
                      <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">
                        {t('entry.location')}
                      </th>
                      <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">
                        {t('tracker.notes')}
                      </th>
                      <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter text-right">
                        {t('entry.hours')}
                      </th>
                      <th className="px-6 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEntries.length === 0 ? (
                      <tr>
                        <td colSpan={selectedDate ? 6 : 7} className="px-6 py-20 text-center">
                          <i className="fa-solid fa-calendar-day text-4xl text-slate-100 mb-4 block"></i>
                          <p className="text-slate-400 font-medium text-sm">
                            {t('tracker.noEntries')}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`group hover:bg-slate-50/50 transition-colors ${entry.isPlaceholder ? 'bg-indigo-50/30 italic' : ''}`}
                        >
                          {!selectedDate && (
                            <td className="px-6 py-4 text-xs font-bold text-slate-500 align-top">
                              {entry.date}
                            </td>
                          )}
                          <td className="px-6 py-4 align-top">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-black text-indigo-500 uppercase leading-none mb-1 tracking-wider">
                                {entry.clientName}
                              </span>
                              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{
                                    backgroundColor: projects.find((p) => p.id === entry.projectId)
                                      ?.color,
                                  }}
                                ></span>
                                {entry.projectName}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm align-top">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">{entry.task}</span>
                              {entry.isPlaceholder && (
                                <Tooltip label={t('entry.recurringTask')}>
                                  {() => (
                                    <i className="fa-solid fa-repeat text-[10px] text-indigo-400"></i>
                                  )}
                                </Tooltip>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm align-top">
                            {entry.location ? (
                              <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded">
                                {t(
                                  `entry.locationTypes.${entry.location.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`,
                                )}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm align-top">
                            {entry.notes ? (
                              <div className="text-slate-500 text-xs italic leading-relaxed">
                                {entry.notes}
                              </div>
                            ) : (
                              <span className="text-slate-300 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-900 font-black text-right align-top">
                            {entry.isPlaceholder && entry.duration === 0
                              ? '--'
                              : entry.duration.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 align-top">
                            <button
                              onClick={() => handleDeleteClick(entry)}
                              className="text-slate-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                            >
                              <i className="fa-solid fa-trash-can text-xs"></i>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="lg:w-80 shrink-0 space-y-6">
            <Calendar
              selectedDate={selectedDate}
              onDateSelect={setSelectedDate}
              entries={entries}
              startOfWeek={startOfWeek}
              treatSaturdayAsHoliday={treatSaturdayAsHoliday}
              dailyGoal={dailyGoal}
              allowWeekendSelection={allowWeekendSelection}
            />

            {enableAiInsights && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 hidden lg:block">
                <h3 className="text-indigo-900 font-bold mb-3 flex items-center gap-2 text-sm">
                  <i className="fa-solid fa-lightbulb text-indigo-500"></i>
                  AI Coach
                </h3>
                <div className="text-indigo-700 text-xs leading-relaxed whitespace-pre-line mb-4">
                  {isInsightLoading ? (
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-circle-notch fa-spin"></i>
                      Analyzing patterns...
                    </div>
                  ) : (
                    insights
                  )}
                </div>
                <button
                  onClick={onRefreshInsights}
                  className="w-full bg-white text-indigo-600 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                >
                  Refresh Insights
                </button>
              </div>
            )}
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

  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [logoutReason, setLogoutReason] = useState<'inactivity' | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [specialBids, setSpecialBids] = useState<SpecialBid[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clientsOrders, setClientsOrders] = useState<ClientsOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuotes, setSupplierQuotes] = useState<SupplierQuote[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
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
    enableAiInsights: false,
    geminiApiKey: '',
    aiProvider: 'gemini' as 'gemini' | 'openrouter',
    openrouterApiKey: '',
    geminiModelId: '',
    openrouterModelId: '',
    defaultLocation: 'remote' as TimeEntryLocation,
  });
  const [userSettings, setUserSettings] = useState<Settings>({
    fullName: '',
    email: '',
    language: 'auto',
  });
  const [loadedModules, setLoadedModules] = useState<Set<string>>(new Set());
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
      'administration/work-units',
      'administration/roles',
      'administration/authentication',
      'administration/general',
      'administration/email',
      'crm/clients',
      'crm/suppliers',
      // Sales module
      'sales/client-quotes',
      // Accounting module
      'accounting/clients-orders',
      'accounting/clients-invoices',
      // Catalog module
      'catalog/internal-listing',
      'catalog/external-listing',
      'catalog/special-bids',
      // Finances module
      'finances/payments',
      'finances/expenses',
      'projects/manage',
      'projects/tasks',
      'suppliers/quotes',
      'hr/internal',
      'hr/external',
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
    const hash = rawHash as View;
    // We can't use the memoized VALID_VIEWS here because this runs before the initial render
    // So we define the list once for initialization
    const validViews: View[] = [
      'timesheets/tracker',
      'timesheets/recurring',
      'administration/user-management',
      'administration/work-units',
      'administration/roles',
      'administration/authentication',
      'administration/general',
      'administration/email',
      'crm/clients',
      'crm/suppliers',
      // Sales module
      'sales/client-quotes',
      // Accounting module
      'accounting/clients-orders',
      'accounting/clients-invoices',
      // Catalog module
      'catalog/internal-listing',
      'catalog/external-listing',
      'catalog/special-bids',
      // Finances module
      'finances/payments',
      'finances/expenses',
      'projects/manage',
      'projects/tasks',
      'suppliers/quotes',
      'hr/internal',
      'hr/external',
      'settings',
      'docs/api',
      'docs/frontend',
    ];
    return validViews.includes(hash)
      ? hash
      : rawHash === '' || rawHash === 'login'
        ? 'timesheets/tracker'
        : '404';
  });
  const [quoteFilterId, setQuoteFilterId] = useState<string | null>(null);

  const quoteIdsWithOrders = useMemo(() => {
    const ids = new Set<string>();
    clientsOrders.forEach((order) => {
      if (order.linkedQuoteId) {
        ids.add(order.linkedQuoteId);
      }
    });
    return ids;
  }, [clientsOrders]);

  const quoteOrderStatuses = useMemo(() => {
    const map: Record<string, ClientsOrder['status']> = {};
    clientsOrders.forEach((order) => {
      if (order.linkedQuoteId) {
        map[order.linkedQuoteId] = order.status;
      }
    });
    return map;
  }, [clientsOrders]);

  const isRouteAccessible = useMemo(() => {
    if (activeView === 'docs/api' || activeView === 'docs/frontend') return true;
    if (!currentUser) return false;
    if (activeView === '404') return false;

    const permission = VIEW_PERMISSION_MAP[activeView as View];
    return permission ? hasPermission(currentUser.permissions, permission) : false;
  }, [activeView, currentUser]);
  const [insights, setInsights] = useState<string>('Logging some time to see patterns!');
  const [isInsightLoading, setIsInsightLoading] = useState(false);

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
    if (activeView !== 'sales/client-quotes' && quoteFilterId) {
      React.startTransition(() => setQuoteFilterId(null));
    }
  }, [activeView, quoteFilterId]);

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
      // Redirect old suppliers/manage to new crm/suppliers
      if (rawHash === 'suppliers/manage') {
        window.location.hash = '/crm/suppliers';
        return;
      }
      const hash = rawHash as View;
      const nextView = VALID_VIEWS.includes(hash)
        ? hash
        : rawHash === ''
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

  // Check for existing token on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = getAuthToken();
      if (token) {
        try {
          const user = await api.auth.me();
          setCurrentUser(user);
          setViewingUserId(user.id);

          // Load user's settings and language preference
          try {
            const settings = await api.settings.get();
            setUserSettings(settings);
            if (settings.language) {
              if (settings.language === 'auto') {
                // Clear stored language, let i18n detect from browser
                localStorage.removeItem('i18nextLng');
                const browserLang = navigator.language.split('-')[0];
                const detectedLang = ['en', 'it'].includes(browserLang) ? browserLang : 'en';
                i18n.changeLanguage(detectedLang);
              } else {
                localStorage.setItem('i18nextLng', settings.language);
                i18n.changeLanguage(settings.language);
              }
            }
          } catch {
            // Settings might not exist yet, that's okay
          }
        } catch {
          // Token invalid, clear it
          setAuthToken(null);
        }
      }
      setIsLoading(false);
    };
    checkAuth();
  }, []);

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

    const loadModuleData = async () => {
      try {
        const permissions = currentUser.permissions || [];
        const canViewTimesheets = hasAnyPermission(permissions, [
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
        ]);
        const canViewHr = hasAnyPermission(permissions, [
          buildPermission('hr.internal', 'view'),
          buildPermission('hr.external', 'view'),
        ]);
        const canViewConfiguration = hasAnyPermission(permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management_all', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('administration.work_units', 'view'),
          buildPermission('administration.work_units_all', 'view'),
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
        const canViewSales = hasPermission(
          permissions,
          buildPermission('sales.client_quotes', 'view'),
        );
        const canViewCatalog = hasAnyPermission(permissions, [
          buildPermission('catalog.internal_listing', 'view'),
          buildPermission('catalog.external_listing', 'view'),
          buildPermission('catalog.special_bids', 'view'),
        ]);
        const canViewAccounting = hasAnyPermission(permissions, [
          buildPermission('accounting.clients_orders', 'view'),
          buildPermission('accounting.clients_invoices', 'view'),
        ]);
        const canViewFinances = hasAnyPermission(permissions, [
          buildPermission('finances.payments', 'view'),
          buildPermission('finances.expenses', 'view'),
        ]);
        const canViewProjects = hasAnyPermission(permissions, [
          buildPermission('projects.manage', 'view'),
          buildPermission('projects.tasks', 'view'),
        ]);
        const canViewSuppliersModule = hasPermission(
          permissions,
          buildPermission('suppliers.quotes', 'view'),
        );

        const canListClients = hasAnyPermission(permissions, [
          buildPermission('crm.clients', 'view'),
          buildPermission('crm.clients_all', 'view'),
          buildPermission('timesheets.tracker', 'view'),
          buildPermission('timesheets.recurring', 'view'),
          buildPermission('projects.manage', 'view'),
          buildPermission('projects.tasks', 'view'),
          buildPermission('sales.client_quotes', 'view'),
          buildPermission('accounting.clients_orders', 'view'),
          buildPermission('accounting.clients_invoices', 'view'),
          buildPermission('catalog.special_bids', 'view'),
          buildPermission('catalog.internal_listing', 'view'),
          buildPermission('catalog.external_listing', 'view'),
          buildPermission('finances.payments', 'view'),
          buildPermission('finances.expenses', 'view'),
          buildPermission('suppliers.quotes', 'view'),
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
          buildPermission('administration.work_units', 'view'),
        ]);
        const canListQuotes = hasPermission(
          permissions,
          buildPermission('sales.client_quotes', 'view'),
        );
        const canListProducts = hasAnyPermission(permissions, [
          buildPermission('catalog.internal_listing', 'view'),
          buildPermission('catalog.external_listing', 'view'),
          buildPermission('catalog.special_bids', 'view'),
          buildPermission('suppliers.quotes', 'view'),
        ]);
        const canListSpecialBids = hasPermission(
          permissions,
          buildPermission('catalog.special_bids', 'view'),
        );
        const canListSuppliers = hasAnyPermission(permissions, [
          buildPermission('crm.suppliers', 'view'),
          buildPermission('crm.suppliers_all', 'view'),
          buildPermission('catalog.external_listing', 'view'),
          buildPermission('suppliers.quotes', 'view'),
        ]);
        const canListSupplierQuotes = hasPermission(
          permissions,
          buildPermission('suppliers.quotes', 'view'),
        );
        const canListOrders = hasPermission(
          permissions,
          buildPermission('accounting.clients_orders', 'view'),
        );
        const canListInvoices = hasPermission(
          permissions,
          buildPermission('accounting.clients_invoices', 'view'),
        );
        const canListPayments = hasPermission(
          permissions,
          buildPermission('finances.payments', 'view'),
        );
        const canListExpenses = hasPermission(
          permissions,
          buildPermission('finances.expenses', 'view'),
        );
        const canListWorkUnits = hasAnyPermission(permissions, [
          buildPermission('administration.work_units', 'view'),
          buildPermission('administration.work_units_all', 'view'),
        ]);
        const canViewUserManagement = hasAnyPermission(permissions, [
          buildPermission('administration.user_management', 'view'),
          buildPermission('administration.user_management', 'update'),
          buildPermission('administration.user_management', 'create'),
          buildPermission('administration.user_management_all', 'view'),
        ]);
        const canViewWorkUnits = hasAnyPermission(permissions, [
          buildPermission('administration.work_units', 'view'),
          buildPermission('administration.work_units', 'update'),
          buildPermission('administration.work_units', 'create'),
          buildPermission('administration.work_units_all', 'view'),
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
        const canViewCatalogExternal = hasPermission(
          permissions,
          buildPermission('catalog.external_listing', 'view'),
        );
        const canViewCatalogSpecialBids = hasPermission(
          permissions,
          buildPermission('catalog.special_bids', 'view'),
        );
        const canViewCatalogInternal = hasPermission(
          permissions,
          buildPermission('catalog.internal_listing', 'view'),
        );

        switch (module) {
          case 'timesheets': {
            if (!canViewTimesheets) return;
            const [entriesData, clientsData, projectsData, tasksData, usersData] =
              await Promise.all([
                api.entries.list(),
                canListClients ? api.clients.list() : Promise.resolve([]),
                canListProjects ? api.projects.list() : Promise.resolve([]),
                canListTasks ? api.tasks.list() : Promise.resolve([]),
                canListUsers ? api.users.list() : Promise.resolve([]),
              ]);
            setEntries(entriesData);
            setClients(clientsData);
            setProjects(projectsData);
            setProjectTasks(tasksData);
            setUsers(usersData);
            await loadGeneralSettings();
            break;
          }
          case 'hr': {
            if (!canViewHr) return;
            const [usersData] = await Promise.all([
              canListUsers ? api.users.list() : Promise.resolve([]),
            ]);
            setUsers(usersData);
            await loadGeneralSettings();
            break;
          }
          case 'administration': {
            if (!canViewConfiguration) return;
            const shouldLoadUsers = canViewUserManagement || canViewWorkUnits;
            const shouldLoadAssignments = canViewUserManagement;
            const shouldLoadWorkUnits = canViewWorkUnits;
            const shouldLoadRoles = canViewRoles || canViewAuthentication || canViewUserManagement;

            const [usersData, clientsData, projectsData, tasksData, workUnitsData] =
              await Promise.all([
                shouldLoadUsers && canListUsers ? api.users.list() : Promise.resolve([]),
                shouldLoadAssignments && canListClients ? api.clients.list() : Promise.resolve([]),
                shouldLoadAssignments && canListProjects
                  ? api.projects.list()
                  : Promise.resolve([]),
                shouldLoadAssignments && canListTasks ? api.tasks.list() : Promise.resolve([]),
                shouldLoadWorkUnits && canListWorkUnits
                  ? api.workUnits.list()
                  : Promise.resolve([]),
              ]);

            if (shouldLoadUsers) setUsers(usersData);
            if (shouldLoadAssignments) {
              setClients(clientsData);
              setProjects(projectsData);
              setProjectTasks(tasksData);
            }
            if (shouldLoadWorkUnits) setWorkUnits(workUnitsData);

            await loadGeneralSettings();
            if (shouldLoadRoles) await loadRoles();
            if (canViewAuthentication) await loadLdapConfig();
            if (canViewEmail) await loadEmailConfig();
            break;
          }
          case 'crm': {
            if (!canViewCrm) return;
            const [clientsData, suppliersData] = await Promise.all([
              canViewCrmClients && canListClients ? api.clients.list() : Promise.resolve([]),
              canViewCrmSuppliers && canListSuppliers ? api.suppliers.list() : Promise.resolve([]),
            ]);
            if (canViewCrmClients) setClients(clientsData);
            if (canViewCrmSuppliers) setSuppliers(suppliersData);
            await loadGeneralSettings();
            break;
          }
          case 'sales': {
            if (!canViewSales) return;
            const [quotesData, clientsData, productsData, specialBidsData] = await Promise.all([
              canListQuotes ? api.quotes.list() : Promise.resolve([]),
              canListClients ? api.clients.list() : Promise.resolve([]),
              canListProducts ? api.products.list() : Promise.resolve([]),
              canListSpecialBids ? api.specialBids.list() : Promise.resolve([]),
            ]);
            setQuotes(quotesData);
            setClients(clientsData);
            setProducts(productsData);
            setSpecialBids(specialBidsData);
            await loadGeneralSettings();
            break;
          }
          case 'accounting': {
            if (!canViewAccounting) return;
            const [ordersData, invoicesData, clientsData, productsData, specialBidsData] =
              await Promise.all([
                canListOrders ? api.clientsOrders.list() : Promise.resolve([]),
                canListInvoices ? api.invoices.list() : Promise.resolve([]),
                canListClients ? api.clients.list() : Promise.resolve([]),
                canListProducts ? api.products.list() : Promise.resolve([]),
                canListSpecialBids ? api.specialBids.list() : Promise.resolve([]),
              ]);
            if (canListOrders) setClientsOrders(ordersData);
            if (canListInvoices) setInvoices(invoicesData);
            if (canListClients) setClients(clientsData);
            if (canListProducts) setProducts(productsData);
            if (canListSpecialBids) setSpecialBids(specialBidsData);
            await loadGeneralSettings();
            break;
          }
          case 'catalog': {
            if (!canViewCatalog) return;
            const [productsData, specialBidsData, clientsData, suppliersData] = await Promise.all([
              canListProducts ? api.products.list() : Promise.resolve([]),
              canListSpecialBids ? api.specialBids.list() : Promise.resolve([]),
              canViewCatalogSpecialBids && canListClients
                ? api.clients.list()
                : Promise.resolve([]),
              canViewCatalogExternal && canListSuppliers
                ? api.suppliers.list()
                : Promise.resolve([]),
            ]);
            if (
              canListProducts &&
              (canViewCatalogInternal || canViewCatalogExternal || canViewCatalogSpecialBids)
            )
              setProducts(productsData);
            if (canListSpecialBids && canViewCatalogSpecialBids) setSpecialBids(specialBidsData);
            if (canViewCatalogSpecialBids && canListClients) setClients(clientsData);
            if (canViewCatalogExternal && canListSuppliers) setSuppliers(suppliersData);
            await loadGeneralSettings();
            break;
          }
          case 'finances': {
            if (!canViewFinances) return;
            const [paymentsData, expensesData, clientsData] = await Promise.all([
              canListPayments ? api.payments.list() : Promise.resolve([]),
              canListExpenses ? api.expenses.list() : Promise.resolve([]),
              canListClients ? api.clients.list() : Promise.resolve([]),
            ]);
            if (canListPayments) setPayments(paymentsData);
            if (canListExpenses) setExpenses(expensesData);
            if (canListClients) setClients(clientsData);
            await loadGeneralSettings();
            break;
          }
          case 'projects': {
            if (!canViewProjects) return;
            const [projectsData, tasksData, clientsData, usersData, workUnitsData] =
              await Promise.all([
                canListProjects ? api.projects.list() : Promise.resolve([]),
                canListTasks ? api.tasks.list() : Promise.resolve([]),
                canListClients ? api.clients.list() : Promise.resolve([]),
                canListUsers ? api.users.list() : Promise.resolve([]),
                canListWorkUnits ? api.workUnits.list() : Promise.resolve([]),
              ]);
            if (canListProjects) setProjects(projectsData);
            if (canListTasks) setProjectTasks(tasksData);
            if (canListClients) setClients(clientsData);
            if (canListUsers) setUsers(usersData);
            if (canListWorkUnits) setWorkUnits(workUnitsData);
            break;
          }
          case 'suppliers': {
            if (!canViewSuppliersModule) return;
            const [suppliersData, supplierQuotesData, productsData] = await Promise.all([
              canListSuppliers ? api.suppliers.list() : Promise.resolve([]),
              canListSupplierQuotes ? api.supplierQuotes.list() : Promise.resolve([]),
              canListProducts ? api.products.list() : Promise.resolve([]),
            ]);
            if (canListSuppliers) setSuppliers(suppliersData);
            if (canListSupplierQuotes) setSupplierQuotes(supplierQuotesData);
            if (canListProducts) setProducts(productsData);
            await loadGeneralSettings();
            break;
          }
        }

        setLoadedModules((prev) => {
          const next = new Set(prev);
          next.add(module);
          return next;
        });
      } catch (err) {
        console.error('Failed to load module data:', err);
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

      const startDate = task.recurrenceStart ? new Date(task.recurrenceStart) : new Date();
      // Use recurrence end date if specified, otherwise use default 14-day limit
      const taskEndDate = task.recurrenceEnd ? new Date(task.recurrenceEnd) : null;
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

  // ... (handlers)

  const handleAddEntry = async (
    newEntry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>,
  ) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const entry = await api.entries.create({
        ...newEntry,
        userId: targetUserId,
        hourlyCost: currentUser?.costPerHour || 0,
      } as TimeEntry);
      setEntries([entry, ...entries]);
    } catch (err) {
      console.error('Failed to add entry:', err);
      alert('Failed to add time entry');
    }
  };

  const handleAddBulkEntries = async (
    newEntries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[],
  ) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const createdEntries = await Promise.all(
        newEntries.map((entry) =>
          api.entries.create({
            ...entry,
            userId: targetUserId,
            hourlyCost: currentUser?.costPerHour || 0,
          } as TimeEntry),
        ),
      );
      setEntries((prev) => [...createdEntries, ...prev].sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Failed to add bulk entries:', err);
      alert('Failed to add some time entries');
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await api.entries.delete(id);
      setEntries(entries.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  const handleUpdateEntry = async (id: string, updates: Partial<TimeEntry>) => {
    try {
      const updated = await api.entries.update(id, updates);
      setEntries(entries.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error('Failed to update entry:', err);
    }
  };

  const handleUpdateTask = async (id: string, updates: Partial<ProjectTask>) => {
    try {
      const updated = await api.tasks.update(id, updates);
      setProjectTasks(projectTasks.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleMakeRecurring = async (
    taskId: string,
    pattern: 'daily' | 'weekly' | 'monthly' | string,
    startDate?: string,
    endDate?: string,
    duration?: number,
  ) => {
    try {
      const updated = await api.tasks.update(taskId, {
        isRecurring: true,
        recurrencePattern: pattern,
        recurrenceStart: startDate || getLocalDateString(),

        recurrenceEnd: endDate,
        recurrenceDuration: duration,
      });
      setProjectTasks(projectTasks.map((t) => (t.id === taskId ? updated : t)));
      setTimeout(generateRecurringEntries, 100);
    } catch (err) {
      console.error('Failed to make task recurring:', err);
    }
  };

  const handleRecurringAction = async (
    taskId: string,
    action: 'stop' | 'delete_future' | 'delete_all',
  ) => {
    const task = projectTasks.find((t) => t.id === taskId);
    if (!task) return;

    try {
      await api.tasks.update(taskId, {
        isRecurring: false,
        recurrencePattern: undefined,
        recurrenceStart: undefined,
        recurrenceEnd: undefined,
      });
      setProjectTasks(
        projectTasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                isRecurring: false,
                recurrencePattern: undefined,
                recurrenceStart: undefined,
                recurrenceEnd: undefined,
              }
            : t,
        ),
      );

      if (action === 'stop') {
        await api.entries.bulkDelete(task.projectId, task.name, { placeholderOnly: true });
        setEntries((prev) =>
          prev.filter(
            (e) => !(e.isPlaceholder && e.projectId === task.projectId && e.task === task.name),
          ),
        );
      } else if (action === 'delete_future') {
        await api.entries.bulkDelete(task.projectId, task.name, { futureOnly: true });
        const today = getLocalDateString();

        setEntries((prev) =>
          prev.filter(
            (e) => !(e.projectId === task.projectId && e.task === task.name && e.date >= today),
          ),
        );
      } else if (action === 'delete_all') {
        await api.entries.bulkDelete(task.projectId, task.name);
        setEntries((prev) =>
          prev.filter((e) => !(e.projectId === task.projectId && e.task === task.name)),
        );
      }
    } catch (err) {
      console.error('Failed to handle recurring action:', err);
    }
  };

  const addClient = async (clientData: Partial<Client>) => {
    try {
      const client = await api.clients.create(clientData);
      setClients([...clients, client]);
    } catch (err) {
      console.error('Failed to add client:', err);
      throw err;
    }
  };

  const handleUpdateClient = async (id: string, updates: Partial<Client>) => {
    try {
      const updated = await api.clients.update(id, updates);
      setClients(clients.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      console.error('Failed to update client:', err);
      throw err;
    }
  };

  const handleDeleteClient = async (id: string) => {
    try {
      await api.clients.delete(id);
      setClients(clients.filter((c) => c.id !== id));
      setProjects(projects.filter((p) => p.clientId !== id));
      // Tasks are also deleted by cascade in DB, so filter them too
      const projectIdsForClient = projects.filter((p) => p.clientId === id).map((p) => p.id);
      setProjectTasks(projectTasks.filter((t) => !projectIdsForClient.includes(t.projectId)));
    } catch (err) {
      console.error('Failed to delete client:', err);
      alert('Failed to delete client');
    }
  };

  const addProduct = async (productData: Partial<Product>) => {
    try {
      const product = await api.products.create(productData);
      setProducts([...products, product]);
    } catch (err) {
      console.error('Failed to add product:', err);
      throw err;
    }
  };

  const addSpecialBid = async (bidData: Partial<SpecialBid>) => {
    try {
      const bid = await api.specialBids.create(bidData);
      setSpecialBids([...specialBids, bid]);
    } catch (err) {
      console.error('Failed to add special bid:', err);
      alert((err as Error).message || 'Failed to add special bid');
    }
  };

  const handleUpdateSpecialBid = async (id: string, updates: Partial<SpecialBid>) => {
    try {
      const updated = await api.specialBids.update(id, updates);
      setSpecialBids(specialBids.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      console.error('Failed to update special bid:', err);
      alert((err as Error).message || 'Failed to update special bid');
    }
  };

  const handleDeleteSpecialBid = async (id: string) => {
    try {
      await api.specialBids.delete(id);
      setSpecialBids(specialBids.filter((b) => b.id !== id));
    } catch (err) {
      console.error('Failed to delete special bid:', err);
      alert((err as Error).message || 'Failed to delete special bid');
    }
  };

  const handleUpdateProduct = async (id: string, updates: Partial<Product>) => {
    try {
      const updated = await api.products.update(id, updates);
      setProducts(products.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      console.error('Failed to update product:', err);
      throw err;
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await api.products.delete(id);
      setProducts(products.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete product:', err);
    }
  };

  const addQuote = async (quoteData: Partial<Quote>) => {
    try {
      const quote = await api.quotes.create(quoteData);
      setQuotes((prev) => [quote, ...prev]);
    } catch (err) {
      console.error('Failed to add quote:', err);
    }
  };

  const handleUpdateQuote = async (id: string, updates: Partial<Quote>) => {
    try {
      const currentQuote = quotes.find((quote) => quote.id === id);
      const isRestore = Boolean(
        updates.status === 'draft' &&
          updates.isExpired === false &&
          currentQuote &&
          (currentQuote.status !== 'draft' || currentQuote.isExpired),
      );
      if (isRestore) {
        // Sales functionality removed - linked sales cleanup handled by backend
      }

      const updatesWithRestore = isRestore
        ? { ...updates, expirationDate: getLocalDateString() }
        : updates;

      const updated = await api.quotes.update(id, updatesWithRestore);
      setQuotes((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (err) {
      console.error('Failed to update quote:', err);
    }
  };

  const handleDeleteQuote = async (id: string) => {
    try {
      await api.quotes.delete(id);
      setQuotes(quotes.filter((q) => q.id !== id));
    } catch (err) {
      console.error('Failed to delete quote:', err);
    }
  };

  const addClientsOrder = async (orderData: Partial<ClientsOrder>) => {
    try {
      const order = await api.clientsOrders.create(orderData);
      setClientsOrders([...clientsOrders, order]);
    } catch (err) {
      console.error('Failed to add order:', err);
    }
  };

  const handleUpdateClientsOrder = async (id: string, updates: Partial<ClientsOrder>) => {
    try {
      const updated = await api.clientsOrders.update(id, updates);
      setClientsOrders(clientsOrders.map((o) => (o.id === id ? updated : o)));

      // When an order is confirmed, projects are auto-created on the backend
      // Refresh the projects list to reflect the new projects
      if (updates.status === 'confirmed') {
        const projectsData = await api.projects.list();
        setProjects(projectsData);
      }
    } catch (err) {
      console.error('Failed to update order:', err);
    }
  };

  const handleDeleteClientsOrder = async (id: string) => {
    try {
      await api.clientsOrders.delete(id);
      setClientsOrders(clientsOrders.filter((o) => o.id !== id));
    } catch (err) {
      console.error('Failed to delete order:', err);
    }
  };

  const handleCreateClientsOrderFromQuote = async (quote: Quote) => {
    try {
      const orderData: Partial<ClientsOrder> = {
        clientId: quote.clientId,
        clientName: quote.clientName,
        status: 'draft',
        linkedQuoteId: quote.id,
        paymentTerms: quote.paymentTerms,
        items: quote.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          specialBidId: item.specialBidId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          productCost: item.productCost,
          productTaxRate: item.productTaxRate,
          productMolPercentage: item.productMolPercentage,
          specialBidUnitPrice: item.specialBidUnitPrice,
          specialBidMolPercentage: item.specialBidMolPercentage,
          discount: item.discount,
          note: item.note,
          id: 'temp-' + Math.random().toString(36).substr(2, 9),
          orderId: '',
        })),
        discount: quote.discount,
        notes: quote.notes,
      };

      const order = await api.clientsOrders.create(orderData);
      setClientsOrders([...clientsOrders, order]);
      setActiveView('accounting/clients-orders');
    } catch (err) {
      console.error('Failed to create order from quote:', err);
      alert('Failed to create order from quote');
    }
  };

  // Finances Handlers
  const addInvoice = async (invoiceData: Partial<Invoice>) => {
    try {
      const invoice = await api.invoices.create(invoiceData);
      setInvoices([...invoices, invoice]);
    } catch (err) {
      console.error('Failed to add invoice:', err);
    }
  };

  const handleUpdateInvoice = async (id: string, updates: Partial<Invoice>) => {
    try {
      const updated = await api.invoices.update(id, updates);
      setInvoices(invoices.map((i) => (i.id === id ? updated : i)));
    } catch (err) {
      console.error('Failed to update invoice:', err);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      await api.invoices.delete(id);
      setInvoices(invoices.filter((i) => i.id !== id));
    } catch (err) {
      console.error('Failed to delete invoice:', err);
    }
  };

  const addPayment = async (paymentData: Partial<Payment>) => {
    try {
      const payment = await api.payments.create(paymentData);
      setPayments([...payments, payment]);

      // Update linked invoice if necessary (locally) - API handles backend logic
      if (payment.invoiceId) {
        const invoice = await api.invoices
          .list()
          .then((list) => list.find((i) => i.id === payment.invoiceId));
        if (invoice) {
          setInvoices((prev) => prev.map((p) => (p.id === invoice.id ? invoice : p)));
        }
      }
    } catch (err) {
      console.error('Failed to add payment:', err);
    }
  };

  const handleUpdatePayment = async (id: string, updates: Partial<Payment>) => {
    try {
      const updated = await api.payments.update(id, updates);
      setPayments(payments.map((p) => (p.id === id ? updated : p)));

      // Refresh invoices as balance might change
      const invoicesList = await api.invoices.list();
      setInvoices(invoicesList);
    } catch (err) {
      console.error('Failed to update payment:', err);
    }
  };

  const handleDeletePayment = async (id: string) => {
    try {
      await api.payments.delete(id);
      setPayments(payments.filter((p) => p.id !== id));

      // Refresh invoices as balance might change
      const invoicesList = await api.invoices.list();
      setInvoices(invoicesList);
    } catch (err) {
      console.error('Failed to delete payment:', err);
    }
  };

  const addExpense = async (expenseData: Partial<Expense>) => {
    try {
      const expense = await api.expenses.create(expenseData);
      setExpenses([...expenses, expense]);
    } catch (err) {
      console.error('Failed to add expense:', err);
    }
  };

  const handleUpdateExpense = async (id: string, updates: Partial<Expense>) => {
    try {
      const updated = await api.expenses.update(id, updates);
      setExpenses(expenses.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error('Failed to update expense:', err);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await api.expenses.delete(id);
      setExpenses(expenses.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to delete expense:', err);
    }
  };

  const addSupplier = async (supplierData: Partial<Supplier>) => {
    try {
      const supplier = await api.suppliers.create(supplierData);
      setSuppliers([...suppliers, supplier]);
    } catch (err) {
      console.error('Failed to add supplier:', err);
    }
  };

  const handleUpdateSupplier = async (id: string, updates: Partial<Supplier>) => {
    try {
      const updated = await api.suppliers.update(id, updates);
      setSuppliers(suppliers.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      console.error('Failed to update supplier:', err);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    try {
      await api.suppliers.delete(id);
      setSuppliers(suppliers.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier:', err);
    }
  };

  const addSupplierQuote = async (quoteData: Partial<SupplierQuote>) => {
    try {
      const quote = await api.supplierQuotes.create(quoteData);
      setSupplierQuotes([...supplierQuotes, quote]);
    } catch (err) {
      console.error('Failed to add supplier quote:', err);
    }
  };

  const handleUpdateSupplierQuote = async (id: string, updates: Partial<SupplierQuote>) => {
    try {
      const updated = await api.supplierQuotes.update(id, updates);
      setSupplierQuotes(supplierQuotes.map((q) => (q.id === id ? updated : q)));
    } catch (err) {
      console.error('Failed to update supplier quote:', err);
    }
  };

  const handleDeleteSupplierQuote = async (id: string) => {
    try {
      await api.supplierQuotes.delete(id);
      setSupplierQuotes(supplierQuotes.filter((q) => q.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier quote:', err);
    }
  };

  // Employee handlers for HR module
  const addInternalEmployee = async (
    name: string,
    costPerHour?: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const employee = await api.employees.create({
        name,
        employeeType: 'internal',
        costPerHour,
      });
      setUsers([...users, employee]);
      return { success: true };
    } catch (err) {
      console.error('Failed to add internal employee:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create employee',
      };
    }
  };

  const addExternalEmployee = async (
    name: string,
    costPerHour?: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const employee = await api.employees.create({
        name,
        employeeType: 'external',
        costPerHour,
      });
      setUsers([...users, employee]);
      return { success: true };
    } catch (err) {
      console.error('Failed to add external employee:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create employee',
      };
    }
  };

  const handleUpdateEmployee = async (id: string, updates: Partial<User>) => {
    try {
      const updated = await api.employees.update(id, updates);
      setUsers(users.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      console.error('Failed to update employee:', err);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      await api.employees.delete(id);
      setUsers(users.filter((u) => u.id !== id));
    } catch (err) {
      console.error('Failed to delete employee:', err);
    }
  };

  const addProject = async (name: string, clientId: string, description?: string) => {
    try {
      const usedColors = projects.map((p) => p.color);
      const availableColors = COLORS.filter((c) => !usedColors.includes(c));
      const color =
        availableColors.length > 0
          ? availableColors[Math.floor(Math.random() * availableColors.length)]
          : COLORS[Math.floor(Math.random() * COLORS.length)];

      const project = await api.projects.create(name, clientId, description, color);
      setProjects([...projects, project]);
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  const addProjectTask = async (
    name: string,
    projectId: string,
    recurringConfig?: { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' },
    description?: string,
  ) => {
    try {
      const task = await api.tasks.create(
        name,
        projectId,
        description,
        recurringConfig?.isRecurring,
        recurringConfig?.pattern,
      );
      setProjectTasks([...projectTasks, task]);
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const handleUpdateProject = async (id: string, updates: Partial<Project>) => {
    try {
      const updated = await api.projects.update(id, updates);
      setProjects(projects.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      console.error('Failed to update project:', err);
      alert('Failed to update project');
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await api.projects.delete(id);
      setProjects(projects.filter((p) => p.id !== id));
      setProjectTasks(projectTasks.filter((t) => t.projectId !== id));
      setEntries(entries.filter((e) => e.projectId !== id));
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('Failed to delete project');
    }
  };

  const handleUpdateUser = async (id: string, updates: Partial<User>) => {
    try {
      const updated = await api.users.update(id, updates);
      setUsers(users.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      console.error('Failed to update user:', err);
      alert('Failed to update user: ' + (err as Error).message);
    }
  };

  const handleUpdateUserRoles = async (id: string, roleIds: string[], primaryRoleId: string) => {
    try {
      const updated = await api.users.updateRoles(id, roleIds, primaryRoleId);
      setUsers(users.map((u) => (u.id === id ? { ...u, role: updated.primaryRoleId } : u)));
    } catch (err) {
      console.error('Failed to update user roles:', err);
      alert('Failed to update user roles: ' + (err as Error).message);
      throw err;
    }
  };

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

  const generateInsights = async () => {
    if (entries.length < 3) return;
    setIsInsightLoading(true);
    const userEntries = entries.filter((e) => e.userId === viewingUserId);
    try {
      const { text } = await api.ai.getInsights(userEntries.slice(0, 10));
      setInsights(text);
    } catch (err) {
      console.error('Failed to generate insights:', err);
      setInsights('Keep up the great work! Consistent tracking is the first step to optimization.');
    } finally {
      setIsInsightLoading(false);
    }
  };

  const getDefaultViewForPermissions = (permissions: string[]): View => {
    const allowedView = VALID_VIEWS.find((view) => {
      const permission = VIEW_PERMISSION_MAP[view];
      return permission ? hasPermission(permissions, permission) : false;
    });
    return allowedView || 'timesheets/tracker';
  };

  const handleLogin = async (user: User, token?: string) => {
    if (token) {
      setAuthToken(token);
    }
    setLoadedModules(new Set());
    setHasLoadedGeneralSettings(false);
    setHasLoadedLdapConfig(false);
    setHasLoadedEmailConfig(false);
    setHasLoadedRoles(false);
    setRoles([]);
    setCurrentUser(user);
    setViewingUserId(user.id);

    // Load user's settings
    try {
      const settings = await api.settings.get();
      setUserSettings(settings);
      if (settings.language) {
        if (settings.language === 'auto') {
          localStorage.removeItem('i18nextLng');
          const browserLang = navigator.language.split('-')[0];
          const detectedLang = ['en', 'it'].includes(browserLang) ? browserLang : 'en';
          i18n.changeLanguage(detectedLang);
        } else {
          localStorage.setItem('i18nextLng', settings.language);
          i18n.changeLanguage(settings.language);
        }
      }
    } catch {
      // Settings might not exist yet, that's okay
    }

    const defaultView = getDefaultViewForPermissions(user.permissions || []);
    const activePermission =
      activeView !== '404' ? VIEW_PERMISSION_MAP[activeView as View] : undefined;
    const canAccessActive = activePermission
      ? hasPermission(user.permissions || [], activePermission)
      : false;
    if (activeView === '404' || !canAccessActive) {
      setActiveView(defaultView);
    }
  };

  const handleLogout = (reason?: 'inactivity') => {
    setAuthToken(null);
    setCurrentUser(null);
    setViewingUserId('');
    setLoadedModules(new Set());
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
    setSpecialBids([]);
    setQuotes([]);
    setClientsOrders([]);
    setInvoices([]);
    setPayments([]);
    setExpenses([]);
    setSuppliers([]);
    setSupplierQuotes([]);
    setEntries([]);
    setWorkUnits([]);
    setLogoutReason(reason || null);
  };

  const handleSwitchRole = async (roleId: string) => {
    try {
      // Clear potentially-privileged data to avoid stale UI after dropping permissions.
      setLoadedModules(new Set());
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
      setSpecialBids([]);
      setQuotes([]);
      setClientsOrders([]);
      setInvoices([]);
      setPayments([]);
      setExpenses([]);
      setSuppliers([]);
      setSupplierQuotes([]);
      setEntries([]);
      setWorkUnits([]);

      const response = await api.auth.switchRole(roleId);
      await handleLogin(response.user, response.token);
    } catch (err) {
      console.error('Failed to switch role:', err);
      alert('Failed to switch role: ' + (err as Error).message);
    }
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

  const handleAddUser = async (name: string, username: string, password: string, role: string) => {
    try {
      const user = await api.users.create(name, username, password, role);
      setUsers([...users, user]);
      return { success: true };
    } catch (err) {
      console.error('Failed to add user:', err);
      return { success: false, error: (err as Error).message };
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      if (viewingUserId === id) {
        setViewingUserId(currentUser?.id || '');
      }
      await api.users.delete(id);
      setUsers(users.filter((u) => u.id !== id));
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const addWorkUnit = async (data: Partial<WorkUnit>) => {
    try {
      const unit = await api.workUnits.create(data);
      setWorkUnits([...workUnits, unit]);
    } catch (err) {
      console.error('Failed to add work unit:', err);
      throw err;
    }
  };

  const updateWorkUnit = async (id: string, updates: Partial<WorkUnit>) => {
    try {
      const updated = await api.workUnits.update(id, updates);
      setWorkUnits(workUnits.map((w) => (w.id === id ? updated : w)));
    } catch (err) {
      console.error('Failed to update work unit:', err);
      throw err;
    }
  };

  const deleteWorkUnit = async (id: string) => {
    try {
      await api.workUnits.delete(id);
      setWorkUnits(workUnits.filter((w) => w.id !== id));
    } catch (err) {
      console.error('Failed to delete work unit:', err);
      throw err;
    }
  };

  const fetchWorkUnits = async () => {
    try {
      const wu = await api.workUnits.list();
      setWorkUnits(wu);
    } catch (err) {
      console.error('Failed to refresh work units', err);
    }
  };

  const handleCreateRole = async (name: string, permissions: string[]) => {
    try {
      const role = await api.roles.create(name, permissions);
      setRoles([...roles, role]);
    } catch (err) {
      console.error('Failed to create role', err);
      throw err;
    }
  };

  const handleRenameRole = async (id: string, name: string) => {
    try {
      const updated = await api.roles.rename(id, name);
      setRoles(roles.map((role) => (role.id === id ? updated : role)));
    } catch (err) {
      console.error('Failed to rename role', err);
      throw err;
    }
  };

  const handleUpdateRolePermissions = async (id: string, permissions: string[]) => {
    try {
      const updated = await api.roles.updatePermissions(id, permissions);
      setRoles(roles.map((role) => (role.id === id ? updated : role)));
    } catch (err) {
      console.error('Failed to update role permissions', err);
      throw err;
    }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      await api.roles.delete(id);
      setRoles(roles.filter((role) => role.id !== id));
    } catch (err) {
      console.error('Failed to delete role', err);
      throw err;
    }
  };

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
        onClearLogoutReason={() => setLogoutReason(null)}
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
            {activeView === 'timesheets/tracker' && (
              <TrackerView
                entries={entries.filter((e) => e.userId === viewingUserId)}
                clients={filteredClients}
                projects={filteredProjects}
                projectTasks={filteredTasks}
                onAddEntry={handleAddEntry}
                onDeleteEntry={handleDeleteEntry}
                onUpdateEntry={handleUpdateEntry}
                insights={insights}
                isInsightLoading={isInsightLoading}
                onRefreshInsights={generateInsights}
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
                enableAiInsights={generalSettings.enableAiInsights}
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
                  permissions={currentUser.permissions || []}
                />
              )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['catalog/internal-listing'],
            ) &&
              activeView === 'catalog/internal-listing' && (
                <InternalListingView
                  products={products.filter((product) => !product.supplierId)}
                  onAddProduct={addProduct}
                  onUpdateProduct={handleUpdateProduct}
                  onDeleteProduct={handleDeleteProduct}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['catalog/external-listing'],
            ) &&
              activeView === 'catalog/external-listing' && (
                <ExternalListingView
                  products={products.filter((product) => product.supplierId)}
                  suppliers={suppliers}
                  onAddProduct={addProduct}
                  onUpdateProduct={handleUpdateProduct}
                  onDeleteProduct={handleDeleteProduct}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['catalog/special-bids']) &&
              activeView === 'catalog/special-bids' && (
                <SpecialBidsView
                  bids={specialBids}
                  clients={clients}
                  products={products}
                  onAddBid={addSpecialBid}
                  onUpdateBid={handleUpdateSpecialBid}
                  onDeleteBid={handleDeleteSpecialBid}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['sales/client-quotes']) &&
              activeView === 'sales/client-quotes' && (
                <ClientQuotesView
                  quotes={quotes}
                  clients={clients}
                  products={products}
                  specialBids={specialBids}
                  onAddQuote={addQuote}
                  onUpdateQuote={handleUpdateQuote}
                  onDeleteQuote={handleDeleteQuote}
                  onCreateClientsOrder={handleCreateClientsOrderFromQuote}
                  quoteFilterId={quoteFilterId}
                  quoteIdsWithOrders={quoteIdsWithOrders}
                  quoteOrderStatuses={quoteOrderStatuses}
                  currency={generalSettings.currency}
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
                  specialBids={specialBids}
                  onAddClientsOrder={addClientsOrder}
                  onUpdateClientsOrder={handleUpdateClientsOrder}
                  onDeleteClientsOrder={handleDeleteClientsOrder}
                  currency={generalSettings.currency}
                  onViewQuote={(quoteId) => {
                    setQuoteFilterId(quoteId);
                    setActiveView('sales/client-quotes');
                  }}
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
                  clientsOrders={clientsOrders}
                  onAddInvoice={addInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onDeleteInvoice={handleDeleteInvoice}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['finances/payments']) &&
              activeView === 'finances/payments' && (
                <PaymentsView
                  payments={payments}
                  clients={clients}
                  invoices={invoices}
                  onAddPayment={addPayment}
                  onUpdatePayment={handleUpdatePayment}
                  onDeletePayment={handleDeletePayment}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['finances/expenses']) &&
              activeView === 'finances/expenses' && (
                <ExpensesView
                  expenses={expenses}
                  onAddExpense={addExpense}
                  onUpdateExpense={handleUpdateExpense}
                  onDeleteExpense={handleDeleteExpense}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['crm/suppliers']) &&
              activeView === 'crm/suppliers' && (
                <SuppliersView
                  suppliers={suppliers}
                  onAddSupplier={addSupplier}
                  onUpdateSupplier={handleUpdateSupplier}
                  onDeleteSupplier={handleDeleteSupplier}
                  permissions={currentUser.permissions || []}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['suppliers/quotes']) &&
              activeView === 'suppliers/quotes' && (
                <SupplierQuotesView
                  quotes={supplierQuotes}
                  suppliers={suppliers}
                  products={products}
                  onAddQuote={addSupplierQuote}
                  onUpdateQuote={handleUpdateSupplierQuote}
                  onDeleteQuote={handleDeleteSupplierQuote}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['hr/internal']) &&
              activeView === 'hr/internal' && (
                <InternalEmployeesView
                  users={users}
                  onAddEmployee={addInternalEmployee}
                  onUpdateEmployee={handleUpdateEmployee}
                  onDeleteEmployee={handleDeleteEmployee}
                  currency={generalSettings.currency}
                />
              )}

            {hasPermission(currentUser.permissions, VIEW_PERMISSION_MAP['hr/external']) &&
              activeView === 'hr/external' && (
                <ExternalEmployeesView
                  users={users}
                  onAddEmployee={addExternalEmployee}
                  onUpdateEmployee={handleUpdateEmployee}
                  onDeleteEmployee={handleDeleteEmployee}
                  currency={generalSettings.currency}
                />
              )}

            {activeView === 'projects/manage' && (
              <ProjectsView
                projects={projects}
                clients={clients}
                permissions={currentUser.permissions || []}
                onAddProject={addProject}
                onUpdateProject={handleUpdateProject}
                onDeleteProject={handleDeleteProject}
              />
            )}

            {activeView === 'projects/tasks' && (
              <TasksView
                tasks={projectTasks}
                projects={projects}
                clients={clients}
                permissions={currentUser.permissions || []}
                users={availableUsers}
                onAddTask={addProjectTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={async (id) => {
                  try {
                    await api.tasks.delete(id);
                    setProjectTasks(projectTasks.filter((t) => t.id !== id));
                  } catch (err) {
                    console.error('Failed to delete task:', err);
                    alert('Failed to delete task');
                  }
                }}
              />
            )}

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['administration/user-management'],
            ) &&
              activeView === 'administration/user-management' && (
                <UserManagement
                  users={users}
                  clients={clients}
                  projects={projects}
                  tasks={projectTasks}
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

            {hasPermission(
              currentUser.permissions,
              VIEW_PERMISSION_MAP['administration/work-units'],
            ) &&
              activeView === 'administration/work-units' && (
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
          </>
        )}
      </Layout>
    </>
  );
};

export default App;
