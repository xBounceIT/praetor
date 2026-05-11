import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, Project, ProjectTask, TimeEntry, TimeEntryLocation } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { hasScopedActionPermission } from '../../utils/permissions';
import { formatRecurrencePattern } from '../../utils/recurrence';
import CustomRepeatModal from '../shared/CustomRepeatModal';
import SelectControl from '../shared/SelectControl';
import { Button } from '../ui/button';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

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
  defaultLocation?: TimeEntryLocation;
}

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
  defaultLocation = 'remote',
}) => {
  const { t } = useTranslation('timesheets');

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
    recurrenceEndDate?: string;
  }>({});

  // New user controls
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<
    'daily' | 'weekly' | 'monthly' | string
  >('weekly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [isCustomRepeatModalOpen, setIsCustomRepeatModalOpen] = useState(false);

  const handleDurationChange = (value: string) => {
    setDuration(value);
    if (errors.hours) setErrors((prev) => ({ ...prev, hours: '' }));
  };

  const canCreateCustomTask = hasScopedActionPermission(permissions, 'projects.tasks', 'create');

  const handleDurationInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    if (rawValue !== '' && !/^[0-9]*([.,][0-9]*)?$/.test(rawValue)) return;
    handleDurationChange(rawValue.replace(',', '.'));
  };

  // Sync internal date when calendar selection changes
  useEffect(() => {
    if (selectedDate && selectedDate !== date) {
      setDate(selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, date]);

  // Keep client selection valid when RBAC-scoped catalogs change.
  useEffect(() => {
    if (clients.length === 0) {
      if (selectedClientId !== '') setSelectedClientId('');
      return;
    }

    if (!clients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  // Filter projects when client changes
  const filteredProjects = useMemo(
    () => projects.filter((p) => p.clientId === selectedClientId),
    [projects, selectedClientId],
  );
  const firstFilteredProjectId = filteredProjects[0]?.id ?? '';

  // Filter tasks when project changes
  const filteredTasks = useMemo(
    () => projectTasks.filter((t) => t.projectId === selectedProjectId),
    [projectTasks, selectedProjectId],
  );
  const firstFilteredTaskId = filteredTasks[0]?.id ?? '';
  const firstFilteredTaskName = filteredTasks[0]?.name ?? '';

  // Keep project/task selections valid when the selected client or scoped catalogs change.
  useEffect(() => {
    if (filteredProjects.length === 0) {
      if (selectedProjectId !== '') {
        setSelectedProjectId('');
      }
      return;
    }

    if (!filteredProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(firstFilteredProjectId);
    }
  }, [filteredProjects, firstFilteredProjectId, selectedProjectId]);

  useEffect(() => {
    if (filteredTasks.length === 0) {
      if (selectedTaskName === 'custom' && canCreateCustomTask && selectedProjectId !== '') {
        return;
      }
      if (selectedTaskId !== '' || selectedTaskName !== '') {
        setSelectedTaskId('');
        setSelectedTaskName('');
      }
      return;
    }

    if (!filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskName(firstFilteredTaskName);
      setSelectedTaskId(firstFilteredTaskId);
    }
  }, [
    filteredTasks,
    firstFilteredTaskId,
    firstFilteredTaskName,
    selectedTaskId,
    selectedTaskName,
    canCreateCustomTask,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (selectedProjectId === '') {
      if (selectedTaskId !== '' || selectedTaskName !== '') {
        setSelectedTaskName('');
        setSelectedTaskId('');
      }
      return;
    }

    if (selectedTaskId && !filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskName(firstFilteredTaskName);
      setSelectedTaskId(firstFilteredTaskId);
    }
  }, [
    selectedProjectId,
    selectedTaskId,
    filteredTasks,
    firstFilteredTaskId,
    firstFilteredTaskName,
    selectedTaskName,
  ]);

  useEffect(() => {
    if (selectedClientId === '') {
      setSelectedProjectId('');
    }
  }, [selectedClientId]);

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
    if (errors.task) setErrors((prev) => ({ ...prev, task: '' }));
  };

  const isExceedingGoal = useMemo(() => {
    const val = parseFloat(duration);
    if (Number.isNaN(val) || val <= 0) return false;
    return currentDayTotal + val > dailyGoal;
  }, [duration, currentDayTotal, dailyGoal]);

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
    <div className="bg-white rounded-lg shadow-sm border border-zinc-200 p-5">
      <div className="flex justify-between items-start gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 leading-none mb-1">
              {t('entry.loggingFor')}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-none">
              <span className="text-base sm:text-lg font-black text-praetor uppercase">
                {new Date(date).toLocaleDateString(undefined, { weekday: 'long' })}
              </span>
              <span className="text-sm sm:text-base font-medium text-zinc-400">
                {new Date(date).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_50px] gap-4 items-start">
          <div className="min-w-0">
            <SelectControl
              label={t('entry.client')}
              options={clientOptions}
              value={selectedClientId}
              onChange={(val) => {
                setSelectedClientId(val as string);
                if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
              }}
              searchable={true}
              className={errors.clientId ? 'border-red-300' : ''}
            />
            {errors.clientId && (
              <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.clientId}</p>
            )}
          </div>

          <div className="min-w-0">
            <SelectControl
              label={t('entry.project')}
              options={projectOptions}
              value={selectedProjectId}
              onChange={(val) => {
                setSelectedProjectId(val as string);
                if (errors.projectId) setErrors((prev) => ({ ...prev, projectId: '' }));
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

          <div className="min-w-0">
            <SelectControl
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
                placeholder={t('entry.typeCustomTask')}
                value={selectedTaskName === 'custom' ? '' : selectedTaskName}
                onChange={(e) => {
                  setSelectedTaskName(e.target.value);
                  setSelectedTaskId('');
                  if (errors.task) setErrors((prev) => ({ ...prev, task: '' }));
                }}
                className="mt-2 w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm animate-in fade-in slide-in-from-top-1 duration-200"
              />
            )}
          </div>

          <div className="min-w-0">
            <SelectControl
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

          <Field className="min-w-0" data-invalid={!!errors.hours}>
            <FieldLabel htmlFor="daily-entry-hours">
              {t('entry.hours')} <span className="text-red-500">*</span>
            </FieldLabel>
            <Input
              id="daily-entry-hours"
              type="text"
              inputMode="decimal"
              pattern="^[0-9]*([.,][0-9]*)?$"
              value={duration}
              onChange={handleDurationInputChange}
              placeholder="0.0"
              aria-invalid={!!errors.hours}
              className="h-9 min-h-9 max-h-9 rounded-lg py-2"
            />
            <FieldError>{errors.hours}</FieldError>
          </Field>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_180px] gap-4 items-end">
          <Field className="min-w-0">
            <FieldLabel htmlFor="daily-entry-notes">{t('entry.notesDescription')}</FieldLabel>
            <Input
              id="daily-entry-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('entry.notesPlaceholder')}
              className="h-10 rounded-lg"
            />
          </Field>

          <div className="min-w-0 flex items-end">
            <Button type="submit" className="h-10 w-full rounded-lg">
              {t('entry.logTime')}
            </Button>
          </div>
        </div>

        {isExceedingGoal && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-left-4">
            <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
            <p className="text-[10px] font-bold text-amber-700 uppercase leading-none">
              {t('entry.warningExceedGoal', { goal: dailyGoal })}
            </p>
          </div>
        )}

        {selectedTaskId && (
          <div
            className={`transition-all duration-300 border rounded-xl px-2 py-1 ${makeRecurring ? 'bg-zinc-50 border-zinc-200' : 'bg-transparent border-transparent'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMakeRecurring(!makeRecurring)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${makeRecurring ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'}`}
              >
                <i className={`fa-solid fa-repeat ${makeRecurring ? 'fa-spin' : ''}`}></i>
                {t('entry.repeatTask')}
              </button>

              {makeRecurring && (
                <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                  <div className="hidden sm:block h-4 w-px bg-zinc-200 mx-1 shrink-0"></div>
                  <SelectControl
                    options={[
                      { id: 'daily', name: t('entry.recurrencePatterns.daily') },
                      { id: 'weekly', name: t('entry.recurrencePatterns.weekly') },
                      { id: 'monthly', name: t('entry.recurrencePatterns.monthly') },
                      {
                        id: 'custom',
                        name: recurrencePattern.startsWith('monthly:')
                          ? formatRecurrencePattern(recurrencePattern, t)
                          : t('entry.recurrencePatterns.custom'),
                      },
                    ]}
                    value={recurrencePattern.startsWith('monthly:') ? 'custom' : recurrencePattern}
                    onChange={(val) => handleRecurrenceChange(val as string)}
                    className="text-xs min-w-[120px]"
                    placeholder="Pattern..."
                    buttonClassName="bg-white border border-zinc-200 text-praetor font-medium p-2 text-xs whitespace-nowrap"
                  />
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    {t('entry.until')}
                  </span>
                  <input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => {
                      setRecurrenceEndDate(e.target.value);
                      if (errors.recurrenceEndDate)
                        setErrors((prev) => ({ ...prev, recurrenceEndDate: '' }));
                    }}
                    className={`text-xs bg-white border rounded-md p-2 outline-none focus:ring-1 shrink-0 ${errors.recurrenceEndDate ? 'border-red-500 focus:ring-red-200 bg-red-50' : 'border-zinc-200 text-praetor focus:ring-praetor'} font-medium`}
                  />
                  {errors.recurrenceEndDate && (
                    <p className="text-red-500 text-[10px] font-bold">{errors.recurrenceEndDate}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </form>
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
