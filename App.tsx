
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Client, Project, ProjectTask, TimeEntry, View, User, UserRole, LdapConfig, GeneralSettings as IGeneralSettings } from './types';
import { COLORS } from './constants';
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
import AdminAuthentication from './components/AdminAuthentication';
import GeneralSettings from './components/GeneralSettings';
import CustomSelect from './components/CustomSelect';
import WeeklyView from './components/WeeklyView';
import { getInsights } from './services/geminiService';
import api, { setAuthToken, getAuthToken } from './services/api';
import NotFound from './components/NotFound';

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
}> = ({
  entries, clients, projects, projectTasks, onAddEntry, onDeleteEntry, insights, isInsightLoading,
  onRefreshInsights, onUpdateEntry, startOfWeek, treatSaturdayAsHoliday, onMakeRecurring, userRole,
  viewingUserId, onViewUserChange, availableUsers, currentUser, dailyGoal, onAddBulkEntries,
  enableAiInsights
}) => {
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
              className={`relative z-10 w-full py-2 text-xs font-bold transition-colors duration-300 ${trackerMode === 'daily' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Daily
            </button>
            <button
              onClick={() => setTrackerMode('weekly')}
              className={`relative z-10 w-full py-2 text-xs font-bold transition-colors duration-300 ${trackerMode === 'weekly' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Weekly
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
                        {isViewingSelf ? 'My Timesheet' : 'Managing User'}
                      </p>
                      <p className="text-sm font-bold text-slate-800">{viewingUser?.name}</p>
                    </div>
                  </div>
                  <div className="w-64">
                    <CustomSelect
                      options={userOptions}
                      value={viewingUserId}
                      onChange={onViewUserChange}
                      label="Switch User View"
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
              />

              <div className="space-y-4">
                <div className="flex justify-between items-end px-2">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                      {selectedDate ? `Activity for ${new Date(selectedDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : 'Recent Activity'}
                    </h3>
                    {selectedDate && <p className="text-xs text-slate-400 font-medium">Logs specifically for this date</p>}
                  </div>
                  {selectedDate && (
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Day Total</p>
                      <p className={`text-lg font-black transition-colors ${dailyTotal > dailyGoal ? 'text-red-600' : 'text-indigo-600'}`}>{dailyTotal.toFixed(2)} h</p>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {!selectedDate && <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Date</th>}
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Client / Project</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Task</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Notes</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter text-right">Hours</th>
                        <th className="px-6 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEntries.length === 0 ? (
                        <tr>
                          <td colSpan={selectedDate ? 5 : 6} className="px-6 py-20 text-center">
                            <i className="fa-solid fa-calendar-day text-4xl text-slate-100 mb-4 block"></i>
                            <p className="text-slate-400 font-medium text-sm">No time entries for this selection</p>
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
                              {entry.isPlaceholder && <i className="fa-solid fa-repeat text-[10px] text-indigo-400" title="Recurring task"></i>}
                            </div>
                            {entry.isPlaceholder && (
                              <button
                                onClick={() => {
                                  const hours = prompt("Enter hours for this task:", "1.0");
                                  if (hours && !isNaN(parseFloat(hours))) {
                                    onUpdateEntry(entry.id, { duration: parseFloat(hours), isPlaceholder: false });
                                  }
                                }}
                                className="mt-2 text-[10px] font-bold text-indigo-600 uppercase hover:underline"
                              >
                                Complete Log
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm align-top">
                            {entry.notes ? (
                              <div className="text-slate-500 text-xs italic leading-relaxed">{entry.notes}</div>
                            ) : (
                              <span className="text-slate-300 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-900 font-black text-right align-top">
                            {entry.isPlaceholder ? '--' : entry.duration.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 align-top">
                            <button onClick={() => onDeleteEntry(entry.id)} className="text-slate-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1">
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
      </div>
    );
  };

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
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
    currency: 'USD',
    dailyLimit: 8,
    startOfWeek: 'Monday' as 'Monday' | 'Sunday',
    treatSaturdayAsHoliday: true,
    enableAiInsights: true
  });

  const [viewingUserId, setViewingUserId] = useState<string>('');
  const [viewingUserAssignments, setViewingUserAssignments] = useState<{ clientIds: string[], projectIds: string[], taskIds: string[] } | null>(null);
  const [activeView, setActiveView] = useState<View | '404'>(() => {
    const rawHash = window.location.hash.replace('#', '');
    const hash = rawHash as View;
    const validViews: View[] = ['tracker', 'reports', 'projects', 'tasks', 'clients', 'settings', 'users', 'recurring', 'admin-auth', 'administration-general'];
    return validViews.includes(hash) ? hash : (rawHash === '' ? 'tracker' : '404');
  });

  const isRouteAccessible = useMemo(() => {
    if (!currentUser) return false;
    if (activeView === '404') return false;

    const permissions: Record<View, UserRole[]> = {
      'tracker': ['admin', 'manager', 'user'],
      'reports': ['admin', 'manager', 'user'],
      'projects': ['admin', 'manager', 'user'],
      'tasks': ['admin', 'manager', 'user'],
      'recurring': ['admin', 'manager', 'user'],
      'settings': ['admin', 'manager', 'user'],
      'clients': ['admin', 'manager'],
      'users': ['admin', 'manager'],
      'admin-auth': ['admin'],
      'administration-general': ['admin']
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
    window.location.hash = activeView;
  }, [activeView]);

  // Sync state with hash (for back/forward buttons)
  useEffect(() => {
    const handleHashChange = () => {
      const rawHash = window.location.hash.replace('#', '');
      const hash = rawHash as View;
      const validViews: View[] = ['tracker', 'reports', 'projects', 'tasks', 'clients', 'settings', 'users', 'recurring', 'admin-auth', 'administration-general'];
      const nextView = validViews.includes(hash) ? hash : (rawHash === '' ? 'tracker' : '404');
      if (nextView !== activeView) {
        setActiveView(nextView);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeView]);

  // Reset viewingUserId when navigating away from tracker
  useEffect(() => {
    if (activeView !== 'tracker' && currentUser && viewingUserId !== currentUser.id) {
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
        } catch (err) {
          // Token invalid, clear it
          setAuthToken(null);
        }
      }
      setIsLoading(false);
    };
    checkAuth();
  }, []);

  // Load data when user is authenticated
  useEffect(() => {
    if (!currentUser) return;

    const loadData = async () => {
      try {
        const [usersData, clientsData, projectsData, tasksData, settingsData, entriesData] = await Promise.all([
          api.users.list(),
          api.clients.list(),
          api.projects.list(),
          api.tasks.list(),
          api.settings.get(),
          api.entries.list()
        ]);

        setUsers(usersData);
        setClients(clientsData);
        setProjects(projectsData);
        setProjectTasks(tasksData);
        setSettings(settingsData);
        setEntries(entriesData);

        // Load global settings for all users
        const genSettings = await api.generalSettings.get();
        setGeneralSettings(genSettings);

        // Load LDAP config for admins
        if (currentUser.role === 'admin') {
          const ldap = await api.ldap.getConfig();
          setLdapConfig(ldap);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };

    loadData();
  }, [currentUser]);

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
    // ... (unchanged)
    const today = new Date();
    const futureLimit = new Date();
    futureLimit.setDate(today.getDate() + 14);

    const newEntries: TimeEntry[] = [];

    for (const task of projectTasks.filter(t => t.isRecurring)) {
      const project = projects.find(p => p.id === task.projectId);
      const client = project ? clients.find(c => c.id === project.clientId) : null;
      if (!project || !client) continue;

      // ... (logic continues same as before, preserving it)
      const startDate = task.recurrenceStart ? new Date(task.recurrenceStart) : new Date();
      for (let d = new Date(startDate); d <= futureLimit; d.setDate(d.getDate() + 1)) {
        if (task.recurrenceEnd) {
          const endDate = new Date(task.recurrenceEnd);
          if (d > endDate) break;
        }
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

  const addClient = async (name: string) => {
    try {
      const client = await api.clients.create(name);
      setClients([...clients, client]);
    } catch (err) {
      console.error('Failed to add client:', err);
    }
  };

  const handleUpdateClient = async (id: string, updates: Partial<Client>) => {
    try {
      const updated = await api.clients.update(id, updates);
      setClients(clients.map(c => c.id === id ? updated : c));
    } catch (err) {
      console.error('Failed to update client:', err);
      alert('Failed to update client');
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
    } catch (err) {
      console.error('Failed to add user:', err);
      alert('Failed to add user: ' + (err as Error).message);
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
    const result = await getInsights(userEntries.slice(0, 10));
    setInsights(result);
    setIsInsightLoading(false);
  };

  const handleLogin = async (user: User, token?: string) => {
    if (token) {
      setAuthToken(token);
    }
    setCurrentUser(user);
    setViewingUserId(user.id);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setViewingUserId('');
    setUsers([]);
    setClients([]);
    setProjects([]);
    setProjectTasks([]);
    setEntries([]);
  };

  const handleSaveLdapConfig = async (config: LdapConfig) => {
    try {
      const updated = await api.ldap.updateConfig(config);
      setLdapConfig(updated);
    } catch (err) {
      console.error('Failed to save LDAP config:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl text-indigo-600 mb-4"></i>
          <p className="text-slate-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return <Login users={users} onLogin={handleLogin} />;

  return (
    <Layout
      activeView={!isRouteAccessible ? 'tracker' : (activeView as View)}
      onViewChange={setActiveView}
      currentUser={currentUser}
      onLogout={handleLogout}
      isNotFound={!isRouteAccessible}
    >
      {!isRouteAccessible ? (
        <NotFound onReturn={() => setActiveView('tracker')} />
      ) : (
        <>
          {activeView === 'tracker' && (
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
            />
          )}
          {activeView === 'reports' && (
            <Reports
              entries={
                (currentUser.role === 'admin' || currentUser.role === 'manager')
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

          {activeView === 'clients' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
            <ClientsView
              clients={clients}
              onAddClient={addClient}
              onUpdateClient={handleUpdateClient}
              onDeleteClient={handleDeleteClient}
            />
          )}

          {activeView === 'projects' && (
            <ProjectsView
              projects={projects}
              clients={clients}
              role={currentUser.role}
              onAddProject={addProject}
              onUpdateProject={handleUpdateProject}
              onDeleteProject={handleDeleteProject}
            />
          )}

          {activeView === 'tasks' && (
            <TasksView
              tasks={projectTasks}
              projects={projects}
              clients={clients}
              role={currentUser.role}
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

          {(currentUser.role === 'admin' || currentUser.role === 'manager') && activeView === 'users' && (
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

          {currentUser.role === 'admin' && activeView === 'administration-general' && (
            <GeneralSettings
              settings={generalSettings}
              onUpdate={handleUpdateGeneralSettings}
            />
          )}

          {currentUser.role === 'admin' && activeView === 'admin-auth' && (
            <AdminAuthentication config={ldapConfig} onSave={handleSaveLdapConfig} />
          )}

          {activeView === 'recurring' && <RecurringManager tasks={projectTasks} projects={projects} clients={clients} onAction={handleRecurringAction} />}
          {activeView === 'settings' && <Settings />}
        </>
      )}
    </Layout>
  );
};

export default App;
