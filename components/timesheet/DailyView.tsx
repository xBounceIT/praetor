import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import type { Client, Project, ProjectTask, TimeEntry, TimeEntryLocation } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { buildPermission, hasAnyPermission } from '../../utils/permissions';
import CustomRepeatModal from '../shared/CustomRepeatModal';
import CustomSelect from '../shared/CustomSelect';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface DailyViewProps {
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAdd: (entry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>) => void;
  selectedDate: string;
  onMakeRecurring?: (
    taskId: string,
    pattern: 'daily' | 'weekly' | 'monthly' | string,
    startDate?: string,
    endDate?: string,
    duration?: number,
  ) => void;
  permissions: string[];
  dailyGoal: number;
  currentDayTotal: number;
  enableAiSmartEntry: boolean;
  defaultLocation?: TimeEntryLocation;
}

// Helper to format custom pattern - needs to be inside component to use translations

const DailyView: React.FC<DailyViewProps> = ({
  clients,
  projects,
  projectTasks,
  onAdd,
  selectedDate,
  onMakeRecurring,
  permissions,
  dailyGoal,
  currentDayTotal,
  enableAiSmartEntry,
  defaultLocation = 'remote',
}) => {
  const { t } = useTranslation('timesheets');

  // Helper to format custom pattern
  const getRecurrenceLabel = (pattern: string) => {
    if (pattern === 'daily') return t('entry.recurrencePatterns.daily');
    if (pattern === 'weekly') return t('entry.recurrencePatterns.weekly');
    if (pattern === 'monthly') return t('entry.recurrencePatterns.monthly');

    if (pattern.startsWith('monthly:')) {
      const parts = pattern.split(':');
      if (parts.length === 3) {
        const type = parts[1]; // first/second/third/fourth/last
        const day = parseInt(parts[2], 10);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = days[day];
        const typeKey =
          `entry.recurrencePatterns.every${type.charAt(0).toUpperCase() + type.slice(1)}` as keyof typeof t;
        return t(typeKey, { day: dayName });
      }
    }
    return t('entry.recurrencePatterns.custom');
  };

  const [isSmartMode, setIsSmartMode] = useState(false);
  const [smartInput, setSmartInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Pivot back to manual mode if AI is disabled
  useEffect(() => {
    if (!enableAiSmartEntry) {
      setIsSmartMode(false);
    }
  }, [enableAiSmartEntry]);

  // Manual fields
  const [date, setDate] = useState(selectedDate || getLocalDateString());
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || '');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [location, setLocation] = useState<TimeEntryLocation>(defaultLocation);
  const [errors, setErrors] = useState<{
    hours?: string;
    clientId?: string;
    projectId?: string;
    task?: string;
    smartInput?: string;
    recurrenceEndDate?: string;
  }>({});
  const [smartError, setSmartError] = useState('');

  // New user controls
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<
    'daily' | 'weekly' | 'monthly' | string
  >('weekly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [isCustomRepeatModalOpen, setIsCustomRepeatModalOpen] = useState(false);

  const handleDurationChange = (value: string) => {
    setDuration(value);
    if (errors.hours) setErrors({ ...errors, hours: '' });
  };

  // Sync internal date when calendar selection changes
  useEffect(() => {
    if (selectedDate && selectedDate !== date) {
      setDate(selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, date]);

  // Init client selection when clients load
  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, selectedClientId]);

  // Filter projects when client changes
  const filteredProjects = projects.filter((p) => p.clientId === selectedClientId);
  const firstFilteredProjectId = filteredProjects[0]?.id ?? '';

  // Filter tasks when project changes
  const filteredTasks = projectTasks.filter((t) => t.projectId === selectedProjectId);
  const firstFilteredTaskId = filteredTasks[0]?.id ?? '';
  const firstFilteredTaskName = filteredTasks[0]?.name ?? '';

  // Auto-select first project/task when lists change
  useEffect(() => {
    if (filteredProjects.length > 0) {
      if (selectedProjectId !== firstFilteredProjectId) {
        setSelectedProjectId(firstFilteredProjectId);
      }
    } else if (selectedProjectId !== '') {
      setSelectedProjectId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProjects.length, firstFilteredProjectId, selectedProjectId]);

  useEffect(() => {
    if (filteredTasks.length > 0) {
      if (selectedTaskId !== firstFilteredTaskId) {
        setSelectedTaskName(firstFilteredTaskName);
        setSelectedTaskId(firstFilteredTaskId);
      }
    } else if (selectedTaskId !== '') {
      setSelectedTaskName('');
      setSelectedTaskId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks.length, firstFilteredTaskId, firstFilteredTaskName, selectedTaskId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const newErrors: typeof errors = {};

    // Validate duration
    const durationVal = parseFloat(duration);
    if (!duration || Number.isNaN(durationVal) || durationVal <= 0) {
      newErrors.hours = t('entry.hoursRequired');
    }

    // Validate client/project/task
    if (!selectedClientId) newErrors.clientId = t('entry.clientRequired');
    if (!selectedProjectId) newErrors.projectId = t('entry.projectRequired');
    if (!selectedTaskName || (!selectedTaskId && !selectedTaskName)) {
      newErrors.task = t('entry.taskRequired');
    }

    // Validate recurrence date if enabled
    if (makeRecurring && recurrenceEndDate && date && recurrenceEndDate < date) {
      newErrors.recurrenceEndDate = t('entry.endDateAfterStart');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const project = projects.find((p) => p.id === selectedProjectId);
    const client = clients.find((c) => c.id === selectedClientId);

    onAdd({
      date,
      clientId: selectedClientId,
      clientName: client?.name || 'Unknown Client',
      projectId: selectedProjectId,
      projectName: project?.name || 'General',
      task: selectedTaskName,
      notes,
      duration: durationVal,
      location,
    });

    // Handle recursion if checked
    if (makeRecurring && onMakeRecurring && selectedTaskId) {
      onMakeRecurring(
        selectedTaskId,
        recurrencePattern,
        date,
        recurrenceEndDate || undefined,
        durationVal,
      );
    }

    // Reset form
    setDuration('');
    setNotes('');
    setLocation(defaultLocation);
    setMakeRecurring(false);
    setRecurrenceEndDate('');
    setRecurrencePattern('weekly');
    setErrors({});
  };

  const handleRecurrenceChange = (val: string) => {
    if (val === 'custom') {
      setIsCustomRepeatModalOpen(true);
    } else {
      setRecurrencePattern(val as 'daily' | 'weekly' | 'monthly' | string);
    }
  };

  const handleSmartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmartError('');

    if (!smartInput.trim()) {
      setSmartError(t('entry.pleaseEnterDescription'));
      return;
    }

    setIsLoading(true);
    setSmartError('');

    try {
      const parsed = await api.ai.parseSmartEntry(smartInput);
      setIsLoading(false);

      if (parsed && parsed.duration > 0) {
        const projectMatch = projects.find((p) =>
          p.name.toLowerCase().includes(parsed.project.toLowerCase()),
        );
        const clientMatch = projectMatch
          ? clients.find((c) => c.id === projectMatch.clientId)
          : clients[0];

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
        setSmartError(t('entry.couldntParse'));
      }
    } catch (err) {
      setIsLoading(false);
      setSmartError((err as Error).message || t('entry.couldntParse'));
    }
  };

  const handleTaskChange = (taskId: string) => {
    if (taskId === 'custom') {
      setSelectedTaskName('custom');
      setSelectedTaskId('');
      setMakeRecurring(false);
    } else {
      const task = filteredTasks.find((t) => t.id === taskId);
      if (task) {
        setSelectedTaskName(task.name);
        setSelectedTaskId(task.id);
      }
    }
    if (errors.task) setErrors({ ...errors, task: '' });
  };

  const isExceedingGoal = useMemo(() => {
    const val = parseFloat(duration);
    if (Number.isNaN(val) || val <= 0) return false;
    return currentDayTotal + val > dailyGoal;
  }, [duration, currentDayTotal, dailyGoal]);

  const canCreateCustomTask = hasAnyPermission(permissions, [
    buildPermission('projects.tasks', 'create'),
  ]);

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  const projectOptions = filteredProjects.map((p) => ({ id: p.id, name: p.name }));
  const taskOptions = useMemo(() => {
    const opts = filteredTasks.map((t) => ({ id: t.id, name: t.name }));
    if (canCreateCustomTask) {
      opts.push({ id: 'custom', name: t('entry.customTask') });
    }
    return opts;
  }, [filteredTasks, canCreateCustomTask, t]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-bold uppercase tracking-wider text-slate-400 leading-none mb-0.5">
              {t('entry.loggingFor')}
            </span>
            <div className="flex items-baseline gap-1.5 leading-none">
              <span className="text-lg font-black text-praetor uppercase">
                {new Date(date).toLocaleDateString(undefined, { weekday: 'long' })}
              </span>
              <span className="text-lg font-medium text-slate-400">
                {new Date(date).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
        {enableAiSmartEntry && (
          <button
            onClick={() => setIsSmartMode(!isSmartMode)}
            className="text-xs font-medium text-praetor hover:text-slate-700 underline underline-offset-4"
          >
            {isSmartMode ? t('entry.switchToManual') : t('entry.switchToMagicInput')}
          </button>
        )}
      </div>

      {isSmartMode ? (
        <form onSubmit={handleSmartSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={smartInput}
              onChange={(e) => {
                setSmartInput(e.target.value);
                if (smartError) setSmartError('');
              }}
              placeholder="e.g., '3 hours on Frontend Dev for Website Redesign with some extra notes'"
              className={`w-full px-4 py-3 bg-slate-50 border rounded-lg focus:ring-2 outline-none transition-all pr-12 text-slate-700 ${smartError ? 'border-red-500 focus:ring-red-200 bg-red-50' : 'border-slate-200 focus:ring-praetor'}`}
              disabled={isLoading}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isLoading ? (
                <i className="fa-solid fa-circle-notch fa-spin text-praetor"></i>
              ) : (
                <i className="fa-solid fa-wand-magic-sparkles text-slate-300"></i>
              )}
            </div>
            {smartError && (
              <p className="text-red-500 text-[10px] font-bold mt-1 animate-in fade-in">
                {smartError}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || !smartInput}
            className="w-full py-3 bg-praetor text-white font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {t('entry.logWithAi')}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-[2fr_2fr_2fr_1.5fr_1fr] gap-4"
          >
            <div>
              <CustomSelect
                label={t('entry.client')}
                options={clientOptions}
                value={selectedClientId}
                onChange={(val) => {
                  setSelectedClientId(val as string);
                  if (errors.clientId) setErrors({ ...errors, clientId: '' });
                }}
                searchable={true}
                className={errors.clientId ? 'border-red-300' : ''}
              />
              {errors.clientId && (
                <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.clientId}</p>
              )}
            </div>
            <div>
              <CustomSelect
                label={t('entry.project')}
                options={projectOptions}
                value={selectedProjectId}
                onChange={(val) => {
                  setSelectedProjectId(val as string);
                  if (errors.projectId) setErrors({ ...errors, projectId: '' });
                }}
                placeholder={
                  filteredProjects.length === 0 ? t('entry.noProjects') : t('entry.selectProject')
                }
                searchable={true}
                className={errors.projectId ? 'border-red-300' : ''}
              />
              {errors.projectId && (
                <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.projectId}</p>
              )}
            </div>
            <div>
              <CustomSelect
                label={t('entry.task')}
                options={taskOptions}
                value={selectedTaskId || (selectedTaskName === 'custom' ? 'custom' : '')}
                onChange={(val) => handleTaskChange(val as string)}
                placeholder={
                  filteredTasks.length === 0 && !canCreateCustomTask
                    ? t('entry.noTasks')
                    : t('entry.selectTask')
                }
                searchable={true}
                className={errors.task ? 'border-red-300' : ''}
              />
              {errors.task && (
                <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.task}</p>
              )}
              {selectedTaskName === 'custom' && canCreateCustomTask && (
                <input
                  type="text"
                  autoFocus
                  placeholder={t('entry.typeCustomTask')}
                  value={selectedTaskName === 'custom' ? '' : selectedTaskName}
                  onChange={(e) => {
                    setSelectedTaskName(e.target.value);
                    setSelectedTaskId('');
                    if (errors.task) setErrors({ ...errors, task: '' });
                  }}
                  className="mt-2 w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm animate-in fade-in slide-in-from-top-1 duration-200"
                />
              )}
            </div>
            <div>
              <CustomSelect
                label={t('entry.location')}
                options={[
                  { id: 'office', name: t('entry.locationTypes.office') },
                  { id: 'customer_premise', name: t('entry.locationTypes.customerPremise') },
                  { id: 'remote', name: t('entry.locationTypes.remote') },
                  { id: 'transfer', name: t('entry.locationTypes.transfer') },
                ]}
                value={location}
                onChange={(val) => setLocation(val as TimeEntryLocation)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">
                {t('entry.hours')} <span className="text-red-500">*</span>
              </label>
              <ValidatedNumberInput
                value={duration}
                onValueChange={handleDurationChange}
                placeholder="0.0"
                className={`w-full px-3 py-2.5 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-bold transition-colors ${errors.hours ? 'border-red-500 focus:ring-red-200 bg-red-50' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.hours && (
                <p className="text-[10px] text-red-500 mt-1 font-bold animate-in fade-in">
                  {errors.hours}
                </p>
              )}
            </div>
          </form>

          <div className="flex flex-col gap-4">
            <div className="w-full">
              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">
                {t('entry.notesDescription')}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('entry.notesPlaceholder')}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm"
              />
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="flex-1">
                {isExceedingGoal && (
                  <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-left-4">
                    <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                    <p className="text-[10px] font-bold text-amber-700 uppercase leading-none">
                      {t('entry.warningExceedGoal', { goal: dailyGoal })}
                    </p>
                  </div>
                )}
                {selectedTaskId && (
                  <div
                    className={`transition-all duration-300 border rounded-xl py-1 ${makeRecurring ? 'bg-slate-50 border-slate-200' : 'bg-transparent border-transparent'}`}
                  >
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setMakeRecurring(!makeRecurring)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${makeRecurring ? 'text-praetor' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                      >
                        <i className={`fa-solid fa-repeat ${makeRecurring ? 'fa-spin' : ''}`}></i>
                        {t('entry.repeatTask')}
                      </button>

                      {makeRecurring && (
                        <div className="flex items-center gap-2 px-2 animate-in fade-in slide-in-from-left-2 duration-200">
                          <div className="h-4 w-px bg-slate-200 mx-1"></div>
                          <div className="min-w-[180px]">
                            <CustomSelect
                              options={[
                                { id: 'daily', name: t('entry.recurrencePatterns.daily') },
                                { id: 'weekly', name: t('entry.recurrencePatterns.weekly') },
                                { id: 'monthly', name: t('entry.recurrencePatterns.monthly') },
                                {
                                  id: 'custom',
                                  name: recurrencePattern.startsWith('monthly:')
                                    ? getRecurrenceLabel(recurrencePattern)
                                    : t('entry.recurrencePatterns.custom'),
                                },
                              ]}
                              value={
                                recurrencePattern.startsWith('monthly:')
                                  ? 'custom'
                                  : recurrencePattern
                              }
                              onChange={(val) => handleRecurrenceChange(val as string)}
                              className="text-xs"
                              placeholder="Pattern..."
                              buttonClassName="bg-white border border-slate-200 text-praetor font-medium py-2 px-2 text-xs"
                            />
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-6">
                            {t('entry.until')}
                          </span>
                          <input
                            type="date"
                            value={recurrenceEndDate}
                            onChange={(e) => {
                              setRecurrenceEndDate(e.target.value);
                              if (errors.recurrenceEndDate)
                                setErrors({ ...errors, recurrenceEndDate: '' });
                            }}
                            className={`text-xs bg-white border rounded-md px-2 py-2 outline-none focus:ring-1 ${errors.recurrenceEndDate ? 'border-red-500 focus:ring-red-200 bg-red-50' : 'border-slate-200 text-praetor focus:ring-praetor'} font-medium`}
                          />
                          {errors.recurrenceEndDate && (
                            <p className="text-red-500 text-[10px] font-bold mt-1">
                              {errors.recurrenceEndDate}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleSubmit}
                className="bg-praetor text-white px-6 py-2.5 rounded-xl hover:bg-slate-700 transition-all shadow-md hover:shadow-lg font-bold text-sm flex items-center gap-2 whitespace-nowrap"
              >
                <i className="fa-solid fa-check"></i> {t('entry.logTime')}
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

export default DailyView;
