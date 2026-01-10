
import React, { useState, useMemo, useEffect } from 'react';
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
  Legend 
} from 'recharts';
import { TimeEntry, Project, Client } from '../types';
import CustomSelect, { Option } from './CustomSelect';

interface ReportsProps {
  entries: TimeEntry[];
  projects: Project[];
  clients: Client[];
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  dailyGoal: number;
}

type GroupingType = 'none' | 'date' | 'client' | 'project' | 'task';

const PERIOD_OPTIONS: Option[] = [
  { id: 'custom', name: '--- Custom ---' },
  { id: 'today', name: 'Today' },
  { id: 'yesterday', name: 'Yesterday' },
  { id: 'this_week', name: 'This Week' },
  { id: 'last_week', name: 'Last Week' },
  { id: 'this_month', name: 'This Month' },
  { id: 'last_month', name: 'Last Month' },
];

const GROUP_OPTIONS: Option[] = [
  { id: 'none', name: '--- None ---' },
  { id: 'date', name: 'Date' },
  { id: 'client', name: 'Client' },
  { id: 'project', name: 'Project' },
  { id: 'task', name: 'Task' },
];

// Helper to get local YYYY-MM-DD string
const toLocalISOString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const Reports: React.FC<ReportsProps> = ({ entries, projects, clients, startOfWeek, treatSaturdayAsHoliday, dailyGoal }) => {
  // --- Dashboard State ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'detailed'>('dashboard');

  // Use a state for chart visibility to help ResponsiveContainer compute correctly after tab switch
  const [chartsVisible, setChartsVisible] = useState(false);
  useEffect(() => {
    if (activeTab === 'dashboard') {
      const timer = setTimeout(() => setChartsVisible(true), 100);
      return () => clearTimeout(timer);
    } else {
      setChartsVisible(false);
    }
  }, [activeTab]);

  // --- Detailed Report State ---
  const [period, setPeriod] = useState('this_month');
  
  // Initial date calculation for state
  const getInitialDates = () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date();
    return {
      start: toLocalISOString(start),
      end: toLocalISOString(end)
    };
  };

  const initialDates = getInitialDates();
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);
  
  const [filterClient, setFilterClient] = useState('all');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [filterTask, setFilterTask] = useState('all');
  const [noteSearch, setNoteSearch] = useState('');

  const [visibleFields, setVisibleFields] = useState({
    client: true,
    project: true,
    task: true,
    duration: true,
    notes: true
  });

  const [grouping, setGrouping] = useState<GroupingType[]>(['none', 'none', 'none']);
  const [generatedEntries, setGeneratedEntries] = useState<TimeEntry[] | null>(null);

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
        .filter(e => e.date === dateStr)
        .reduce((sum, e) => sum + e.duration, 0);
      
      data.push({
        date: d.toLocaleDateString(undefined, { weekday: 'short' }),
        fullDate: dateStr,
        hours: hours,
        isFuture: d > today,
        isHoliday
      });
    }
    return data;
  }, [entries, startOfWeek, treatSaturdayAsHoliday]);

  const projectData = useMemo(() => {
    return projects.map(p => {
      const hours = entries
        .filter(e => e.projectId === p.id)
        .reduce((sum, e) => sum + e.duration, 0);
      return { name: p.name, value: hours, color: p.color };
    }).filter(p => p.value > 0);
  }, [entries, projects]);

  const totalHours = entries.reduce((sum, e) => sum + e.duration, 0);

  // --- Helpers ---
  const uniqueTasks = useMemo(() => Array.from(new Set(entries.map(e => e.task))), [entries]);

  const clientOptions = useMemo(() => [
    { id: 'all', name: '--- All Clients ---' },
    ...clients.map(c => ({ id: c.id, name: c.name }))
  ], [clients]);

  const taskOptions = useMemo(() => [
    { id: 'all', name: '--- All Tasks ---' },
    ...uniqueTasks.map(t => ({ id: t, name: t }))
  ], [uniqueTasks]);

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

  const generateReport = () => {
    const filtered = entries.filter(e => {
      const dateMatch = e.date >= startDate && e.date <= endDate;
      const clientMatch = filterClient === 'all' || e.clientId === filterClient;
      const projectMatch = selectedProjectIds.length === 0 || selectedProjectIds.includes(e.projectId);
      const taskMatch = filterTask === 'all' || e.task === filterTask;
      const noteMatch = !noteSearch || (e.notes?.toLowerCase().includes(noteSearch.toLowerCase()));
      return dateMatch && clientMatch && projectMatch && taskMatch && noteMatch;
    });
    setGeneratedEntries(filtered.sort((a,b) => b.date.localeCompare(a.date)));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Tab Switcher */}
      <div className="relative grid grid-cols-2 bg-slate-200/50 p-1 rounded-xl w-full max-w-[340px]">
        <div 
          className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            activeTab === 'dashboard' ? 'translate-x-0 left-1' : 'translate-x-full left-1'
          }`}
        ></div>
        <button 
          onClick={() => setActiveTab('dashboard')}
          className={`relative z-10 w-full py-2 text-sm font-bold transition-colors duration-300 ${activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Dashboard
        </button>
        <button 
          onClick={() => setActiveTab('detailed')}
          className={`relative z-10 w-full py-2 text-sm font-bold transition-colors duration-300 ${activeTab === 'detailed' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Detailed Report
        </button>
      </div>

      {activeTab === 'dashboard' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm font-medium text-slate-500 mb-1">Total Tracked</p>
              <p className="text-3xl font-bold text-slate-900">{totalHours.toFixed(1)} <span className="text-lg font-normal text-slate-400">hrs</span></p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm font-medium text-slate-500 mb-1">Tasks Completed</p>
              <p className="text-3xl font-bold text-slate-900">{entries.length}</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-sm font-medium text-slate-500 mb-1">Most Active Project</p>
              <p className="text-3xl font-bold text-slate-900">
                {projectData.length > 0 ? [...projectData].sort((a,b) => b.value - a.value)[0].name : 'N/A'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
              <h3 className="text-lg font-bold text-slate-800 mb-6">Weekly Activity ({startOfWeek} Start)</h3>
              <div className="h-[300px] w-full" style={{ minWidth: '0px' }}>
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
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: any, name: string, item: any) => {
                          if (item && item.payload && item.payload.isHoliday) {
                            return ['N/A', 'Hours'];
                          }
                          return [`${value} hrs`, 'Hours'];
                        }}
                      />
                      <Bar 
                        dataKey="hours" 
                        fill="#6366f1" 
                        radius={[4, 4, 0, 0]} 
                        barSize={40} 
                      >
                         {weeklyActivityData.map((entry, index) => {
                           let color = '#6366f1'; // Default Purple (Below Goal)
                           
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

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
              <h3 className="text-lg font-bold text-slate-800 mb-6">Hours by Project</h3>
              <div className="h-[300px] w-full" style={{ minWidth: '0px' }}>
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
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                      <Legend verticalAlign="bottom" height={36}/>
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
                <h4 className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-4">1. Time Period</h4>
                <div className="space-y-4">
                  <CustomSelect 
                    label="Selection"
                    options={PERIOD_OPTIONS}
                    value={period}
                    onChange={handlePeriodChange}
                  />
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">From</label>
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={e => {
                          setStartDate(e.target.value);
                          setPeriod('custom');
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">To</label>
                      <input 
                        type="date" 
                        value={endDate} 
                        onChange={e => {
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
                <h4 className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-4">2. Detailed Filters</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <CustomSelect 
                      label="Client"
                      options={clientOptions}
                      value={filterClient}
                      onChange={setFilterClient}
                    />
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Projects</label>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-32 overflow-y-auto space-y-2">
                        {projects.map(p => (
                          <label key={p.id} className="flex items-center gap-2 cursor-pointer group">
                            <input 
                              type="checkbox" 
                              checked={selectedProjectIds.includes(p.id)}
                              onChange={e => {
                                if (e.target.checked) setSelectedProjectIds([...selectedProjectIds, p.id]);
                                else setSelectedProjectIds(selectedProjectIds.filter(id => id !== p.id));
                              }}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-xs text-slate-600 group-hover:text-slate-900">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <CustomSelect 
                      label="Task"
                      options={taskOptions}
                      value={filterTask}
                      onChange={setFilterTask}
                    />
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Notes Containing</label>
                      <input 
                        type="text" 
                        value={noteSearch} 
                        onChange={e => setNoteSearch(e.target.value)}
                        placeholder="Search notes..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-4">3. Visible Fields</h4>
                <div className="flex flex-wrap gap-6">
                  {Object.entries(visibleFields).map(([key, value]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={value}
                        onChange={e => setVisibleFields({...visibleFields, [key]: e.target.checked})}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-bold text-slate-600 capitalize">{key}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-4">4. Grouping</h4>
                <div className="flex gap-4">
                  {[0, 1, 2].map(i => (
                    <CustomSelect 
                      key={i}
                      options={GROUP_OPTIONS}
                      value={grouping[i]}
                      onChange={val => {
                        const newG = [...grouping];
                        newG[i] = val as GroupingType;
                        setGrouping(newG as GroupingType[]);
                      }}
                      className="flex-1"
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-6 flex justify-center">
              <button 
                onClick={generateReport}
                className="bg-indigo-600 text-white px-12 py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center gap-3"
              >
                <i className="fa-solid fa-file-invoice"></i>
                Generate Report
              </button>
            </div>
          </div>

          {generatedEntries && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
              <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-black italic tracking-tighter">TEMPO <span className="text-indigo-400 font-normal not-italic tracking-normal text-sm ml-2">DETAILED REPORT</span></h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Generated: {new Date().toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Grand Total</p>
                  <p className="text-2xl font-black text-indigo-400">{generatedEntries.reduce((s,e) => s+e.duration, 0).toFixed(2)} hrs</p>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Date</th>
                      {visibleFields.client && <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Client</th>}
                      {visibleFields.project && <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Project</th>}
                      {visibleFields.task && <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Task</th>}
                      {visibleFields.notes && <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Note</th>}
                      {visibleFields.duration && <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Dur.</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {generatedEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">No entries match your filters.</td>
                      </tr>
                    ) : generatedEntries.map(e => (
                      <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-xs font-bold text-slate-600 whitespace-nowrap">{new Date(e.date).toLocaleDateString()}</td>
                        {visibleFields.client && <td className="px-6 py-4 text-xs font-medium text-slate-800">{e.clientName}</td>}
                        {visibleFields.project && <td className="px-6 py-4 text-xs font-medium text-slate-800">{e.projectName}</td>}
                        {visibleFields.task && <td className="px-6 py-4 text-xs font-bold text-slate-800">{e.task}</td>}
                        {visibleFields.notes && <td className="px-6 py-4 text-xs text-slate-500 italic max-w-xs truncate">{e.notes || '-'}</td>}
                        {visibleFields.duration && <td className="px-6 py-4 text-sm font-black text-slate-900 text-right">{e.duration.toFixed(2)}</td>}
                      </tr>
                    ))}
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
