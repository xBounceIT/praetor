import { Save } from 'lucide-react';
import type React from 'react';
import { useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Client, Project, ProjectTask, TimeEntry } from '../../types';
import { hasScopedActionPermission } from '../../utils/permissions';
import { toastError } from '../../utils/toast';
import {
  EXPIRED_PROJECT_TIME_ENTRY_PERMISSION,
  filterTrackerEntrySelectableCatalogs,
} from '../../utils/trackerCatalogs';
import TaskFormModal, {
  type RecurringConfig,
  type TaskFormDetails,
} from '../projects/TaskFormModal';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import EntryCatalogSelector from './EntryCatalogSelector';
import { CUSTOM_TASK_SENTINEL, useCatalogSelection } from './useCatalogSelection';

export interface EntryEditDialogProps {
  entry: TimeEntry | null;
  onClose: () => void;
  onSave: (
    id: string,
    updates: Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>,
  ) => Promise<void> | void;
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  permissions: string[];
  currency: string;
  onAddCustomTask: (
    name: string,
    projectId: string,
    recurringConfig?: RecurringConfig,
    description?: string,
    details?: TaskFormDetails,
  ) => Promise<ProjectTask>;
}

// `key={entry.id}` forces a fresh hook state per entry — without it, useCatalogSelection
// would carry stale selection across opens.
const EntryEditDialog: React.FC<EntryEditDialogProps> = ({ entry, ...rest }) =>
  entry ? <EntryEditDialogContent key={entry.id} entry={entry} {...rest} /> : null;

interface ContentProps extends Omit<EntryEditDialogProps, 'entry'> {
  entry: TimeEntry;
}

type EntryEditErrors = {
  clientId?: string;
  projectId?: string;
  task?: string;
};

type EntryEditState = {
  duration: string;
  notes: string;
  errors: EntryEditErrors;
  isSubmitting: boolean;
  isAddTaskModalOpen: boolean;
};

type EntryEditAction =
  | { type: 'setDuration'; duration: string }
  | { type: 'setNotes'; notes: string }
  | { type: 'setErrors'; errors: EntryEditErrors }
  | { type: 'clearError'; field: keyof EntryEditErrors }
  | { type: 'setSubmitting'; isSubmitting: boolean }
  | { type: 'setAddTaskModalOpen'; isOpen: boolean };

const entryEditReducer = (state: EntryEditState, action: EntryEditAction): EntryEditState => {
  switch (action.type) {
    case 'setDuration':
      return { ...state, duration: action.duration };
    case 'setNotes':
      return { ...state, notes: action.notes };
    case 'setErrors':
      return { ...state, errors: action.errors };
    case 'clearError':
      if (!state.errors[action.field]) return state;
      return { ...state, errors: { ...state.errors, [action.field]: '' } };
    case 'setSubmitting':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'setAddTaskModalOpen':
      return { ...state, isAddTaskModalOpen: action.isOpen };
  }
};

const getInitialEntryEditState = (entry: TimeEntry): EntryEditState => ({
  duration: String(entry.duration),
  notes: entry.notes ?? '',
  errors: {},
  isSubmitting: false,
  isAddTaskModalOpen: false,
});

const EntryEditDialogContent: React.FC<ContentProps> = ({
  entry,
  onClose,
  onSave,
  clients,
  projects,
  projectTasks,
  permissions,
  currency,
  onAddCustomTask,
}) => {
  const { t } = useTranslation(['timesheets', 'common']);
  const canCreateCustomTask = hasScopedActionPermission(permissions, 'projects.tasks', 'create');
  const editSelectorPermissions = useMemo(
    () =>
      permissions.includes(EXPIRED_PROJECT_TIME_ENTRY_PERMISSION)
        ? permissions
        : [...permissions, EXPIRED_PROJECT_TIME_ENTRY_PERMISSION],
    [permissions],
  );
  const selectableCatalogs = useMemo(
    () =>
      filterTrackerEntrySelectableCatalogs({
        clients,
        projects,
        projectTasks,
        permissions: editSelectorPermissions,
      }),
    [clients, editSelectorPermissions, projectTasks, projects],
  );

  // Resolve a missing taskId via name lookup so legacy/orphan entries (FK never set)
  // still seed a real catalog id rather than '', which would render an empty dropdown.
  const seededTaskId =
    entry.taskId ??
    projectTasks.find((t) => t.projectId === entry.projectId && t.name === entry.task)?.id ??
    '';

  const selection = useCatalogSelection({
    clients: selectableCatalogs.clients,
    projects: selectableCatalogs.projects,
    projectTasks: selectableCatalogs.projectTasks,
    defaultLocation: entry.location || 'remote',
    initialSelection: {
      clientId: entry.clientId,
      projectId: entry.projectId,
      taskId: seededTaskId,
      taskName: entry.task,
    },
  });

  const [state, dispatch] = useReducer(entryEditReducer, entry, getInitialEntryEditState);
  const { duration, notes, errors, isSubmitting, isAddTaskModalOpen } = state;

  const allowCustomTask = canCreateCustomTask && selection.projectId !== '';

  const clearTaskError = () => {
    dispatch({ type: 'clearError', field: 'task' });
  };

  const handleAddCustomTaskSubmit = async (
    taskName: string,
    taskProjectId: string,
    _recurringConfig: RecurringConfig | undefined,
    description: string,
    details: TaskFormDetails,
  ): Promise<ProjectTask> => {
    const created = await onAddCustomTask(taskName, taskProjectId, undefined, description, details);
    selection.setTask(created.id, created.name);
    clearTaskError();
    return created;
  };

  const parsedDuration = parseFloat(duration);
  // Backend accepts duration >= 0 (placeholders carry 0); blank means "untouched".
  const isDurationBlank = duration.trim() === '';
  const hasValidDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0;
  const durationChanged = !isDurationBlank && hasValidDuration && parsedDuration !== entry.duration;
  const durationInvalid = !isDurationBlank && !hasValidDuration;

  const catalogChanged =
    selection.clientId !== entry.clientId ||
    selection.projectId !== entry.projectId ||
    selection.taskName !== entry.task;
  const isDirty =
    catalogChanged ||
    selection.location !== entry.location ||
    durationChanged ||
    (notes || '') !== (entry.notes ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: EntryEditErrors = {};
    if (!selection.clientId) newErrors.clientId = t('entry.clientRequired');
    if (!selection.projectId) newErrors.projectId = t('entry.projectRequired');
    if (!selection.taskName) newErrors.task = t('entry.taskRequired');

    if (Object.keys(newErrors).length > 0 || durationInvalid) {
      dispatch({ type: 'setErrors', errors: newErrors });
      return;
    }

    // (clientId, projectId, task) is a tuple on the server — send all three together when
    // any one changes so the backend never validates against a stale field. Display names
    // (clientName, projectName) are derived server-side from the IDs.
    const patch: Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'> = {
      version: entry.version,
    };
    if (catalogChanged) {
      patch.clientId = selection.clientId;
      patch.projectId = selection.projectId;
      patch.task = selection.taskName;
    }
    if (durationChanged) patch.duration = parsedDuration;
    if ((notes || '') !== (entry.notes ?? '')) patch.notes = notes;
    if (selection.location !== entry.location) patch.location = selection.location;

    dispatch({ type: 'setSubmitting', isSubmitting: true });
    try {
      if (Object.keys(patch).length > 1) {
        await onSave(entry.id, patch);
      }
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('entry.entryUpdateFailed'));
    } finally {
      dispatch({ type: 'setSubmitting', isSubmitting: false });
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} ariaLabel={t('entry.editEntry')}>
      <ModalContent size="xl">
        <ModalHeader>
          <ModalTitle>{t('entry.editEntry')}</ModalTitle>
          <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
        </ModalHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <ModalBody className="space-y-4">
            <EntryCatalogSelector
              clients={selectableCatalogs.clients}
              filteredProjects={selection.filteredProjects}
              filteredTasks={selection.filteredTasks}
              selectedClientId={selection.clientId}
              selectedProjectId={selection.projectId}
              selectedTaskId={selection.taskId}
              location={selection.location}
              onClientChange={(id) => {
                selection.setClient(id);
                dispatch({ type: 'clearError', field: 'clientId' });
              }}
              onProjectChange={(id) => {
                selection.setProject(id);
                dispatch({ type: 'clearError', field: 'projectId' });
              }}
              onTaskChange={(taskId) => {
                if (taskId === CUSTOM_TASK_SENTINEL) {
                  dispatch({ type: 'setAddTaskModalOpen', isOpen: true });
                  return;
                }
                selection.setTask(taskId);
                clearTaskError();
              }}
              onLocationChange={selection.setLocation}
              allowCustomTask={allowCustomTask}
              errors={errors}
              // Override the default 5-column layout — the dialog is much narrower than
              // DailyView, so a 2-column grid keeps the dropdown values fully readable.
              className="grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-2"
            />

            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_110px] gap-4 items-start">
              <Field className="min-w-0">
                <FieldLabel htmlFor="entry-edit-notes">{t('entry.notesDescription')}</FieldLabel>
                <Input
                  id="entry-edit-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => dispatch({ type: 'setNotes', notes: e.target.value })}
                  placeholder={t('entry.notesPlaceholder')}
                  className="h-10 rounded-lg"
                  // Kept in sync with server MAX_NOTES_LENGTH (server/services/timeEntries.ts).
                  maxLength={2000}
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="entry-edit-hours">
                  {t('entry.hours')} <RequiredMark />
                </FieldLabel>
                <ValidatedNumberInput
                  id="entry-edit-hours"
                  value={duration}
                  onValueChange={(value) => dispatch({ type: 'setDuration', duration: value })}
                  placeholder="0,0"
                  aria-invalid={durationInvalid}
                  className={cn(
                    'h-10 rounded-lg text-right tabular-nums',
                    durationInvalid && 'border-destructive focus-visible:ring-destructive',
                  )}
                />
              </Field>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty || durationInvalid}>
              <Save className="size-4" aria-hidden="true" />
              {t('common:buttons.save')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
      <TaskFormModal
        isOpen={isAddTaskModalOpen}
        onClose={() => dispatch({ type: 'setAddTaskModalOpen', isOpen: false })}
        mode="add"
        projects={selectableCatalogs.projects}
        clients={selectableCatalogs.clients}
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
    </Modal>
  );
};

export default EntryEditDialog;
