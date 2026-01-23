
import React, { useState, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getTheme, applyTheme } from './utils/theme';
import { Client, Project, ProjectTask, TimeEntry, View, User, UserRole, LdapConfig, GeneralSettings as IGeneralSettings, Product, Quote, Sale, WorkUnit, Invoice, Payment, Expense, Supplier, SupplierQuote, SpecialBid } from './types';
import { COLORS } from './constants';
import i18n from './i18n';
import Layout from './components/Layout';
import TimeEntryForm from './components/TimeEntryForm';
import Reports from './components/Reports';
import Calendar from './components/Calendar';
import Settings from './components/Settings';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import RecurringManager from './components/RecurringManager';
import ClientsView from './components/ClientsView';
import ProjectsView from './components/ProjectsView';
import TasksView from './components/TasksView';
import TasksReadOnly from './components/TasksReadOnly';
import ProjectsReadOnly from './components/ProjectsReadOnly';
import AdminAuthentication from './components/AdminAuthentication';
import GeneralSettings from './components/GeneralSettings';
import CustomSelect from './components/CustomSelect';
import WeeklyView from './components/WeeklyView';
import { getInsights } from './services/geminiService';
import { isItalianHoliday } from './utils/holidays';
import api, { setAuthToken, getAuthToken } from './services/api';
import NotFound from './components/NotFound';
import ProductsView from './components/ProductsView';
import QuotesView from './components/QuotesView';
import SalesView from './components/SalesView';
import WorkUnitsView from './components/WorkUnitsView';
import InvoicesView from './components/InvoicesView';
import PaymentsView from './components/PaymentsView';
import ExpensesView from './components/ExpensesView';
import FinancialReportsView from './components/FinancialReportsView';
import SessionTimeoutHandler from './components/SessionTimeoutHandler';
import SuppliersView from './components/SuppliersView';
import SupplierQuotesView from './components/SupplierQuotesView';
import SpecialBidsView from './components/SpecialBidsView';

const getModuleFromView = (view: View | '404'): string | null => {
  if (view === '404') return null;
  if (view.startsWith('timesheets/')) return 'timesheets';
  if (view.startsWith('crm/')) return 'crm';
  if (view.startsWith('hr/')) return 'hr';
  if (view.startsWith('projects/')) return 'projects';
  if (view.startsWith('finances/')) return 'finances';
  if (view.startsWith('suppliers/')) return 'suppliers';
  if (view.startsWith('configuration/')) return 'configuration';
  if (view === 'settings') return 'settings';
  return null;
};

const TrackerView: React.FC<{
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAddEntry: (entry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>) => void;
  onDeleteEntry: (id: string) => void;
  insights: string;
  isInsightLoading: boolean;
  onRefreshInsights: () => void;
  onUpdateEntry: (id: string, updates: Partial<TimeEntry>) => void;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  onMakeRecurring: (taskId: string, pattern: 'daily' | 'weekly' | 'monthly', endDate?: string) => void;
  userRole: UserRole;
  viewingUserId: string;
  onViewUserChange: (id: string) => void;
  availableUsers: User[];
  currentUser: User;
  dailyGoal: number;
  onAddBulkEntries: (entries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => Promise<void>;
  enableAiInsights: boolean;
  onRecurringAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
  geminiApiKey?: string;
}> = ({
  entries, clients, projects, projectTasks, onAddEntry, onDeleteEntry, insights, isInsightLoading,
  onRefreshInsights, onUpdateEntry, startOfWeek, treatSaturdayAsHoliday, onMakeRecurring, userRole,
  viewingUserId, onViewUserChange, availableUsers, currentUser, dailyGoal, onAddBulkEntries,
  enableAiInsights, onRecurringAction, geminiApiKey
}) => {
    const { t } = useTranslation('timesheets');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [trackerMode, setTrackerMode] = useState<'daily' | 'weekly'>(() => {
      const saved = localStorage.getItem('trackerMode');
      return (saved === 'daily' || saved === 'weekly') ? saved : 'daily';
    });

    useEffect(() => {
      localStorage.setItem('trackerMode', trackerMode);
    }, [trackerMode]);

    const filteredEntries = useMemo(() => {
      if (!selectedDate) return entries;
      return entries.filter(e => e.date === selectedDate);
    }, [entries, selectedDate]);

    const dailyTotal = useMemo(() => {
      return filteredEntries.reduce((sum, e) => sum + e.duration, 0);
    }, [filteredEntries]);

    const [pendingDeleteEntry, setPendingDeleteEntry] = useState<TimeEntry | null>(null);

    const handleDeleteClick = (entry: TimeEntry) => {
      if (entry.isPlaceholder) {
        // Show modal for recurring entries
        setPendingDeleteEntry(entry);
      } else {
        // Direct delete for normal entries
        onDeleteEntry(entry.id);
      }
    };

    const handleRecurringDelete = (action: 'stop' | 'delete_future' | 'delete_all') => {
      if (!pendingDeleteEntry) return;
      const task = projectTasks.find(t => t.name === pendingDeleteEntry.task && t.projectId === pendingDeleteEntry.projectId);
      if (task) {
        onRecurringAction(task.id, action);
      }
      setPendingDeleteEntry(null);
    };

    const viewingUser = availableUsers.find(u => u.id === viewingUserId);
    const isViewingSelf = viewingUserId === currentUser.id;

    const userOptions = useMemo(() => availableUsers.map(u => ({ id: u.id, name: u.name })), [availableUsers]);

    return (
      <div className="flex flex-col gap-6 animate-in fade-in duration-500">
        {/* Top Middle Toggle */}
        <div className="flex justify-center">
          <div className="relative grid grid-cols-2 bg-slate-200/50 p-1 rounded-full w-full max-w-[240px]">
            <div
              className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-full shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${trackerMode === 'daily' ? 'translate-x-0 left-1' : 'translate-x-full left-1'
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
            onAddEntry={onAddEntry}
            onDeleteEntry={onDeleteEntry}
            onUpdateEntry={onUpdateEntry}
            userRole={userRole}
            currentUser={currentUser}
            viewingUserId={viewingUserId}
            availableUsers={availableUsers}
            onViewUserChange={onViewUserChange}
            onAddBulkEntries={onAddBulkEntries}
            startOfWeek={startOfWeek}
            treatSaturdayAsHoliday={treatSaturdayAsHoliday}
          />
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="flex-1 space-y-6">

              {/* Manager Selection Header */}
              {availableUsers.length > 1 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-sm ${isViewingSelf ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>
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
                      onChange={onViewUserChange}
                      label={t('tracker.switchUserView')}
                      searchable={true}
                    />
                  </div>
                </div>
              )}

              <TimeEntryForm
                clients={clients}
                projects={projects}
                projectTasks={projectTasks}
                onAdd={onAddEntry}
                selectedDate={selectedDate}
                onMakeRecurring={onMakeRecurring}
                userRole={userRole}
                dailyGoal={dailyGoal}
                currentDayTotal={dailyTotal}
                enableAiInsights={enableAiInsights}
                geminiApiKey={geminiApiKey}
              />

              <div className="space-y-4">
                <div className="flex justify-between items-end px-2">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                      {selectedDate ? t('tracker.activityFor', { date: new Date(selectedDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) }) : t('entry.recentActivity')}
                    </h3>
                    {selectedDate && <p className="text-xs text-slate-400 font-medium">{t('tracker.logsForDate')}</p>}
                  </div>
                  {selectedDate && (
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">{t('tracker.dayTotal')}</p>
                      <p className={`text-lg font-black transition-colors ${dailyTotal > dailyGoal ? 'text-red-600' : 'text-praetor'}`}>{dailyTotal.toFixed(2)} h</p>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {!selectedDate && <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">{t('entry.date')}</th>}
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">{t('tracker.clientProject')}</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">{t('entry.task')}</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">{t('tracker.notes')}</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter text-right">{t('entry.hours')}</th>
                        <th className="px-6 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEntries.length === 0 ? (
                        <tr>
                          <td colSpan={selectedDate ? 5 : 6} className="px-6 py-20 text-center">
                            <i className="fa-solid fa-calendar-day text-4xl text-slate-100 mb-4 block"></i>
                            <p className="text-slate-400 font-medium text-sm">{t('tracker.noEntries')}</p>
                          </td>
                        </tr>
                      ) : filteredEntries.map(entry => (
                        <tr key={entry.id} className={`group hover:bg-slate-50/50 transition-colors ${entry.isPlaceholder ? 'bg-indigo-50/30 italic' : ''}`}>
                          {!selectedDate && <td className="px-6 py-4 text-xs font-bold text-slate-500 align-top">{entry.date}</td>}
                          <td className="px-6 py-4 align-top">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-black text-indigo-500 uppercase leading-none mb-1 tracking-wider">{entry.clientName}</span>
                              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: projects.find(p => p.id === entry.projectId)?.color }}></span>
                                {entry.projectName}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm align-top">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">{entry.task}</span>
                              {entry.isPlaceholder && <i className="fa-solid fa-repeat text-[10px] text-indigo-400" title={t('entry.recurringTask')}></i>}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm align-top">
                            {entry.notes ? (
                              <div className="text-slate-500 text-xs italic leading-relaxed">{entry.notes}</div>
                            ) : (
                              <span className="text-slate-300 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-900 font-black text-right align-top">
                            {entry.isPlaceholder && entry.duration === 0 ? '--' : entry.duration.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 align-top">
                            <button onClick={() => handleDeleteClick(entry)} className="text-slate-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1">
                              <i className="fa-solid fa-trash-can text-xs"></i>
                            </button>
                          </td>
                        </tr>
                      ))}
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
                    ) : insights}
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
                  {t('entry.howHandleEntries')} <strong className="text-slate-800">{pendingDeleteEntry.task}</strong>?
                </p>
              </div>

              <div className="p-4 space-y-3">
                <button
                  onClick={() => handleRecurringDelete('stop')}
                  className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-800 group-hover:text-indigo-700">{t('recurring.stopOnly')}</span>
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
                    <span className="font-bold text-slate-800 group-hover:text-red-700">{t('recurring.deleteFuture')}</span>
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
  const [sales, setSales] = useState<Sale[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuotes, setSupplierQuotes] = useState<SupplierQuote[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [settings, setSettings] = useState({
    fullName: 'User',
    email: ''
  });
  const [ldapConfig, setLdapConfig] = useState<LdapConfig>({
    enabled: false,
    serverUrl: 'ldap://ldap.example.com:389',
    baseDn: 'dc=example,dc=com',
    bindDn: 'cn=read-only-admin,dc=example,dc=com',
    bindPassword: '',
    userFilter: '(uid={0})',
    groupBaseDn: 'ou=groups,dc=example,dc=com',
    groupFilter: '(member={0})',
    roleMappings: []
  });
  const [generalSettings, setGeneralSettings] = useState({
    currency: '$',
    dailyLimit: 8,
    startOfWeek: 'Monday' as 'Monday' | 'Sunday',
    treatSaturdayAsHoliday: true,
    enableAiInsights: false,
    geminiApiKey: ''
  });
  const [loadedModules, setLoadedModules] = useState<Set<string>>(new Set());
  const [hasLoadedGeneralSettings, setHasLoadedGeneralSettings] = useState(false);
  const [hasLoadedLdapConfig, setHasLoadedLdapConfig] = useState(false);

  const [workUnits, setWorkUnits] = useState<WorkUnit[]>([]);

  const [viewingUserId, setViewingUserId] = useState<string>('');
  const [viewingUserAssignments, setViewingUserAssignments] = useState<{ clientIds: string[], projectIds: string[], taskIds: string[] } | null>(null);
  const VALID_VIEWS: View[] = useMemo(() => [
    'timesheets/tracker', 'timesheets/reports', 'timesheets/recurring', 'timesheets/tasks', 'timesheets/projects',
    'hr/workforce', 'hr/work-units', 'configuration/authentication', 'configuration/general',
    'crm/clients', 'crm/products', 'crm/special-bids', 'crm/quotes', 'crm/sales',
    'finances/invoices', 'finances/payments', 'finances/expenses', 'finances/reports',
    'projects/manage', 'projects/tasks',
    'suppliers/manage', 'suppliers/quotes',
    'settings'
  ], []);

  const [activeView, setActiveView] = useState<View | '404'>(() => {
    const rawHash = window.location.hash.replace('#/', '').replace('#', '');
    const hash = rawHash as View;
    // We can't use the memoized VALID_VIEWS here because this runs before the initial render
    // So we define the list once for initialization
    const validViews: View[] = [
      'timesheets/tracker', 'timesheets/reports', 'timesheets/recurring', 'timesheets/tasks', 'timesheets/projects',
      'hr/workforce', 'hr/work-units', 'configuration/authentication', 'configuration/general',
      'crm/clients', 'crm/products', 'crm/special-bids', 'crm/quotes', 'crm/sales',
      'finances/invoices', 'finances/payments', 'finances/expenses', 'finances/reports',
      'projects/manage', 'projects/tasks',
      'suppliers/manage', 'suppliers/quotes',
      'settings'
    ];
    return validViews.includes(hash) ? hash : (rawHash === '' || rawHash === 'login' ? 'timesheets/tracker' : '404');
  });
  const [quoteFilterId, setQuoteFilterId] = useState<string | null>(null);

  const quoteIdsWithSales = useMemo(() => {
    const ids = new Set<string>();
    sales.forEach(sale => {
      if (sale.linkedQuoteId) {
        ids.add(sale.linkedQuoteId);
      }
    });
    return ids;
  }, [sales]);

  const isRouteAccessible = useMemo(() => {
    if (!currentUser) return false;
    if (activeView === '404') return false;

    const permissions: Record<View, UserRole[]> = {
      // Timesheets module - manager and user
      'timesheets/tracker': ['manager', 'user'],
      'timesheets/reports': ['manager', 'user'],
      'timesheets/recurring': ['manager', 'user'],
      'timesheets/tasks': ['manager', 'user'],
      'timesheets/projects': ['manager', 'user'],
      // HR module - admin/manager
      'hr/workforce': ['admin', 'manager'],
      'hr/work-units': ['admin', 'manager'],
      // Configuration module - admin only
      'configuration/authentication': ['admin'],
      'configuration/general': ['admin'],
      // CRM module - manager
      'crm/clients': ['manager'],
      'crm/products': ['manager'],
      'crm/special-bids': ['manager'],
      'crm/quotes': ['manager'],
      'crm/sales': ['manager'],
      // Finances module - manager
      'finances/invoices': ['manager'],
      'finances/payments': ['manager'],
      'finances/expenses': ['manager'],
      'finances/reports': ['manager'],
      // Projects module - manager
      'projects/manage': ['manager'],
      'projects/tasks': ['manager'],
      // Suppliers module - manager
      'suppliers/manage': ['manager'],
      'suppliers/quotes': ['manager'],
      // Standalone
      'settings': ['admin', 'manager']
    };

    const allowedRoles = permissions[activeView as View];
    return allowedRoles ? allowedRoles.includes(currentUser.role) : false;
  }, [activeView, currentUser]);
  const [insights, setInsights] = useState<string>('Logging some time to see patterns!');
  const [isInsightLoading, setIsInsightLoading] = useState(false);

  // Redirect to 404 if route is not accessible
  useEffect(() => {
    if (currentUser && !isRouteAccessible && activeView !== '404') {
      setActiveView('404');
    }
  }, [currentUser, isRouteAccessible, activeView]);

  // Sync hash with activeView
  useEffect(() => {
    if (isLoading) return;
    if (!currentUser) {
      if (window.location.hash !== '#/login') window.location.hash = '/login';
      return;
    }
    window.location.hash = '/' + activeView;
  }, [activeView, currentUser, isLoading]);

  useEffect(() => {
    if (activeView !== 'crm/quotes' && quoteFilterId) {
      setQuoteFilterId(null);
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
      const hash = rawHash as View;
      const nextView = VALID_VIEWS.includes(hash) ? hash : (rawHash === '' ? 'timesheets/tracker' : '404');
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
      setViewingUserId(currentUser.id);
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

          // Load user's language preference
          try {
            const settings = await api.settings.get();
            if (settings.language) {
              localStorage.setItem('i18nextLng', settings.language);
              i18n.changeLanguage(settings.language);
            }
          } catch (err) {
            // Settings might not exist yet, that's okay
          }
        } catch (err) {
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
      setGeneralSettings(genSettings);
      setHasLoadedGeneralSettings(true);
    };

    const loadLdapConfig = async () => {
      if (hasLoadedLdapConfig) return;
      const ldap = await api.ldap.getConfig();
      setLdapConfig(ldap);
      setHasLoadedLdapConfig(true);
    };

    const loadModuleData = async () => {
      try {
        switch (module) {
          case 'timesheets': {
            if (currentUser.role === 'admin') return;
            const [entriesData, clientsData, projectsData, tasksData, usersData] = await Promise.all([
              api.entries.list(),
              api.clients.list(),
              api.projects.list(),
              api.tasks.list(),
              api.users.list()
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
            if (currentUser.role !== 'admin' && currentUser.role !== 'manager') return;
            const [usersData, workUnitsData] = await Promise.all([
              api.users.list(),
              api.workUnits.list()
            ]);
            setUsers(usersData);
            setWorkUnits(workUnitsData);
            await loadGeneralSettings();
            break;
          }
          case 'configuration': {
            if (currentUser.role !== 'admin') return;
            await loadGeneralSettings();
            await loadLdapConfig();
            break;
          }
          case 'crm': {
            if (currentUser.role !== 'manager') return;
            const [clientsData, productsData, specialBidsData, quotesData, salesData] = await Promise.all([
              api.clients.list(),
              api.products.list(),
              api.specialBids.list(),
              api.quotes.list(),
              api.sales.list()
            ]);
            setClients(clientsData);
            setProducts(productsData);
            setSpecialBids(specialBidsData);
            setQuotes(quotesData);
            setSales(salesData);
            await loadGeneralSettings();
            break;
          }
          case 'finances': {
            if (currentUser.role !== 'manager') return;
            const [invoicesData, paymentsData, expensesData, clientsData] = await Promise.all([
              api.invoices.list(),
              api.payments.list(),
              api.expenses.list(),
              api.clients.list()
            ]);
            setInvoices(invoicesData);
            setPayments(paymentsData);
            setExpenses(expensesData);
            setClients(clientsData);
            await loadGeneralSettings();
            break;
          }
          case 'projects': {
            if (currentUser.role !== 'manager') return;
            const [projectsData, tasksData, clientsData, usersData] = await Promise.all([
              api.projects.list(),
              api.tasks.list(),
              api.clients.list(),
              api.users.list()
            ]);
            setProjects(projectsData);
            setProjectTasks(tasksData);
            setClients(clientsData);
            setUsers(usersData);
            break;
          }
          case 'suppliers': {
            if (currentUser.role !== 'manager') return;
            const [suppliersData, supplierQuotesData, productsData] = await Promise.all([
              api.suppliers.list(),
              api.supplierQuotes.list(),
              api.products.list()
            ]);
            setSuppliers(suppliersData);
            setSupplierQuotes(supplierQuotesData);
            setProducts(productsData);
            await loadGeneralSettings();
            break;
          }
        }

        setLoadedModules(prev => {
          const next = new Set(prev);
          next.add(module);
          return next;
        });
      } catch (err) {
        console.error('Failed to load module data:', err);
      }
    };

    loadModuleData();
  }, [activeView, currentUser, isRouteAccessible, loadedModules, hasLoadedGeneralSettings, hasLoadedLdapConfig]);

  // Load entries and assignments when viewing user changes
  useEffect(() => {
    if (!currentUser || !viewingUserId) return;

    const loadAssignments = async () => {
      try {
        // If manager/admin is viewing another user, fetch that user's assignments to filter the dropdowns
        if ((currentUser.role === 'admin' || currentUser.role === 'manager') && viewingUserId !== currentUser.id) {
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
      setViewingUserId(currentUser.id);
    }
  }, [currentUser?.id]);

  // Determine available users for the dropdown based on role
  const availableUsers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'admin') return users;
    if (currentUser.role === 'manager') return users.filter(u => u.role === 'user' || u.id === currentUser.id);
    return [currentUser];
  }, [users, currentUser]);

  const generateRecurringEntries = useCallback(async () => {
    const today = new Date();
    // Default future limit for entries without an end date
    const defaultFutureLimit = new Date();
    defaultFutureLimit.setDate(today.getDate() + 14);

    const newEntries: TimeEntry[] = [];

    for (const task of projectTasks.filter(t => t.isRecurring)) {
      const project = projects.find(p => p.id === task.projectId);
      const client = project ? clients.find(c => c.id === project.clientId) : null;
      if (!project || !client) continue;

      const startDate = task.recurrenceStart ? new Date(task.recurrenceStart) : new Date();
      // Use recurrence end date if specified, otherwise use default 14-day limit
      const taskEndDate = task.recurrenceEnd ? new Date(task.recurrenceEnd) : null;
      const futureLimit = taskEndDate && taskEndDate > defaultFutureLimit ? taskEndDate : defaultFutureLimit;

      for (let d = new Date(startDate); d <= futureLimit; d.setDate(d.getDate() + 1)) {
        if (taskEndDate && d > taskEndDate) break;

        // Skip disabled days: Sundays, Saturdays (if configured), and holidays
        const isSunday = d.getDay() === 0;
        const isSaturday = d.getDay() === 6;
        const holidayName = isItalianHoliday(d);
        const isDisabledDay = isSunday || (generalSettings.treatSaturdayAsHoliday && isSaturday) || !!holidayName;
        if (isDisabledDay) continue;

        const dateStr = d.toISOString().split('T')[0];
        let matches = false;
        if (task.recurrencePattern === 'daily') matches = true;
        if (task.recurrencePattern === 'weekly' && d.getDay() === startDate.getDay()) matches = true;
        if (task.recurrencePattern === 'monthly' && d.getDate() === startDate.getDate()) matches = true;

        // Custom patterns: monthly:first:X or monthly:last:X
        if (typeof task.recurrencePattern === 'string' && task.recurrencePattern.startsWith('monthly:')) {
          const parts = task.recurrencePattern.split(':');
          if (parts.length === 3) {
            const type = parts[1]; // 'first' or 'last'
            const targetDay = parseInt(parts[2]); // 0-6 (Sun-Sat) or 1-7 depending on UI, my modal uses 0=Sun, 1=Mon... match JS getDay()

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
          const exists = entries.some(e => e.date === dateStr && e.projectId === task.projectId && e.task === task.name);
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
                hourlyCost: currentUser?.costPerHour || 0
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
      setEntries(prev => [...newEntries, ...prev].sort((a, b) => b.createdAt - a.createdAt));
    }
  }, [projectTasks, entries, projects, clients, currentUser]);

  // ... (rest of the logic remains validation which we don't need to change but need for context)

  // Filtered lists for TrackerView
  const filteredClients = useMemo(() => {
    const activeClients = clients.filter(c => !c.isDisabled);
    if (!viewingUserAssignments) return activeClients;
    return activeClients.filter(c => viewingUserAssignments.clientIds.includes(c.id));
  }, [clients, viewingUserAssignments]);

  const filteredProjects = useMemo(() => {
    const activeProjects = projects.filter(p => {
      if (p.isDisabled) return false;
      const client = clients.find(c => c.id === p.clientId);
      return !client?.isDisabled;
    });
    if (!viewingUserAssignments) return activeProjects;
    return activeProjects.filter(p => viewingUserAssignments.projectIds.includes(p.id));
  }, [projects, clients, viewingUserAssignments]);

  const filteredTasks = useMemo(() => {
    const activeTasks = projectTasks.filter(t => {
      if (t.isDisabled) return false;
      const project = projects.find(p => p.id === t.projectId);
      if (!project || project.isDisabled) return false;
      const client = clients.find(c => c.id === project.clientId);
      return !client?.isDisabled;
    });
    if (!viewingUserAssignments) return activeTasks;
    return activeTasks.filter(t => viewingUserAssignments.taskIds.includes(t.id));
  }, [projectTasks, projects, clients, viewingUserAssignments]);


  useEffect(() => {
    if (!currentUser) return;
    const timer = setTimeout(() => { generateRecurringEntries(); }, 100);
    return () => clearTimeout(timer);
  }, [generateRecurringEntries, currentUser]);

  // ... (handlers)

  const handleAddEntry = async (newEntry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const entry = await api.entries.create({
        ...newEntry,
        userId: targetUserId,
        hourlyCost: currentUser?.costPerHour || 0
      } as any);
      setEntries([entry, ...entries]);
    } catch (err) {
      console.error('Failed to add entry:', err);
      alert('Failed to add time entry');
    }
  };

  const handleAddBulkEntries = async (newEntries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const createdEntries = await Promise.all(newEntries.map(entry => api.entries.create({
        ...entry,
        userId: targetUserId,
        hourlyCost: currentUser?.costPerHour || 0
      } as any)));
      setEntries(prev => [...createdEntries, ...prev].sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Failed to add bulk entries:', err);
      alert('Failed to add some time entries');
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await api.entries.delete(id);
      setEntries(entries.filter(e => e.id !== id));
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  const handleUpdateEntry = async (id: string, updates: Partial<TimeEntry>) => {
    try {
      const updated = await api.entries.update(id, updates);
      setEntries(entries.map(e => e.id === id ? updated : e));
    } catch (err) {
      console.error('Failed to update entry:', err);
    }
  };

  const handleUpdateTask = async (id: string, updates: Partial<ProjectTask>) => {
    try {
      const updated = await api.tasks.update(id, updates);
      setProjectTasks(projectTasks.map(t => t.id === id ? updated : t));
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleMakeRecurring = async (taskId: string, pattern: 'daily' | 'weekly' | 'monthly', startDate?: string, endDate?: string, duration?: number) => {
    try {
      const updated = await api.tasks.update(taskId, {
        isRecurring: true,
        recurrencePattern: pattern,
        recurrenceStart: startDate || new Date().toISOString().split('T')[0],
        recurrenceEnd: endDate,
        recurrenceDuration: duration
      });
      setProjectTasks(projectTasks.map(t => t.id === taskId ? updated : t));
      setTimeout(generateRecurringEntries, 100);
    } catch (err) {
      console.error('Failed to make task recurring:', err);
    }
  };

  const handleRecurringAction = async (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => {
    const task = projectTasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      await api.tasks.update(taskId, {
        isRecurring: false,
        recurrencePattern: undefined,
        recurrenceStart: undefined,
        recurrenceEnd: undefined
      });
      setProjectTasks(projectTasks.map(t => t.id === taskId ? { ...t, isRecurring: false, recurrencePattern: undefined, recurrenceStart: undefined, recurrenceEnd: undefined } : t));

      if (action === 'stop') {
        await api.entries.bulkDelete(task.projectId, task.name, { placeholderOnly: true });
        setEntries(prev => prev.filter(e => !(e.isPlaceholder && e.projectId === task.projectId && e.task === task.name)));
      } else if (action === 'delete_future') {
        await api.entries.bulkDelete(task.projectId, task.name, { futureOnly: true });
        const today = new Date().toISOString().split('T')[0];
        setEntries(prev => prev.filter(e => !(e.projectId === task.projectId && e.task === task.name && e.date >= today)));
      } else if (action === 'delete_all') {
        await api.entries.bulkDelete(task.projectId, task.name);
        setEntries(prev => prev.filter(e => !(e.projectId === task.projectId && e.task === task.name)));
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
      setClients(clients.map(c => c.id === id ? updated : c));
    } catch (err) {
      console.error('Failed to update client:', err);
      throw err;
    }
  };

  const handleDeleteClient = async (id: string) => {
    try {
      await api.clients.delete(id);
      setClients(clients.filter(c => c.id !== id));
      setProjects(projects.filter(p => p.clientId !== id));
      // Tasks are also deleted by cascade in DB, so filter them too
      const projectIdsForClient = projects.filter(p => p.clientId === id).map(p => p.id);
      setProjectTasks(projectTasks.filter(t => !projectIdsForClient.includes(t.projectId)));
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
      setSpecialBids(specialBids.map(b => b.id === id ? updated : b));
    } catch (err) {
      console.error('Failed to update special bid:', err);
      alert((err as Error).message || 'Failed to update special bid');
    }
  };

  const handleDeleteSpecialBid = async (id: string) => {
    try {
      await api.specialBids.delete(id);
      setSpecialBids(specialBids.filter(b => b.id !== id));
    } catch (err) {
      console.error('Failed to delete special bid:', err);
      alert((err as Error).message || 'Failed to delete special bid');
    }
  };

  const handleUpdateProduct = async (id: string, updates: Partial<Product>) => {
    try {
      const updated = await api.products.update(id, updates);
      setProducts(products.map(p => p.id === id ? updated : p));
    } catch (err) {
      console.error('Failed to update product:', err);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await api.products.delete(id);
      setProducts(products.filter(p => p.id !== id));
    } catch (err) {
      console.error('Failed to delete product:', err);
    }
  };

  const addQuote = async (quoteData: Partial<Quote>) => {
    try {
      const quote = await api.quotes.create(quoteData);
      setQuotes([...quotes, quote]);
    } catch (err) {
      console.error('Failed to add quote:', err);
    }
  };

  const handleUpdateQuote = async (id: string, updates: Partial<Quote>) => {
    try {
      const updated = await api.quotes.update(id, updates);
      setQuotes(quotes.map(q => q.id === id ? updated : q));
    } catch (err) {
      console.error('Failed to update quote:', err);
    }
  };

  const handleDeleteQuote = async (id: string) => {
    try {
      await api.quotes.delete(id);
      setQuotes(quotes.filter(q => q.id !== id));
    } catch (err) {
      console.error('Failed to delete quote:', err);
    }
  };

  const addSale = async (saleData: Partial<Sale>) => {
    try {
      const sale = await api.sales.create(saleData);
      setSales([...sales, sale]);
    } catch (err) {
      console.error('Failed to add sale:', err);
    }
  };

  const handleUpdateSale = async (id: string, updates: Partial<Sale>) => {
    try {
      const updated = await api.sales.update(id, updates);
      setSales(sales.map(s => s.id === id ? updated : s));
    } catch (err) {
      console.error('Failed to update sale:', err);
    }
  };

  const handleDeleteSale = async (id: string) => {
    try {
      await api.sales.delete(id);
      setSales(sales.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete sale:', err);
    }
  };

  const handleCreateSaleFromQuote = async (quote: Quote) => {
    try {
      const saleData: Partial<Sale> = {
        clientId: quote.clientId,
        clientName: quote.clientName,
        status: 'pending',
        linkedQuoteId: quote.id,
        items: quote.items.map(item => ({
          productId: item.productId,
          productName: item.productName,
          specialBidId: item.specialBidId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          id: 'temp-' + Math.random().toString(36).substr(2, 9),
          saleId: ''
        })),
        discount: quote.discount,
        notes: quote.notes
      };

      const sale = await api.sales.create(saleData);
      setSales([...sales, sale]);
      setActiveView('crm/sales');
    } catch (err) {
      console.error('Failed to create sale from quote:', err);
      alert('Failed to create sale from quote');
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
      setInvoices(invoices.map(i => i.id === id ? updated : i));
    } catch (err) {
      console.error('Failed to update invoice:', err);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      await api.invoices.delete(id);
      setInvoices(invoices.filter(i => i.id !== id));
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
        const invoice = await api.invoices.list().then(list => list.find(i => i.id === payment.invoiceId));
        if (invoice) {
          setInvoices(prev => prev.map(p => p.id === invoice.id ? invoice : p));
        }
      }

    } catch (err) {
      console.error('Failed to add payment:', err);
    }
  };

  const handleUpdatePayment = async (id: string, updates: Partial<Payment>) => {
    try {
      const updated = await api.payments.update(id, updates);
      setPayments(payments.map(p => p.id === id ? updated : p));

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
      setPayments(payments.filter(p => p.id !== id));

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
      setExpenses(expenses.map(e => e.id === id ? updated : e));
    } catch (err) {
      console.error('Failed to update expense:', err);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await api.expenses.delete(id);
      setExpenses(expenses.filter(e => e.id !== id));
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
      setSuppliers(suppliers.map(s => s.id === id ? updated : s));
    } catch (err) {
      console.error('Failed to update supplier:', err);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    try {
      await api.suppliers.delete(id);
      setSuppliers(suppliers.filter(s => s.id !== id));
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
      setSupplierQuotes(supplierQuotes.map(q => q.id === id ? updated : q));
    } catch (err) {
      console.error('Failed to update supplier quote:', err);
    }
  };

  const handleDeleteSupplierQuote = async (id: string) => {
    try {
      await api.supplierQuotes.delete(id);
      setSupplierQuotes(supplierQuotes.filter(q => q.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier quote:', err);
    }
  };

  const addProject = async (name: string, clientId: string, description?: string) => {
    try {
      const usedColors = projects.map(p => p.color);
      const availableColors = COLORS.filter(c => !usedColors.includes(c));
      const color = availableColors.length > 0
        ? availableColors[Math.floor(Math.random() * availableColors.length)]
        : COLORS[Math.floor(Math.random() * COLORS.length)];

      const project = await api.projects.create(name, clientId, description, color);
      setProjects([...projects, project]);
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  const addProjectTask = async (name: string, projectId: string, recurringConfig?: { isRecurring: boolean, pattern: 'daily' | 'weekly' | 'monthly' }, description?: string) => {
    try {
      const task = await api.tasks.create(name, projectId, description, recurringConfig?.isRecurring, recurringConfig?.pattern);
      setProjectTasks([...projectTasks, task]);
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const handleUpdateProject = async (id: string, updates: Partial<Project>) => {
    try {
      const updated = await api.projects.update(id, updates);
      setProjects(projects.map(p => p.id === id ? updated : p));
    } catch (err) {
      console.error('Failed to update project:', err);
      alert('Failed to update project');
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await api.projects.delete(id);
      setProjects(projects.filter(p => p.id !== id));
      setProjectTasks(projectTasks.filter(t => t.projectId !== id));
      setEntries(entries.filter(e => e.projectId !== id));
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('Failed to delete project');
    }
  };

  const addUser = async (name: string, username: string, password: string, role: UserRole) => {
    try {
      const user = await api.users.create(name, username, password, role);
      setUsers([...users, user]);
      return { success: true };
    } catch (err) {
      console.error('Failed to add user:', err);
      return { success: false, error: (err as Error).message };
    }
  };

  const deleteUser = async (id: string) => {
    try {
      await api.users.delete(id);
      setUsers(users.filter(u => u.id !== id));
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const handleUpdateUser = async (id: string, updates: Partial<User>) => {
    try {
      const updated = await api.users.update(id, updates);
      setUsers(users.map(u => u.id === id ? updated : u));
    } catch (err) {
      console.error('Failed to update user:', err);
      alert('Failed to update user: ' + (err as Error).message);
    }
  };

  const handleUpdateGeneralSettings = async (updates: Partial<IGeneralSettings>) => {
    try {
      const updated = await api.generalSettings.update(updates);
      setGeneralSettings(updated);
    } catch (err) {
      console.error('Failed to update general settings:', err);
      alert('Failed to update settings');
    }
  };

  const generateInsights = async () => {
    if (entries.length < 3) return;
    setIsInsightLoading(true);
    const userEntries = entries.filter(e => e.userId === viewingUserId);
    const result = await getInsights(userEntries.slice(0, 10), generalSettings.geminiApiKey);
    setInsights(result);
    setIsInsightLoading(false);
  };

  const getDefaultViewForRole = (role: UserRole): View =>
    role === 'admin' ? 'hr/workforce' : 'timesheets/tracker';

  const handleLogin = async (user: User, token?: string) => {
    if (token) {
      setAuthToken(token);
    }
    setLoadedModules(new Set());
    setHasLoadedGeneralSettings(false);
    setHasLoadedLdapConfig(false);
    setCurrentUser(user);
    setViewingUserId(user.id);

    if (user.role === 'admin') {
      const adminAllowed = new Set<View>([
        'hr/workforce', 'hr/work-units',
        'configuration/authentication', 'configuration/general',
        'settings'
      ]);
      if (activeView === '404' || !adminAllowed.has(activeView as View)) {
        setActiveView(getDefaultViewForRole(user.role));
      }
    }
  };

  const handleLogout = (reason?: 'inactivity') => {
    setAuthToken(null);
    setCurrentUser(null);
    setViewingUserId('');
    setLoadedModules(new Set());
    setHasLoadedGeneralSettings(false);
    setHasLoadedLdapConfig(false);
    setUsers([]);
    setClients([]);
    setProjects([]);
    setProjectTasks([]);
    setProducts([]);
    setSpecialBids([]);
    setQuotes([]);
    setSuppliers([]);
    setSupplierQuotes([]);
    setEntries([]);
    setLogoutReason(reason || null);
  };

  const handleSaveLdapConfig = async (config: LdapConfig) => {
    try {
      const updated = await api.ldap.updateConfig(config);
      setLdapConfig(updated);
    } catch (err) {
      console.error('Failed to save LDAP config:', err);
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
      setWorkUnits(workUnits.map(w => w.id === id ? updated : w));
    } catch (err) {
      console.error('Failed to update work unit:', err);
      throw err;
    }
  };

  const deleteWorkUnit = async (id: string) => {
    try {
      await api.workUnits.delete(id);
      setWorkUnits(workUnits.filter(w => w.id !== id));
    } catch (err) {
      console.error('Failed to delete work unit:', err);
      throw err;
    }
  };

  const refreshWorkUnits = async () => {
    try {
      const wu = await api.workUnits.list();
      setWorkUnits(wu);
    } catch (err) {
      console.error('Failed to refresh work units', err);
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

  if (!currentUser) return <Login users={users} onLogin={handleLogin} logoutReason={logoutReason} onClearLogoutReason={() => setLogoutReason(null)} />;

  return (
    <>
      <SessionTimeoutHandler onLogout={() => handleLogout('inactivity')} />
      <Layout
        activeView={!isRouteAccessible ? 'tracker' : (activeView as View)}
        onViewChange={setActiveView}
        currentUser={currentUser}
        onLogout={handleLogout}
        isNotFound={!isRouteAccessible}
      >
        {!isRouteAccessible ? (
          <NotFound onReturn={() => setActiveView('timesheets/tracker')} />
        ) : (
          <>
            {activeView === 'timesheets/tracker' && (
              <TrackerView
                entries={entries.filter(e => e.userId === viewingUserId)}
                clients={filteredClients} projects={filteredProjects} projectTasks={filteredTasks}
                onAddEntry={handleAddEntry} onDeleteEntry={handleDeleteEntry} onUpdateEntry={handleUpdateEntry}
                insights={insights} isInsightLoading={isInsightLoading} onRefreshInsights={generateInsights}
                startOfWeek={generalSettings.startOfWeek}
                treatSaturdayAsHoliday={generalSettings.treatSaturdayAsHoliday}
                onMakeRecurring={handleMakeRecurring} userRole={currentUser.role}
                viewingUserId={viewingUserId}
                onViewUserChange={setViewingUserId}
                availableUsers={availableUsers}
                currentUser={currentUser}
                dailyGoal={generalSettings.dailyLimit}
                onAddBulkEntries={handleAddBulkEntries}
                enableAiInsights={generalSettings.enableAiInsights}
                onRecurringAction={handleRecurringAction}
                geminiApiKey={generalSettings.geminiApiKey}
              />
            )}
            {activeView === 'timesheets/reports' && (
              <Reports
                entries={
                  currentUser.role === 'manager'
                    ? entries
                    : entries.filter(e => e.userId === currentUser.id)
                }
                projects={projects}
                clients={clients}
                users={users}
                currentUser={currentUser}
                startOfWeek={generalSettings.startOfWeek}
                treatSaturdayAsHoliday={generalSettings.treatSaturdayAsHoliday}
                dailyGoal={generalSettings.dailyLimit}
                currency={generalSettings.currency}
              />
            )}

            {activeView === 'crm/clients' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <ClientsView
                clients={clients}
                onAddClient={addClient}
                onUpdateClient={handleUpdateClient}
                onDeleteClient={handleDeleteClient}
                userRole={currentUser.role}
              />
            )}

            {activeView === 'crm/products' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <ProductsView
                products={products}
                suppliers={suppliers}
                onAddProduct={addProduct}
                onUpdateProduct={handleUpdateProduct}
                onDeleteProduct={handleDeleteProduct}
              />
            )}

            {activeView === 'crm/special-bids' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
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

            {activeView === 'crm/quotes' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <QuotesView
                quotes={quotes}
                clients={clients}
                products={products}
                specialBids={specialBids}
                onAddQuote={addQuote}
                onUpdateQuote={handleUpdateQuote}
                onDeleteQuote={handleDeleteQuote}
                onCreateSale={handleCreateSaleFromQuote}
                quoteFilterId={quoteFilterId}
                quoteIdsWithSales={quoteIdsWithSales}
                currency={generalSettings.currency}
              />
            )}

            {activeView === 'crm/sales' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <SalesView
                sales={sales}
                clients={clients}
                products={products}
                specialBids={specialBids}
                onAddSale={addSale}
                onUpdateSale={handleUpdateSale}
                onDeleteSale={handleDeleteSale}
                currency={generalSettings.currency}
                onViewQuote={(quoteId) => {
                  setQuoteFilterId(quoteId);
                  setActiveView('crm/quotes');
                }}
              />
            )}

            {activeView === 'finances/invoices' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <InvoicesView
                invoices={invoices}
                clients={clients}
                products={products}
                sales={sales}
                onAddInvoice={addInvoice}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
                currency={generalSettings.currency}
              />
            )}

            {activeView === 'finances/payments' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
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

            {activeView === 'finances/expenses' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <ExpensesView
                expenses={expenses}
                onAddExpense={addExpense}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                currency={generalSettings.currency}
              />
            )}

            {activeView === 'finances/reports' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <FinancialReportsView
                invoices={invoices}
                expenses={expenses}
                payments={payments}
                currency={generalSettings.currency}
              />
            )}

            {activeView === 'suppliers/manage' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <SuppliersView
                suppliers={suppliers}
                onAddSupplier={addSupplier}
                onUpdateSupplier={handleUpdateSupplier}
                onDeleteSupplier={handleDeleteSupplier}
              />
            )}

            {activeView === 'suppliers/quotes' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
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

            {activeView === 'timesheets/projects' && (
              <ProjectsReadOnly
                projects={projects}
                clients={clients}
              />
            )}

            {activeView === 'timesheets/tasks' && (
              <TasksReadOnly
                tasks={projectTasks}
                projects={projects}
                clients={clients}
              />
            )}

            {activeView === 'projects/manage' && (
              <ProjectsView
                projects={projects}
                clients={clients}
                role={currentUser.role}
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
                role={currentUser.role}
                users={availableUsers}
                onAddTask={addProjectTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={async (id) => {
                  try {
                    await api.tasks.delete(id);
                    setProjectTasks(projectTasks.filter(t => t.id !== id));
                  } catch (err) {
                    console.error('Failed to delete task:', err);
                    alert('Failed to delete task');
                  }
                }}
              />
            )}

            {(currentUser.role === 'admin' || currentUser.role === 'manager') && activeView === 'hr/workforce' && (
              <UserManagement
                users={users}
                clients={clients}
                projects={projects}
                tasks={projectTasks}
                onAddUser={addUser}
                onDeleteUser={deleteUser}
                onUpdateUser={handleUpdateUser}
                currentUserId={currentUser.id}
                currentUserRole={currentUser.role}
                currency={generalSettings.currency}
              />
            )}

            {(currentUser.role === 'admin' || currentUser.role === 'manager') && activeView === 'hr/work-units' && (
              <WorkUnitsView
                workUnits={workUnits}
                users={users}
                userRole={currentUser.role}
                onAddWorkUnit={addWorkUnit}
                onUpdateWorkUnit={updateWorkUnit}
                onDeleteWorkUnit={deleteWorkUnit}
                refreshWorkUnits={refreshWorkUnits}
              />
            )}

            {currentUser.role === 'admin' && activeView === 'configuration/general' && (
              <GeneralSettings
                settings={generalSettings}
                onUpdate={handleUpdateGeneralSettings}
              />
            )}

            {currentUser.role === 'admin' && activeView === 'configuration/authentication' && (
              <AdminAuthentication config={ldapConfig} onSave={handleSaveLdapConfig} />
            )}

            {activeView === 'timesheets/recurring' && <RecurringManager tasks={projectTasks} projects={projects} clients={clients} onAction={handleRecurringAction} />}
            {activeView === 'settings' && <Settings />}
          </>
        )}
      </Layout>
    </>
  );
};

export default App;
