import { Save } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, Project, ProjectTask, TimeEntry, TimeEntryLocation } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { hasScopedActionPermission } from '../../utils/permissions';
import { formatRecurrencePattern } from '../../utils/recurrence';
import TaskFormModal, {
  type RecurringConfig,
  type TaskFormDetails,
} from '../projects/TaskFormModal';
import CustomRepeatModal from '../shared/CustomRepeatModal';
import SelectControl from '../shared/SelectControl';
import { Button } from '../ui/button';
import { Field, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import EntryCatalogSelector from './EntryCatalogSelector';
import { CUSTOM_TASK_SENTINEL, useCatalogSelection } from './useCatalogSelection';

type TimeEntryDraft = Omit<
  TimeEntry,
  'id' | 'createdAt' | 'version' | 'userId' | 'hourlyCost' | 'cost'
>;

export interface DailyViewProps {
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAdd: (entry: TimeEntryDraft) => void;
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
  onAddCustomTask: (
    name: string,
    projectId: string,
    recurringConfig?: RecurringConfig,
    description?: string,
    details?: TaskFormDetails,
  ) => Promise<ProjectTask>;
  currency: string;
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
  onAddCustomTask,
  currency,
}) => {
  const { t } = useTranslation('timesheets');
  const canCreateCustomTask = hasScopedActionPermission(permissions, 'projects.tasks', 'create');

  const [date, setDate] = useState(selectedDate || getLocalDateString());
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [errors, setErrors] = useState<{
    clientId?: string;
    projectId?: string;
    task?: string;
    recurrenceEndDate?: string;
  }>({});

  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<
    'daily' | 'weekly' | 'monthly' | string
  >('weekly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [isCustomRepeatModalOpen, setIsCustomRepeatModalOpen] = useState(false);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);

  const selection = useCatalogSelection({
    clients,
    projects,
    projectTasks,
    defaultLocation,
  });

  const handleDurationInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    if (rawValue !== '' && !/^[0-9]*([.,][0-9]*)?$/.test(rawValue)) return;
    setDuration(rawValue.replace(',', '.'));
  };

  const hasValidDuration = parseFloat(duration) > 0;

  useEffect(() => {
    if (selectedDate && selectedDate !== date) {
      setDate(selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, date]);

  const clearTaskError = () => {
    if (errors.task) setErrors((prev) => ({ ...prev, task: '' }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const newErrors: typeof errors = {};
    const durationVal = parseFloat(duration);

    if (!selection.clientId) newErrors.clientId = t('entry.clientRequired');
    if (!selection.projectId) newErrors.projectId = t('entry.projectRequired');
    if (!selection.taskName) {
      newErrors.task = t('entry.taskRequired');
    }

    if (makeRecurring && recurrenceEndDate && date && recurrenceEndDate < date) {
      newErrors.recurrenceEndDate = t('entry.endDateAfterStart');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const project = projects.find((p) => p.id === selection.projectId);
    const client = clients.find((c) => c.id === selection.clientId);

    onAdd({
      date,
      clientId: selection.clientId,
      clientName: client?.name || 'Unknown Client',
      projectId: selection.projectId,
      projectName: project?.name || 'General',
      task: selection.taskName,
      notes,
      duration: durationVal,
      location: selection.location,
    });

    if (makeRecurring && onMakeRecurring && selection.taskId) {
      onMakeRecurring(
        selection.taskId,
        recurrencePattern,
        date,
        recurrenceEndDate || undefined,
        durationVal,
      );
    }

    setDuration('');
    setNotes('');
    selection.resetLocation();
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

  const handleAddCustomTaskSubmit = async (
    taskName: string,
    taskProjectId: string,
    _recurringConfig: RecurringConfig | undefined,
    description: string,
    details: TaskFormDetails,
  ): Promise<ProjectTask> => {
    // If `onAddCustomTask` rejects, the throw propagates to TaskFormModal's submit handler,
    // which keeps the modal open and resets `isSubmitting` via its `finally`. No silent failure.
    const created = await onAddCustomTask(taskName, taskProjectId, undefined, description, details);
    // The fresh task may not be in `filteredTasks` yet (parent re-render hasn't flowed back),
    // so pass the name explicitly so the hook doesn't fall back to a stale lookup.
    selection.setTask(created.id, created.name);
    setMakeRecurring(false);
    setRecurrenceEndDate('');
    setRecurrencePattern('weekly');
    clearTaskError();
    return created;
  };

  const isExceedingGoal = useMemo(() => {
    const val = parseFloat(duration);
    if (Number.isNaN(val) || val <= 0) return false;
    return currentDayTotal + val > dailyGoal;
  }, [duration, currentDayTotal, dailyGoal]);

  // The "+ Custom Task..." option is only useful when a project is selected,
  // since the modal locks the project to the current selection.
  const allowCustomTask = canCreateCustomTask && selection.projectId !== '';

  return (
    <div className="rounded-lg border border-border bg-background shadow-sm p-5">
      <div className="flex justify-between items-center gap-4 mb-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-1">
              {t('entry.loggingFor')}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-none">
              <span className="text-base sm:text-lg font-black text-praetor uppercase">
                {new Date(date).toLocaleDateString(undefined, { weekday: 'long' })}
              </span>
              <span className="text-sm sm:text-base font-medium text-muted-foreground">
                {new Date(date).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
        {isExceedingGoal && (
          <div className="min-w-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 animate-in fade-in slide-in-from-right-4">
            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider leading-none truncate">
              {t('entry.warningExceedGoal', { goal: dailyGoal })}
            </p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <EntryCatalogSelector
          clients={clients}
          filteredProjects={selection.filteredProjects}
          filteredTasks={selection.filteredTasks}
          selectedClientId={selection.clientId}
          selectedProjectId={selection.projectId}
          selectedTaskId={selection.taskId}
          location={selection.location}
          onClientChange={(id) => {
            selection.setClient(id);
            if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
          }}
          onProjectChange={(id) => {
            selection.setProject(id);
            if (errors.projectId) setErrors((prev) => ({ ...prev, projectId: '' }));
          }}
          onTaskChange={(taskId) => {
            if (taskId === CUSTOM_TASK_SENTINEL) {
              setIsAddTaskModalOpen(true);
              return;
            }
            selection.setTask(taskId);
            clearTaskError();
          }}
          onLocationChange={selection.setLocation}
          allowCustomTask={allowCustomTask}
          errors={errors}
          className="xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_50px]"
          extraTrailing={
            <Field className="min-w-0">
              <FieldLabel htmlFor="daily-entry-hours">
                {t('entry.hours')} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="daily-entry-hours"
                type="text"
                inputMode="decimal"
                pattern="^[0-9]*([.,][0-9]*)?$"
                value={duration}
                onChange={handleDurationInputChange}
                placeholder="0.0"
                className="h-9 min-h-9 max-h-9 rounded-lg py-2"
              />
            </Field>
          }
        />

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
            <Button type="submit" disabled={!hasValidDuration} className="h-10 w-full rounded-lg">
              <Save className="size-4" aria-hidden="true" />
              {t('entry.logTime')}
            </Button>
          </div>
        </div>

        {selection.taskId && (
          <div
            className={`transition-all duration-300 border rounded-xl px-2 py-1 ${makeRecurring ? 'bg-muted/40 border-border' : 'bg-transparent border-transparent'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMakeRecurring(!makeRecurring)}
                className={`text-xs font-bold uppercase tracking-wide ${makeRecurring ? 'text-praetor hover:text-praetor' : 'text-muted-foreground'}`}
              >
                <i className={`fa-solid fa-repeat ${makeRecurring ? 'fa-spin' : ''}`}></i>
                {t('entry.repeatTask')}
              </Button>

              {makeRecurring && (
                <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                  <Separator orientation="vertical" className="hidden sm:block h-4 mx-1" />
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
                    buttonClassName="text-xs whitespace-nowrap"
                  />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {t('entry.until')}
                  </span>
                  <Input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => {
                      setRecurrenceEndDate(e.target.value);
                      if (errors.recurrenceEndDate)
                        setErrors((prev) => ({ ...prev, recurrenceEndDate: '' }));
                    }}
                    aria-invalid={!!errors.recurrenceEndDate}
                    className="text-xs font-medium shrink-0 w-auto"
                  />
                  {errors.recurrenceEndDate && (
                    <p className="text-destructive text-[10px] font-bold">
                      {errors.recurrenceEndDate}
                    </p>
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
      <TaskFormModal
        isOpen={isAddTaskModalOpen}
        onClose={() => setIsAddTaskModalOpen(false)}
        mode="add"
        projects={projects}
        clients={clients}
        currency={currency}
        canCreate={canCreateCustomTask}
        canUpdate={false}
        canDelete={false}
        onAdd={handleAddCustomTaskSubmit}
        onUpdate={() => {}}
        initialProjectId={selection.projectId}
        projectLocked={true}
      />
    </div>
  );
};

export default DailyView;
