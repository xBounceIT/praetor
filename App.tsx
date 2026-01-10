
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Client, Project, ProjectTask, TimeEntry, View, User, UserRole } from './types';
import { DEFAULT_CLIENTS, DEFAULT_PROJECTS, DEFAULT_TASKS, DEFAULT_USERS, COLORS } from './constants';
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
import { getInsights } from './services/geminiService';

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
}> = ({ entries, clients, projects, projectTasks, onAddEntry, onDeleteEntry, insights, isInsightLoading, onRefreshInsights, onUpdateEntry, startOfWeek, treatSaturdayAsHoliday, onMakeRecurring, userRole }) => {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const filteredEntries = useMemo(() => {
    if (!selectedDate) return entries;
    return entries.filter(e => e.date === selectedDate);
  }, [entries, selectedDate]);

  const dailyTotal = useMemo(() => {
    return filteredEntries.reduce((sum, e) => sum + e.duration, 0);
  }, [filteredEntries]);

  return (
    <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-500">
      <div className="flex-1 space-y-6">
        <TimeEntryForm 
          clients={clients} 
          projects={projects} 
          projectTasks={projectTasks} 
          onAdd={onAddEntry} 
          selectedDate={selectedDate}
          onMakeRecurring={onMakeRecurring}
          userRole={userRole}
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
                <p className="text-lg font-black text-indigo-600">{dailyTotal.toFixed(2)} h</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {!selectedDate && <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Date</th>}
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Client / Project</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter">Task & Notes</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-tighter text-right">Hours</th>
                  <th className="px-6 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
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
                      {entry.notes && (
                        <div className="text-slate-500 text-xs mt-1 italic leading-relaxed">{entry.notes}</div>
                      )}
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
        />
        
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
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('tempo_current_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('tempo_users');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migration: Ensure users have username/password if missing from old data
      return parsed.map((u: any) => ({
        ...u,
        username: u.username || u.name.toLowerCase(),
        password: u.password || 'password'
      }));
    }
    return DEFAULT_USERS;
  });

  const [clients, setClients] = useState<Client[]>(() => {
    const saved = localStorage.getItem('tempo_clients');
    return saved ? JSON.parse(saved) : DEFAULT_CLIENTS;
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('tempo_projects');
    return saved ? JSON.parse(saved) : DEFAULT_PROJECTS;
  });

  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>(() => {
    const saved = localStorage.getItem('tempo_tasks');
    return saved ? JSON.parse(saved) : DEFAULT_TASKS;
  });

  const [entries, setEntries] = useState<TimeEntry[]>(() => {
    const saved = localStorage.getItem('tempo_entries');
    return saved ? JSON.parse(saved) : [];
  });

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('tempo_settings');
    return saved ? JSON.parse(saved) : {
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      dailyGoal: 8,
      startOfWeek: 'Monday',
      enableAiInsights: true,
      compactView: false,
      treatSaturdayAsHoliday: true
    };
  });

  const [activeView, setActiveView] = useState<View>('tracker');
  const [insights, setInsights] = useState<string>('Logging some time to see patterns!');
  const [isInsightLoading, setIsInsightLoading] = useState(false);

  useEffect(() => localStorage.setItem('tempo_users', JSON.stringify(users)), [users]);
  useEffect(() => localStorage.setItem('tempo_clients', JSON.stringify(clients)), [clients]);
  useEffect(() => localStorage.setItem('tempo_projects', JSON.stringify(projects)), [projects]);
  useEffect(() => localStorage.setItem('tempo_tasks', JSON.stringify(projectTasks)), [projectTasks]);
  useEffect(() => localStorage.setItem('tempo_entries', JSON.stringify(entries)), [entries]);
  
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('tempo_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('tempo_current_user');
    }
  }, [currentUser]);

  useEffect(() => {
    const interval = setInterval(() => {
      const saved = localStorage.getItem('tempo_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (JSON.stringify(parsed) !== JSON.stringify(settings)) {
          setSettings(parsed);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [settings]);

  const generateRecurringEntries = useCallback(() => {
    const today = new Date();
    const futureLimit = new Date();
    futureLimit.setDate(today.getDate() + 14);

    const newEntries: TimeEntry[] = [];
    let updated = false;

    projectTasks.filter(task => task.isRecurring).forEach(task => {
      const project = projects.find(p => p.id === task.projectId);
      const client = project ? clients.find(c => c.id === project.clientId) : null;
      if (!project || !client) return;

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
        if (matches) {
          const exists = entries.some(e => e.date === dateStr && e.projectId === task.projectId && e.task === task.name);
          if (!exists) {
            newEntries.push({
              id: 'spawn-' + Math.random().toString(36).substr(2, 9),
              date: dateStr,
              userId: currentUser?.id || 'system',
              clientId: client.id,
              clientName: client.name,
              projectId: task.projectId,
              projectName: project.name,
              task: task.name,
              duration: 0,
              createdAt: Date.now(),
              isPlaceholder: true
            });
            updated = true;
          }
        }
      }
    });

    if (updated) setEntries(prev => [...prev, ...newEntries].sort((a,b) => b.createdAt - a.createdAt));
  }, [projectTasks, entries, projects, clients, currentUser]);

  useEffect(() => {
    const timer = setTimeout(() => { generateRecurringEntries(); }, 1000);
    return () => clearTimeout(timer);
  }, [generateRecurringEntries]);

  const handleLogin = (user: User) => { setCurrentUser(user); setActiveView('tracker'); };
  const handleLogout = () => { setCurrentUser(null); };

  const handleAddEntry = (newEntry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>) => {
    if (!currentUser) return;
    const entry: TimeEntry = { ...newEntry, id: Math.random().toString(36).substr(2, 9), createdAt: Date.now(), userId: currentUser.id };
    setEntries([entry, ...entries]);
  };

  const handleDeleteEntry = (id: string) => setEntries(entries.filter(e => e.id !== id));
  const handleUpdateEntry = (id: string, updates: Partial<TimeEntry>) => {
    setEntries(entries.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const handleUpdateTask = (id: string, updates: Partial<ProjectTask>) => {
    setProjectTasks(projectTasks.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleMakeRecurring = (taskId: string, pattern: 'daily' | 'weekly' | 'monthly', endDate?: string) => {
    const updatedTasks = projectTasks.map(t => t.id === taskId ? { ...t, isRecurring: true, recurrencePattern: pattern, recurrenceStart: new Date().toISOString().split('T')[0], recurrenceEnd: endDate } : t);
    setProjectTasks(updatedTasks);
    setTimeout(generateRecurringEntries, 100);
    alert('Task set to recurring!');
  };

  const handleRecurringAction = (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => {
    const task = projectTasks.find(t => t.id === taskId);
    if (!task) return;
    const updatedTasks = projectTasks.map(t => t.id === taskId ? { ...t, isRecurring: false, recurrencePattern: undefined, recurrenceStart: undefined, recurrenceEnd: undefined } : t);
    setProjectTasks(updatedTasks);
    const today = new Date().toISOString().split('T')[0];
    if (action === 'stop') {
        setEntries(prev => prev.filter(e => !(e.isPlaceholder && e.projectId === task.projectId && e.task === task.name)));
    } else if (action === 'delete_future') {
        setEntries(prev => prev.filter(e => {
            const isMatch = e.projectId === task.projectId && e.task === task.name;
            if (isMatch && e.date >= today) return false;
            return true;
        }));
    } else if (action === 'delete_all') {
        setEntries(prev => prev.filter(e => !(e.projectId === task.projectId && e.task === task.name)));
    }
  };

  const addClient = (name: string) => { setClients([...clients, { id: 'c-' + Date.now(), name }]); };
  const addProject = (name: string, clientId: string, description?: string) => {
    setProjects([...projects, { id: 'p-' + Date.now(), name, clientId, description, color: COLORS[Math.floor(Math.random() * COLORS.length)] }]);
  };
  const addProjectTask = (name: string, projectId: string, recurringConfig?: { isRecurring: boolean, pattern: 'daily' | 'weekly' | 'monthly' }, description?: string) => {
    setProjectTasks([...projectTasks, { id: 't-' + Date.now(), name, projectId, description, ...recurringConfig, recurrenceStart: recurringConfig?.isRecurring ? new Date().toISOString().split('T')[0] : undefined }]);
  };

  const addUser = (name: string, username: string, password: string, role: UserRole) => {
    const initials = name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
    setUsers([...users, { id: 'u-' + Date.now(), name, role, avatarInitials: initials, username, password }]);
  };
  const deleteUser = (id: string) => { setUsers(users.filter(u => u.id !== id)); };

  const generateInsights = async () => {
    if (entries.length < 3) return;
    setIsInsightLoading(true);
    const userEntries = entries.filter(e => e.userId === currentUser?.id);
    const result = await getInsights(userEntries.slice(0, 10));
    setInsights(result);
    setIsInsightLoading(false);
  };

  if (!currentUser) return <Login users={users} onLogin={handleLogin} />;

  return (
    <Layout activeView={activeView} onViewChange={setActiveView} currentUser={currentUser} onLogout={handleLogout}>
      {activeView === 'tracker' && (
        <TrackerView 
          entries={entries.filter(e => e.userId === currentUser.id)}
          clients={clients} projects={projects} projectTasks={projectTasks}
          onAddEntry={handleAddEntry} onDeleteEntry={handleDeleteEntry} onUpdateEntry={handleUpdateEntry}
          insights={insights} isInsightLoading={isInsightLoading} onRefreshInsights={generateInsights}
          startOfWeek={settings.startOfWeek} treatSaturdayAsHoliday={settings.treatSaturdayAsHoliday}
          onMakeRecurring={handleMakeRecurring} userRole={currentUser.role}
        />
      )}
      {activeView === 'reports' && <Reports entries={entries.filter(e => e.userId === currentUser.id)} projects={projects} clients={clients} />}
      
      {activeView === 'clients' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
        <ClientsView clients={clients} onAddClient={addClient} />
      )}

      {activeView === 'projects' && (
        <ProjectsView 
          projects={projects} 
          clients={clients} 
          role={currentUser.role} 
          onAddProject={addProject} 
        />
      )}

      {activeView === 'tasks' && (
        <TasksView 
          tasks={projectTasks} 
          projects={projects} 
          role={currentUser.role} 
          onAddTask={addProjectTask} 
          onUpdateTask={handleUpdateTask}
        />
      )}
      
      {currentUser.role === 'admin' && activeView === 'users' && (
        <UserManagement users={users} onAddUser={addUser} onDeleteUser={deleteUser} currentUserId={currentUser.id} />
      )}

      {activeView === 'recurring' && <RecurringManager tasks={projectTasks} projects={projects} clients={clients} onAction={handleRecurringAction} />}
      {activeView === 'settings' && <Settings />}
    </Layout>
  );
};

export default App;
