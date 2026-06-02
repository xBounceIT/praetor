import { Save } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Client, Project, ProjectTask, TimeEntryLocation } from '../../types';
import { hasScopedActionPermission } from '../../utils/permissions';
import TaskFormModal, {
  type RecurringConfig,
  type TaskFormDetails,
} from '../projects/TaskFormModal';
import { Button } from '../ui/button';
import { Field, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import EntryCatalogSelector from './EntryCatalogSelector';
import { CUSTOM_TASK_SENTINEL, type UseCatalogSelectionResult } from './useCatalogSelection';

export interface WeeklyEntryFormErrors {
  clientId?: string;
  projectId?: string;
  task?: string;
}

export interface WeeklyEntryFormProps {
  selectedDate: string;
  selection: UseCatalogSelectionResult;
  weekNote: string;
  errors: WeeklyEntryFormErrors;
  onWeekNoteChange: (value: string) => void;
  onClearError: (field: 'clientId' | 'projectId' | 'task') => void;
  clients: Client[];
  projects: Project[];
  permissions: string[];
  currency: string;
  onAddCustomTask: (
    name: string,
    projectId: string,
    recurringConfig?: RecurringConfig,
    description?: string,
    details?: TaskFormDetails,
  ) => Promise<ProjectTask>;
  defaultLocation?: TimeEntryLocation;
  onSubmit: () => void;
  isSubmitting: boolean;
  showSubmitSuccess: boolean;
  canSubmit: boolean;
}

const WeeklyEntryForm: React.FC<WeeklyEntryFormProps> = ({
  selectedDate,
  selection,
  weekNote,
  errors,
  onWeekNoteChange,
  onClearError,
  clients,
  projects,
  permissions,
  currency,
  onAddCustomTask,
  onSubmit,
  isSubmitting,
  showSubmitSuccess,
  canSubmit,
}) => {
  const { t } = useTranslation('timesheets');
  const canCreateCustomTask = hasScopedActionPermission(permissions, 'projects.tasks', 'create');
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const allowCustomTask = canCreateCustomTask && selection.projectId !== '';

  const handleAddCustomTaskSubmit = async (
    taskName: string,
    taskProjectId: string,
    _recurringConfig: RecurringConfig | undefined,
    description: string,
    details: TaskFormDetails,
  ): Promise<ProjectTask> => {
    const created = await onAddCustomTask(taskName, taskProjectId, undefined, description, details);
    selection.setTask(created.id, created.name);
    onClearError('task');
    return created;
  };

  const dateForDisplay = new Date(selectedDate);

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
                {dateForDisplay.toLocaleDateString(undefined, { weekday: 'long' })}
              </span>
              <span className="text-sm sm:text-base font-medium text-muted-foreground">
                {dateForDisplay.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
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
            onClearError('clientId');
          }}
          onProjectChange={(id) => {
            selection.setProject(id);
            onClearError('projectId');
          }}
          onTaskChange={(taskId) => {
            if (taskId === CUSTOM_TASK_SENTINEL) {
              setIsAddTaskModalOpen(true);
              return;
            }
            selection.setTask(taskId);
            onClearError('task');
          }}
          onLocationChange={selection.setLocation}
          allowCustomTask={allowCustomTask}
          errors={errors}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_180px] gap-4 items-end">
          <Field className="min-w-0">
            <FieldLabel htmlFor="weekly-form-week-note">{t('weekly.weekNoteLabel')}</FieldLabel>
            <Input
              id="weekly-form-week-note"
              type="text"
              value={weekNote}
              onChange={(e) => onWeekNoteChange(e.target.value)}
              placeholder={t('weekly.weekNotePlaceholder')}
              className="h-10 rounded-lg"
              // Kept in sync with server MAX_NOTES_LENGTH (server/services/timeEntries.ts).
              maxLength={2000}
            />
          </Field>

          <div className="min-w-0 flex items-end">
            <Button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting || !canSubmit}
              className={cn(
                'h-10 w-full rounded-lg',
                showSubmitSuccess && 'bg-emerald-600 hover:bg-emerald-600',
              )}
            >
              <Save className="size-4" aria-hidden="true" />
              {showSubmitSuccess ? t('weekly.success') : t('weekly.submitTime')}
            </Button>
          </div>
        </div>
      </div>

      <TaskFormModal
        isOpen={isAddTaskModalOpen}
        onClose={() => setIsAddTaskModalOpen(false)}
        mode="add"
        projects={projects}
        clients={clients}
        currency={currency}
        permissions={{
          canCreate: canCreateCustomTask,
          canUpdate: false,
          canDelete: false,
        }}
        onAdd={handleAddCustomTaskSubmit}
        onUpdate={() => {}}
        initialProjectId={selection.projectId}
        projectLocked={true}
      />
    </div>
  );
};

export default WeeklyEntryForm;
