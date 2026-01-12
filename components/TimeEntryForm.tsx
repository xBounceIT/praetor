
import React, { useState, useEffect, useMemo } from 'react';
import { Client, Project, ProjectTask, TimeEntry, UserRole } from '../types';
import { parseSmartEntry } from '../services/geminiService';
import CustomSelect from './CustomSelect';
import CustomRepeatModal from './CustomRepeatModal';

interface TimeEntryFormProps {
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAdd: (entry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>) => void;
  selectedDate: string;
  onMakeRecurring?: (taskId: string, pattern: 'daily' | 'weekly' | 'monthly', startDate?: string, endDate?: string, duration?: number) => void;
  userRole: UserRole;
  dailyGoal: number;
  currentDayTotal: number;
}

// Helper to format custom pattern
const getRecurrenceLabel = (pattern: string) => {
  if (pattern === 'daily') return 'Daily';
  if (pattern === 'weekly') return 'Weekly';
  if (pattern === 'monthly') return 'Monthly';

  if (pattern.startsWith('monthly:')) {
    const parts = pattern.split(':');
    if (parts.length === 3) {
      const type = parts[1]; // first/second/third/fourth/last
      const day = parseInt(parts[2]);
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      // Capitalize type
      const typeStr = type.charAt(0).toUpperCase() + type.slice(1);
      return `Every ${typeStr} ${days[day]}`;
    }
  }
  return 'Custom...';
};

const TimeEntryForm: React.FC<TimeEntryFormProps> = ({
  clients,
  projects,
  projectTasks,
  onAdd,
  selectedDate,
  onMakeRecurring,
  userRole,
  dailyGoal,
  currentDayTotal
}) => {
  const [isSmartMode, setIsSmartMode] = useState(false);
  const [smartInput, setSmartInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Manual fields
  const [date, setDate] = useState(selectedDate || new Date().toISOString().split('T')[0]);
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || '');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [errors, setErrors] = useState<{ hours?: string }>({});

  // New user controls
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<'daily' | 'weekly' | 'monthly' | string>('weekly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [isCustomRepeatModalOpen, setIsCustomRepeatModalOpen] = useState(false);

  // Sync internal date when calendar selection changes
  useEffect(() => {
    if (selectedDate) {
      setDate(selectedDate);
    }
  }, [selectedDate]);

  // Init client selection when clients load
  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  // Filter projects when client changes
  const filteredProjects = projects.filter(p => p.clientId === selectedClientId);

  // Filter tasks when project changes
  const filteredTasks = projectTasks.filter(t => t.projectId === selectedProjectId);

  // Auto-select first project/task when lists change
  useEffect(() => {
    if (filteredProjects.length > 0) {
      setSelectedProjectId(filteredProjects[0].id);
    } else {
      setSelectedProjectId('');
    }
  }, [selectedClientId, projects]);

  useEffect(() => {
    if (filteredTasks.length > 0) {
      setSelectedTaskName(filteredTasks[0].name);
      setSelectedTaskId(filteredTasks[0].id);
    } else {
      setSelectedTaskName('');
      setSelectedTaskId('');
    }
  }, [selectedProjectId, projectTasks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const durationVal = parseFloat(duration);
    if (!duration || isNaN(durationVal) || durationVal <= 0) {
      setErrors({ hours: 'Hours are required and must be greater than 0' });
      return;
    }

    if (!selectedTaskName || !selectedProjectId) return;

    const project = projects.find(p => p.id === selectedProjectId);
    const client = clients.find(c => c.id === selectedClientId);

    onAdd({
      date,
      clientId: selectedClientId,
      clientName: client?.name || 'Unknown Client',
      projectId: selectedProjectId,
      projectName: project?.name || 'General',
      task: selectedTaskName,
      notes,
      duration: durationVal,
    });

    // Handle recursion if checked
    if (makeRecurring && onMakeRecurring && selectedTaskId) {
      onMakeRecurring(selectedTaskId, recurrencePattern, date, recurrenceEndDate || undefined, durationVal);
    }

    // Reset form
    setDuration('');
    setNotes('');
    setMakeRecurring(false);
    setRecurrenceEndDate('');
    setRecurrencePattern('weekly');
    setErrors({});
  };

  const handleRecurrenceChange = (val: string) => {
    if (val === 'custom') {
      setIsCustomRepeatModalOpen(true);
    } else {
      setRecurrencePattern(val as any);
    }
  };

  const handleSmartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smartInput.trim()) return;

    setIsLoading(true);
    const parsed = await parseSmartEntry(smartInput);
    setIsLoading(false);

    if (parsed) {
      const projectMatch = projects.find(p => p.name.toLowerCase().includes(parsed.project.toLowerCase()));
      const clientMatch = projectMatch ? clients.find(c => c.id === projectMatch.clientId) : clients[0];

      onAdd({
        date: date,
        clientId: clientMatch?.id || 'c1',
        clientName: clientMatch?.name || 'General',
        projectId: projectMatch?.id || projects[0]?.id || 'p1',
        projectName: projectMatch?.name || projects[0]?.name || 'General',
        task: parsed.task,
        notes: parsed.notes || '',
        duration: parsed.duration,
      });
      setSmartInput('');
      setIsSmartMode(false);
    } else {
      alert("Couldn't parse that. Try something like 'Spent 2 hours on design for Acme Corp'");
    }
  };

  const handleTaskChange = (taskId: string) => {
    if (taskId === 'custom') {
      setSelectedTaskName('custom');
      setSelectedTaskId('');
      setMakeRecurring(false);
    } else {
      const task = filteredTasks.find(t => t.id === taskId);
      if (task) {
        setSelectedTaskName(task.name);
        setSelectedTaskId(task.id);
      }
    }
  };

  const isExceedingGoal = useMemo(() => {
    const val = parseFloat(duration);
    if (isNaN(val) || val <= 0) return false;
    return (currentDayTotal + val) > dailyGoal;
  }, [duration, currentDayTotal, dailyGoal]);

  const canCreateCustomTask = userRole === 'admin' || userRole === 'manager';

  const clientOptions = clients.map(c => ({ id: c.id, name: c.name }));
  const projectOptions = filteredProjects.map(p => ({ id: p.id, name: p.name }));
  const taskOptions = useMemo(() => {
    const opts = filteredTasks.map(t => ({ id: t.id, name: t.name }));
    if (canCreateCustomTask) {
      opts.push({ id: 'custom', name: '+ Custom Task...' });
    }
    return opts;
  }, [filteredTasks, canCreateCustomTask]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            {isSmartMode ? 'Magic Entry (AI)' : 'Log Time'}
          </h3>
          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded uppercase tracking-tight">
            For {new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <button
          onClick={() => setIsSmartMode(!isSmartMode)}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 underline underline-offset-4"
        >
          {isSmartMode ? 'Switch to Manual' : 'Switch to Magic Input'}
        </button>
      </div>

      {isSmartMode ? (
        <form onSubmit={handleSmartSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={smartInput}
              onChange={(e) => setSmartInput(e.target.value)}
              placeholder="e.g., '3 hours on Frontend Dev for Website Redesign with some extra notes'"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all pr-12 text-slate-700"
              disabled={isLoading}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isLoading ? (
                <i className="fa-solid fa-circle-notch fa-spin text-indigo-500"></i>
              ) : (
                <i className="fa-solid fa-wand-magic-sparkles text-slate-300"></i>
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading || !smartInput}
            className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            Log with AI
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-1">
              <CustomSelect
                label="Client"
                options={clientOptions}
                value={selectedClientId}
                onChange={setSelectedClientId}
                searchable={true}
              />
            </div>
            <div className="md:col-span-1">
              <CustomSelect
                label="Project"
                options={projectOptions}
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                placeholder={filteredProjects.length === 0 ? "No projects" : "Select project..."}
                searchable={true}
              />
            </div>
            <div className="md:col-span-2">
              <CustomSelect
                label="Task"
                options={taskOptions}
                value={selectedTaskId || (selectedTaskName === 'custom' ? 'custom' : '')}
                onChange={handleTaskChange}
                placeholder={filteredTasks.length === 0 && !canCreateCustomTask ? "No tasks" : "Select task..."}
                searchable={true}
              />
              {selectedTaskName === 'custom' && canCreateCustomTask && (
                <input
                  type="text"
                  autoFocus
                  placeholder="Type custom task name..."
                  value={selectedTaskName === 'custom' ? '' : selectedTaskName}
                  onChange={(e) => { setSelectedTaskName(e.target.value); setSelectedTaskId(''); }}
                  className="mt-2 w-full px-3 py-2 bg-white border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm animate-in fade-in slide-in-from-top-1 duration-200"
                />
              )}
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Hours <span className="text-red-500">*</span></label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                  if (errors.hours) setErrors({});
                }}
                placeholder="0.0"
                className={`w-full px-3 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-bold transition-colors ${errors.hours ? 'border-red-500 focus:ring-red-200 bg-red-50' : 'border-slate-200 focus:ring-indigo-500'}`}
              />
              {errors.hours && <p className="text-[10px] text-red-500 mt-1 font-bold animate-in fade-in">{errors.hours}</p>}
            </div>
          </form>

          <div className="flex flex-col gap-4">
            <div className="w-full">
              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Notes / Description</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details about the task..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
              />
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="flex-1">
                {isExceedingGoal && (
                  <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-left-4">
                    <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                    <p className="text-[10px] font-bold text-amber-700 uppercase leading-none">
                      Warning: This entry will exceed your daily goal of {dailyGoal} hours.
                    </p>
                  </div>
                )}
                {selectedTaskId && (
                  <div className={`transition-all duration-300 border rounded-xl py-1 ${makeRecurring ? 'bg-indigo-50 border-indigo-100' : 'bg-transparent border-transparent'}`}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setMakeRecurring(!makeRecurring)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${makeRecurring ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                      >
                        <i className={`fa-solid fa-repeat ${makeRecurring ? 'fa-spin' : ''}`}></i>
                        Repeat Task?
                      </button>

                      {makeRecurring && (
                        <div className="flex items-center gap-2 px-2 animate-in fade-in slide-in-from-left-2 duration-200">
                          <div className="h-4 w-px bg-indigo-200 mx-1"></div>
                          <div className="min-w-[180px]">
                            <CustomSelect
                              options={[
                                { id: 'daily', name: 'Daily' },
                                { id: 'weekly', name: 'Weekly' },
                                { id: 'monthly', name: 'Monthly' },
                                { id: 'custom', name: recurrencePattern.startsWith('monthly:') ? getRecurrenceLabel(recurrencePattern) : 'Custom...' }
                              ]}
                              value={recurrencePattern.startsWith('monthly:') ? 'custom' : recurrencePattern}
                              onChange={handleRecurrenceChange}
                              className="text-xs"
                              placeholder="Pattern..."
                              buttonClassName="bg-white border border-indigo-200 text-indigo-700 font-medium py-2 px-2 text-xs"
                            />
                          </div>
                          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider ml-6">Until</span>
                          <input
                            type="date"
                            value={recurrenceEndDate}
                            onChange={(e) => setRecurrenceEndDate(e.target.value)}
                            className="text-xs bg-white border border-indigo-200 text-indigo-700 font-medium rounded-md px-2 py-2 outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleSubmit}
                className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg font-bold text-sm flex items-center gap-2 whitespace-nowrap"
              >
                <i className="fa-solid fa-check"></i> Log Time
              </button>
            </div>
          </div>
        </div>
      )}
      <CustomRepeatModal
        isOpen={isCustomRepeatModalOpen}
        onClose={() => setIsCustomRepeatModalOpen(false)}
        onSave={(pattern) => {
          setRecurrencePattern(pattern);
          setIsCustomRepeatModalOpen(false);
        }}
      />
    </div>
  );
};

export default TimeEntryForm;
