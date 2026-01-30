import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { TimeEntry, Project, Client, User } from '../types';
import { COLORS } from '../constants';
import CustomSelect, { Option } from './shared/CustomSelect';

interface ReportsProps {
  entries: TimeEntry[];
  projects: Project[];
  clients: Client[];
  users: User[];
  currentUser: User;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  dailyGoal: number;
  currency: string;
}

type GroupingType = 'none' | 'date' | 'client' | 'project' | 'task';

// Helper to get local YYYY-MM-DD string
const toLocalISOString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const Reports: React.FC<ReportsProps> = ({
  entries,
  projects,
  clients,
  users,
  currentUser,
  startOfWeek,
  treatSaturdayAsHoliday,
  dailyGoal,
  currency,
}) => {
  const { t } = useTranslation('timesheets');

  // --- Dashboard State ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'detailed'>('dashboard');

  // Use a state for chart visibility to help ResponsiveContainer compute correctly after tab switch
  const [chartsVisible, setChartsVisible] = useState(false);
  useEffect(() => {
    if (activeTab === 'dashboard') {
      const timer = setTimeout(() => setChartsVisible(true), 100);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // --- Detailed Report State ---
  const [period, setPeriod] = useState('this_month');

  // Initial date calculation for state
  const getInitialDates = () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      start: toLocalISOString(start),
      end: toLocalISOString(end),
    };
  };

  const initialDates = getInitialDates();
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);

  const [filterUser, setFilterUser] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterTask, setFilterTask] = useState('all');
  const [noteSearch, setNoteSearch] = useState('');

  const hasActiveFilters =
    period !== 'this_month' ||
    startDate !== initialDates.start ||
    endDate !== initialDates.end ||
    filterUser !== 'all' ||
    filterClient !== 'all' ||
    filterProject !== 'all' ||
    filterTask !== 'all' ||
    noteSearch.trim() !== '';

  const canFilterUsers = currentUser.role === 'admin' || currentUser.role === 'manager';
  const canSeeCost = currentUser.role === 'manager'; // Only managers can see cost

  const [visibleFields, setVisibleFields] = useState({
    user: canFilterUsers,
    client: true,
    project: true,
    task: true,
    duration: true,
    notes: true,
    cost: canSeeCost,
  });

  const [grouping, setGrouping] = useState<GroupingType[]>(['none', 'none', 'none']);
  const [generatedEntries, setGeneratedEntries] = useState<TimeEntry[] | null>(null);

  // Options that depend on translations
  const PERIOD_OPTIONS: Option[] = [
    { id: 'custom', name: t('reports.custom') },
    { id: 'today', name: t('reports.today') },
    { id: 'yesterday', name: t('reports.yesterday') },
    { id: 'this_week', name: t('reports.thisWeek') },
    { id: 'last_week', name: t('reports.lastWeek') },
    { id: 'this_month', name: t('reports.thisMonth') },
    { id: 'last_month', name: t('reports.lastMonth') },
  ];

  const GROUP_OPTIONS: Option[] = [
    { id: 'none', name: t('reports.none') },
    { id: 'date', name: t('reports.date') },
    { id: 'client', name: t('reports.client') },
    { id: 'project', name: t('reports.project') },
    { id: 'task', name: t('reports.task') },
  ];

  // --- Dashboard Data Calculation ---
  const weeklyActivityData = useMemo(() => {
    const today = new Date();
    const currentDay = today.getDay(); // 0 is Sunday

    // Calculate the start of the week
    let offset = 0;
    if (startOfWeek === 'Monday') {
      offset = currentDay === 0 ? 6 : currentDay - 1;
    } else {
      offset = currentDay;
    }

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - offset);
    weekStart.setHours(0, 0, 0, 0);

    const data = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dateStr = toLocalISOString(d);

      const dayOfWeek = d.getDay();
      const isSunday = dayOfWeek === 0;
      const isSaturday = dayOfWeek === 6;

      // Skip Sundays and Saturdays (if treated as holiday)
      if (isSunday || (treatSaturdayAsHoliday && isSaturday)) {
        continue;
      }

      const isHoliday = false; // Remaining days are work days

      const hours = entries
        .filter((e) => e.date === dateStr)
        .reduce((sum, e) => sum + e.duration, 0);

      data.push({
        date: d.toLocaleDateString(undefined, { weekday: 'short' }),
        fullDate: dateStr,
        hours: hours,
        isFuture: d > today,
        isHoliday,
      });
    }
    return data;
  }, [entries, startOfWeek, treatSaturdayAsHoliday]);

  const projectData = useMemo(() => {
    return projects
      .map((p) => {
        const hours = entries
          .filter((e) => e.projectId === p.id)
          .reduce((sum, e) => sum + e.duration, 0);
        return { name: p.name, value: hours, color: p.color };
      })
      .filter((p) => p.value > 0);
  }, [entries, projects]);

  const totalHours = entries.reduce((sum, e) => sum + e.duration, 0);

  // --- Helpers ---
  const userOptions = useMemo(
    () => [
      { id: 'all', name: t('reports.allUsers') },
      ...users.map((u) => ({ id: u.id, name: u.name })),
    ],
    [users, t],
  );

  const clientOptions = useMemo(
    () => [
      { id: 'all', name: t('reports.allClients') },
      ...clients.map((c) => ({ id: c.id, name: c.name })),
    ],
    [clients, t],
  );

  // Synchronized Filter Logic
  const filteredProjects = useMemo(() => {
    if (filterClient === 'all') return projects;
    return projects.filter((p) => p.clientId === filterClient);
  }, [projects, filterClient]);

  const projectOptions = useMemo(
    () => [
      { id: 'all', name: t('reports.allProjects') },
      ...filteredProjects.map((p) => ({ id: p.id, name: p.name })),
    ],
    [filteredProjects, t],
  );

  const filteredTasks = useMemo(() => {
    let relevantEntries = entries;
    if (filterUser !== 'all') {
      relevantEntries = relevantEntries.filter((e) => e.userId === filterUser);
    }
    if (filterClient !== 'all') {
      relevantEntries = relevantEntries.filter((e) => e.clientId === filterClient);
    }
    if (filterProject !== 'all') {
      relevantEntries = relevantEntries.filter((e) => e.projectId === filterProject);
    }
    return Array.from(new Set(relevantEntries.map((e) => e.task))).sort();
  }, [entries, filterUser, filterClient, filterProject]);

  const taskOptions = useMemo(
    () => [
      { id: 'all', name: t('reports.allTasks') },
      ...filteredTasks.map((t) => ({ id: t, name: t })),
    ],
    [filteredTasks, t],
  );

  const handleClientChange = (val: string) => {
    setFilterClient(val);
    setFilterProject('all');
    setFilterTask('all');
  };

  const handleProjectChange = (val: string) => {
    setFilterProject(val);
    setFilterTask('all');
    if (val !== 'all') {
      const proj = projects.find((p) => p.id === val);
      if (proj) setFilterClient(proj.clientId);
    }
  };

  const handlePeriodChange = (val: string) => {
    setPeriod(val);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = new Date(today);
    let end = new Date(today);

    switch (val) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(today.getDate() - 1);
        end.setDate(today.getDate() - 1);
        break;
      case 'this_week': {
        const currentDay = today.getDay();
        let offset = 0;
        if (startOfWeek === 'Monday') {
          offset = currentDay === 0 ? 6 : currentDay - 1;
        } else {
          offset = currentDay;
        }
        start.setDate(today.getDate() - offset);
        end.setDate(start.getDate() + 6);
        break;
      }
      case 'last_week': {
        const currentDay = today.getDay();
        let offset = 0;
        if (startOfWeek === 'Monday') {
          offset = currentDay === 0 ? 6 : currentDay - 1;
        } else {
          offset = currentDay;
        }
        // Go back 1 week
        start.setDate(today.getDate() - offset - 7);
        end.setDate(start.getDate() + 6);
        break;
      }
      case 'this_month':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        break;
      case 'last_month':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      default:
        return; // For 'custom' we don't auto-set
    }

    setStartDate(toLocalISOString(start));
    setEndDate(toLocalISOString(end));
  };

  const handleClearFilters = () => {
    handlePeriodChange('this_month');
    setFilterUser('all');
    setFilterClient('all');
    setFilterProject('all');
    setFilterTask('all');
    setNoteSearch('');
  };

  const generateReport = () => {
    const filtered = entries.filter((e) => {
      const dateMatch = e.date >= startDate && e.date <= endDate;
      const userMatch = filterUser === 'all' || e.userId === filterUser;
      const clientMatch = filterClient === 'all' || e.clientId === filterClient;
      const projectMatch = filterProject === 'all' || e.projectId === filterProject;
      const taskMatch = filterTask === 'all' || e.task === filterTask;
      const noteMatch = !noteSearch || e.notes?.toLowerCase().includes(noteSearch.toLowerCase());
      return dateMatch && userMatch && clientMatch && projectMatch && taskMatch && noteMatch;
    });
    setGeneratedEntries(filtered.sort((a, b) => b.date.localeCompare(a.date)));
  };

  const getUserName = (userId: string) => {
    return users.find((u) => u.id === userId)?.name || t('reports.unknownUser');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Tab Switcher */}
      <div className="relative grid grid-cols-2 bg-slate-200/50 p-1 rounded-xl w-full max-w-85">
        <div
          className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            activeTab === 'dashboard' ? 'translate-x-0 left-1' : 'translate-x-full left-1'
          }`}
        ></div>
        <button
          onClick={() => {
            setChartsVisible(false);
            setActiveTab('dashboard');
          }}
          className={`relative z-10 w-full py-2 text-sm font-bold transition-colors duration-300 ${activeTab === 'dashboard' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {t('reports.dashboard')}
        </button>
        <button
          onClick={() => {
            setChartsVisible(false);
            setActiveTab('detailed');
          }}
          className={`relative z-10 w-full py-2 text-sm font-bold transition-colors duration-300 ${activeTab === 'detailed' ? 'text-praetor' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {t('reports.detailedReport')}
        </button>
      </div>

      {activeTab === 'dashboard' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm font-medium text-slate-500 mb-1">{t('reports.totalTracked')}</p>
              <p className="text-3xl font-bold text-slate-900">
                {totalHours.toFixed(1)}{' '}
                <span className="text-lg font-normal text-slate-400">{t('reports.hours')}</span>
              </p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm font-medium text-slate-500 mb-1">
                {t('reports.tasksCompleted')}
              </p>
              <p className="text-3xl font-bold text-slate-900">{entries.length}</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm font-medium text-slate-500 mb-1">
                {t('reports.mostActiveProject')}
              </p>
              <p className="text-3xl font-bold text-slate-900">
                {projectData.length > 0
                  ? [...projectData].sort((a, b) => b.value - a.value)[0].name
                  : 'N/A'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-85">
              <h3 className="text-lg font-bold text-slate-800 mb-6">
                {t('reports.weeklyActivity', { start: startOfWeek })}
              </h3>
              <div className="h-75 w-full" style={{ minWidth: '0px' }}>
                {chartsVisible && (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={weeklyActivityData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        domain={[0, (dataMax: number) => Math.max(dataMax, dailyGoal)]}
                      />
                      <RechartsTooltip
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                        formatter={(
                          value: number | string | Array<number | string> | undefined,
                          _name: string | undefined,
                          item: { payload?: { isHoliday?: boolean } },
                        ) => {
                          if (item && item.payload && item.payload.isHoliday) {
                            return ['N/A', 'Hours'];
                          }
                          return [`${value} hrs`, 'Hours'];
                        }}
                      />
                      <Bar dataKey="hours" fill="#272b3e" radius={[4, 4, 0, 0]} barSize={40}>
                        {weeklyActivityData.map((entry, index) => {
                          let color = '#272b3e'; // Default Praetor (Below Goal)

                          if (entry.isHoliday && entry.hours === 0) {
                            color = '#e2e8f0'; // Gray for empty holidays
                          } else if (entry.hours > dailyGoal) {
                            color = '#ef4444'; // Red (Above Goal)
                          } else if (Math.abs(entry.hours - dailyGoal) < 0.1 && dailyGoal > 0) {
                            color = '#22c55e'; // Green (At Goal)
                          }

                          return <Cell key={`cell-${index}`} fill={color} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-100">
              <h3 className="text-lg font-bold text-slate-800 mb-6">
                {t('reports.hoursByProject')}
              </h3>
              <div className="h-75 w-full" style={{ minWidth: '0px' }}>
                {chartsVisible && (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                      <Pie
                        data={projectData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {projectData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-praetor mb-4">
                  1. {t('reports.timePeriod')}
                </h4>
                <div className="space-y-4">
                  <CustomSelect
                    label={t('reports.selection')}
                    options={PERIOD_OPTIONS}
                    value={period}
                    onChange={(val) => handlePeriodChange(val as string)}
                    searchable={true}
                  />
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">
                        {t('reports.from')}
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          setPeriod('custom');
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">
                        {t('reports.to')}
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value);
                          setPeriod('custom');
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-praetor mb-4">
                  2. {t('reports.detailedFilters')}
                </h4>
                <div className="flex flex-col lg:flex-row lg:items-end gap-6">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      {canFilterUsers && (
                        <CustomSelect
                          label={t('reports.user')}
                          options={userOptions}
                          value={filterUser}
                          onChange={(val) => setFilterUser(val as string)}
                          searchable={true}
                        />
                      )}
                      <CustomSelect
                        label={t('reports.client')}
                        options={clientOptions}
                        value={filterClient}
                        onChange={(val) => handleClientChange(val as string)}
                        searchable={true}
                      />
                      <CustomSelect
                        label={t('reports.project')}
                        options={projectOptions}
                        value={filterProject}
                        onChange={(val) => handleProjectChange(val as string)}
                        searchable={true}
                      />
                    </div>
                    <div className="space-y-4">
                      <CustomSelect
                        label={t('reports.task')}
                        options={taskOptions}
                        value={filterTask}
                        onChange={(val) => setFilterTask(val as string)}
                        searchable={true}
                      />
                      <div>
                        <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">
                          {t('reports.notesContaining')}
                        </label>
                        <input
                          type="text"
                          value={noteSearch}
                          onChange={(e) => setNoteSearch(e.target.value)}
                          placeholder={t('reports.searchNotes')}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end lg:justify-start">
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      disabled={!hasActiveFilters}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                      {t('reports.clearFilters')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-praetor mb-4">
                  3. {t('reports.visibleFields')}
                </h4>
                <div className="flex flex-wrap gap-6">
                  {Object.entries(visibleFields).map(([key, value]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) =>
                          setVisibleFields({ ...visibleFields, [key]: e.target.checked })
                        }
                        className="rounded border-slate-300 text-praetor focus:ring-praetor"
                      />
                      <span className="text-xs font-bold text-slate-600 capitalize">{key}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-praetor mb-4">
                  4. {t('reports.grouping')}
                </h4>
                <div className="flex gap-4">
                  {[0, 1, 2].map((i) => (
                    <CustomSelect
                      key={i}
                      options={GROUP_OPTIONS}
                      value={grouping[i]}
                      onChange={(val) => {
                        const newG = [...grouping];
                        newG[i] = val as GroupingType;
                        setGrouping(newG as GroupingType[]);
                      }}
                      className="flex-1"
                      searchable={true}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-6 flex justify-center">
              <button
                onClick={generateReport}
                className="bg-praetor text-white px-12 py-3 rounded-xl font-bold hover:bg-slate-800 shadow-xl shadow-slate-200 transition-all active:scale-95 flex items-center gap-3"
              >
                <i className="fa-solid fa-file-invoice"></i>
                {t('reports.generateReport')}
              </button>
            </div>
          </div>

          {generatedEntries && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
              <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-black italic tracking-tighter">
                    PRAETOR{' '}
                    <span className="text-slate-400 font-normal not-italic tracking-normal text-sm ml-2">
                      {t('reports.detailedReportTitle')}
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                    {t('reports.generated')} {new Date().toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right flex items-center gap-6">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        {t('reports.grandTotal')}
                      </p>
                      <p className="text-2xl font-black text-white">
                        {generatedEntries.reduce((s, e) => s + e.duration, 0).toFixed(2)}{' '}
                        {t('reports.hours')}
                      </p>
                    </div>
                    {visibleFields.cost && (
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                          {t('reports.totalCost')}
                        </p>
                        <p className="text-2xl font-black text-emerald-400">
                          {currency}{' '}
                          {generatedEntries
                            .reduce((s, e) => s + (e.hourlyCost || 0) * e.duration, 0)
                            .toFixed(2)}
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!generatedEntries) return;

                      // 1. Define Headers
                      const headers = ['Date'];
                      if (visibleFields.user) headers.push('User');
                      if (visibleFields.client) headers.push('Client');
                      if (visibleFields.project) headers.push('Project');
                      if (visibleFields.task) headers.push('Task');
                      if (visibleFields.notes) headers.push('Note');
                      if (visibleFields.duration) headers.push('Duration (hrs)');
                      if (visibleFields.cost) headers.push('Cost');

                      // 2. Map Data
                      const csvRows = [headers.join(',')];

                      generatedEntries.forEach((e) => {
                        const row = [new Date(e.date).toLocaleDateString()];
                        if (visibleFields.user)
                          row.push(`"${getUserName(e.userId).replace(/"/g, '""')}"`);
                        if (visibleFields.client) row.push(`"${e.clientName.replace(/"/g, '""')}"`);
                        if (visibleFields.project)
                          row.push(`"${e.projectName.replace(/"/g, '""')}"`);
                        if (visibleFields.task) row.push(`"${e.task.replace(/"/g, '""')}"`);
                        if (visibleFields.notes) {
                          const safeNote = (e.notes || '').replace(/"/g, '""').replace(/\n/g, ' ');
                          row.push(`"${safeNote}"`);
                        }
                        if (visibleFields.duration) row.push(e.duration.toFixed(2));
                        if (visibleFields.cost) {
                          const cost = (e.hourlyCost || 0) * e.duration;
                          row.push(cost.toFixed(2));
                        }

                        csvRows.push(row.join(','));
                      });

                      // 3. Create Blob and Download
                      const csvString = csvRows.join('\n');
                      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.setAttribute(
                        'download',
                        `praetor_report_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`,
                      );
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="bg-praetor hover:bg-slate-800 text-white text-xs font-bold uppercase tracking-widest py-2 px-4 rounded-lg transition-colors border border-slate-600 hover:border-slate-500 shadow-lg shadow-slate-900/20"
                  >
                    <i className="fa-solid fa-download mr-2"></i>
                    {t('reports.exportCsv')}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                        {t('reports.date')}
                      </th>
                      {visibleFields.user && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                          {t('reports.user')}
                        </th>
                      )}
                      {visibleFields.client && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                          {t('reports.client')}
                        </th>
                      )}
                      {visibleFields.project && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                          {t('reports.project')}
                        </th>
                      )}
                      {visibleFields.task && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                          {t('reports.task')}
                        </th>
                      )}
                      {visibleFields.notes && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                          {t('reports.note')}
                        </th>
                      )}
                      {visibleFields.duration && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                          {t('reports.duration')}
                        </th>
                      )}
                      {visibleFields.cost && (
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                          {t('reports.cost')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {generatedEntries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                          {t('reports.noEntriesMatch')}
                        </td>
                      </tr>
                    ) : (
                      generatedEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-xs font-bold text-slate-600 whitespace-nowrap">
                            {new Date(e.date).toLocaleDateString()}
                          </td>
                          {visibleFields.user && (
                            <td className="px-6 py-4 text-xs font-bold text-praetor">
                              {getUserName(e.userId)}
                            </td>
                          )}
                          {visibleFields.client && (
                            <td className="px-6 py-4 text-xs font-medium text-slate-800">
                              {e.clientName}
                            </td>
                          )}
                          {visibleFields.project && (
                            <td className="px-6 py-4 text-xs font-medium text-slate-800">
                              {e.projectName}
                            </td>
                          )}
                          {visibleFields.task && (
                            <td className="px-6 py-4 text-xs font-bold text-slate-800">{e.task}</td>
                          )}
                          {visibleFields.notes && (
                            <td className="px-6 py-4 text-xs text-slate-500 italic max-w-xs truncate">
                              {e.notes || '-'}
                            </td>
                          )}
                          {visibleFields.duration && (
                            <td className="px-6 py-4 text-sm font-black text-slate-900 text-right">
                              {e.duration.toFixed(2)}
                            </td>
                          )}
                          {visibleFields.cost && (
                            <td className="px-6 py-4 text-sm font-black text-slate-900 text-right">
                              {currency} {((e.hourlyCost || 0) * e.duration).toFixed(2)}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;
