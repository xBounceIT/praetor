import { Save } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Client, Project, ProjectTask, TimeEntry } from '../../types';
import { hasScopedActionPermission } from '../../utils/permissions';
import { toastError } from '../../utils/toast';
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
import EntryCatalogSelector from './EntryCatalogSelector';
import { CUSTOM_TASK_SENTINEL, useCatalogSelection } from './useCatalogSelection';

export interface EntryEditDialogProps {
  entry: TimeEntry | null;
  onClose: () => void;
  onSave: (id: string, updates: Partial<TimeEntry>) => Promise<void> | void;
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

  const selection = useCatalogSelection({
    clients,
    projects,
    projectTasks,
    defaultLocation: entry.location || 'remote',
    initialSelection: {
      clientId: entry.clientId,
      projectId: entry.projectId,
      taskId: entry.taskId ?? '',
      taskName: entry.task,
    },
  });

  const [duration, setDuration] = useState(String(entry.duration));
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [errors, setErrors] = useState<{
    clientId?: string;
    projectId?: string;
    task?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);

  const allowCustomTask = canCreateCustomTask && selection.projectId !== '';

  const handleDurationInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    if (rawValue !== '' && !/^[0-9]*([.,][0-9]*)?$/.test(rawValue)) return;
    setDuration(rawValue.replace(',', '.'));
  };

  const clearTaskError = () => {
    if (errors.task) setErrors((prev) => ({ ...prev, task: '' }));
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
  // Backend accepts duration >= 0 (placeholders carry 0); only block on blank/NaN.
  const hasValidDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0;

  const catalogChanged =
    selection.clientId !== entry.clientId ||
    selection.projectId !== entry.projectId ||
    selection.taskName !== entry.task;
  const isDirty =
    catalogChanged ||
    selection.location !== entry.location ||
    (hasValidDuration && parsedDuration !== entry.duration) ||
    (notes || '') !== (entry.notes ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!selection.clientId) newErrors.clientId = t('entry.clientRequired');
    if (!selection.projectId) newErrors.projectId = t('entry.projectRequired');
    if (!selection.taskName) newErrors.task = t('entry.taskRequired');

    if (Object.keys(newErrors).length > 0 || !hasValidDuration) {
      setErrors(newErrors);
      return;
    }

    // (clientId, projectId, task) is a tuple on the server — send all three together when
    // any one changes so the backend never validates against a stale field.
    const patch: Partial<TimeEntry> = {};
    if (catalogChanged) {
      const project = projects.find((p) => p.id === selection.projectId);
      const client = clients.find((c) => c.id === selection.clientId);
      patch.clientId = selection.clientId;
      patch.clientName = client?.name || entry.clientName;
      patch.projectId = selection.projectId;
      patch.projectName = project?.name || entry.projectName;
      patch.task = selection.taskName;
    }
    if (parsedDuration !== entry.duration) patch.duration = parsedDuration;
    if ((notes || '') !== (entry.notes ?? '')) patch.notes = notes;
    if (selection.location !== entry.location) patch.location = selection.location;

    setIsSubmitting(true);
    try {
      if (Object.keys(patch).length > 0) {
        await onSave(entry.id, patch);
      }
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('entry.entryUpdateFailed'));
    } finally {
      setIsSubmitting(false);
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
              extraTrailing={
                <Field className="min-w-0">
                  <FieldLabel htmlFor="entry-edit-hours">
                    {t('entry.hours')} <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="entry-edit-hours"
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

            <Field className="min-w-0">
              <FieldLabel htmlFor="entry-edit-notes">{t('entry.notesDescription')}</FieldLabel>
              <Input
                id="entry-edit-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('entry.notesPlaceholder')}
                className="h-10 rounded-lg"
              />
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty || !hasValidDuration}>
              <Save className="size-4" aria-hidden="true" />
              {t('common:buttons.save')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
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
    </Modal>
  );
};

export default EntryEditDialog;
