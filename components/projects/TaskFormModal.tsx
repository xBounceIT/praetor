import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useBillingFrequencyOptions, useBillingTypeOptions } from '@/hooks/useBillingOptions';
import {
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  toStoredBillingType,
} from '@/utils/billing';
import type {
  BillingFrequency,
  Client,
  Project,
  ProjectTask,
  StoredBillingType,
} from '../../types';
import { formatNumber } from '../../utils/numbers';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import Toggle from '../shared/Toggle';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;
const formatTaskNumber = (value: number, minimumFractionDigits = 0) =>
  formatNumber(value, {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  });

export type RecurringConfig = { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' };

export type TaskFormDetails = Pick<
  ProjectTask,
  'monthlyEffort' | 'duration' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
>;

export type TaskFormPermissions = {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  editingTask?: ProjectTask | null;
  projects: Project[];
  clients: Client[];
  currency: string;
  permissions: TaskFormPermissions;
  onAdd: (
    name: string,
    projectId: string,
    recurringConfig: RecurringConfig | undefined,
    description: string,
    details: TaskFormDetails,
  ) => Promise<ProjectTask>;
  onUpdate: (id: string, updates: Partial<ProjectTask>) => Promise<void> | void;
  onDelete?: () => void;
  onViewOrder?: (orderId: string) => void;
  initialProjectId?: string;
  projectLocked?: boolean;
}

type TaskFormState = {
  name: string;
  projectId: string;
  description: string;
  billingType: StoredBillingType;
  billingFrequency: BillingFrequency;
  monthlyEffort: string;
  duration: string;
  revenue: string;
  notes: string;
  tempIsDisabled: boolean;
  isSubmitting: boolean;
};

type TaskFormTextField =
  | 'name'
  | 'description'
  | 'monthlyEffort'
  | 'duration'
  | 'revenue'
  | 'notes';

type TaskFormAction =
  | { type: 'setTextField'; field: TaskFormTextField; value: string }
  | {
      type: 'selectProject';
      projectId: string;
      billing?: ReturnType<typeof deriveBillingFromProject>;
    }
  | { type: 'setBillingType'; billingType: StoredBillingType }
  | { type: 'setBillingFrequency'; billingFrequency: BillingFrequency }
  | { type: 'toggleDisabled' }
  | { type: 'setSubmitting'; isSubmitting: boolean };

const deriveBillingFromProject = (project: Project | undefined) => {
  const billingType: StoredBillingType = toStoredBillingType(project?.billingType);
  const billingFrequency: BillingFrequency = project?.billingFrequency ?? DEFAULT_BILLING_FREQUENCY;
  return { billingType, billingFrequency };
};

const getTaskFormSessionKey = (
  isOpen: boolean,
  mode: TaskFormModalProps['mode'],
  editingTask: ProjectTask | null,
  initialProjectId?: string,
) => (isOpen ? `${mode}|${editingTask?.id ?? ''}|${initialProjectId ?? ''}` : 'closed');

const createTaskFormState = (
  mode: TaskFormModalProps['mode'],
  editingTask: ProjectTask | null,
  initialProjectId: string | undefined,
  projects: Project[],
): TaskFormState => {
  if (mode === 'edit' && editingTask) {
    return {
      name: editingTask.name,
      projectId: editingTask.projectId,
      description: editingTask.description || '',
      billingType: editingTask.billingType ?? DEFAULT_BILLING_TYPE,
      billingFrequency: editingTask.billingFrequency ?? DEFAULT_BILLING_FREQUENCY,
      monthlyEffort:
        editingTask.monthlyEffort !== undefined ? String(editingTask.monthlyEffort) : '',
      duration: editingTask.duration !== undefined ? String(editingTask.duration) : '1',
      revenue: editingTask.revenue !== undefined ? String(editingTask.revenue) : '',
      notes: editingTask.notes ?? '',
      tempIsDisabled: editingTask.isDisabled || false,
      isSubmitting: false,
    };
  }

  const seedProject = initialProjectId
    ? projects.find((p) => p.id === initialProjectId)
    : undefined;
  const seeded = deriveBillingFromProject(seedProject);
  return {
    name: '',
    projectId: initialProjectId ?? '',
    description: '',
    billingType: seeded.billingType,
    billingFrequency: seeded.billingFrequency,
    monthlyEffort: '',
    duration: '1',
    revenue: '',
    notes: '',
    tempIsDisabled: false,
    isSubmitting: false,
  };
};

const taskFormReducer = (state: TaskFormState, action: TaskFormAction): TaskFormState => {
  switch (action.type) {
    case 'setTextField':
      return { ...state, [action.field]: action.value };
    case 'selectProject':
      return {
        ...state,
        projectId: action.projectId,
        ...(action.billing ?? {}),
      };
    case 'setBillingType':
      return { ...state, billingType: action.billingType };
    case 'setBillingFrequency':
      return { ...state, billingFrequency: action.billingFrequency };
    case 'toggleDisabled':
      return { ...state, tempIsDisabled: !state.tempIsDisabled };
    case 'setSubmitting':
      return { ...state, isSubmitting: action.isSubmitting };
  }
};

const parseFormNumber = (value: string, fallback = 0) => {
  if (value.trim() === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type TaskFormModalSessionProps = Omit<TaskFormModalProps, 'editingTask'> & {
  editingTask: ProjectTask | null;
};

const TaskDisabledToggleField: React.FC<{
  checked: boolean;
  disabled: boolean;
  inheritedFromClient: boolean;
  clientName?: string;
  projectName?: string;
  onToggle: () => void;
}> = ({ checked, disabled, inheritedFromClient, clientName, projectName, onToggle }) => {
  const { t } = useTranslation(['projects']);

  return (
    <Field>
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
        <div>
          <p
            className={`text-sm font-medium ${
              disabled ? 'text-muted-foreground' : 'text-foreground'
            }`}
          >
            {t('tasks.isDisabled')}
          </p>
          {disabled && (
            <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-600">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              {inheritedFromClient
                ? t('projects.inheritedFromDisabledClient', { clientName })
                : t('tasks.inheritedFromDisabledProject', { projectName })}
            </p>
          )}
        </div>
        <Toggle checked={checked} onChange={onToggle} disabled={disabled} />
      </div>
    </Field>
  );
};

const TaskFormHeader: React.FC<{
  isEditing: boolean;
  isSubmitting: boolean;
  onClose: () => void;
}> = ({ isEditing, isSubmitting, onClose }) => {
  const { t } = useTranslation(['projects']);

  return (
    <ModalHeader>
      <ModalTitle className="gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
          <i
            className={`fa-solid ${isEditing ? 'fa-pen-to-square' : 'fa-list-check'}`}
            aria-hidden="true"
          ></i>
        </span>
        {isEditing ? t('tasks.editTask') : t('tasks.createNewTask')}
      </ModalTitle>
      <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
    </ModalHeader>
  );
};

type TaskFormFooterState = {
  isEditing: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
};

const TaskFormFooter: React.FC<{
  state: TaskFormFooterState;
  onDelete?: () => void;
  onCancel: () => void;
}> = ({ state, onDelete, onCancel }) => {
  const { t } = useTranslation(['projects', 'common']);
  const { isEditing, canDelete, canSubmit, isSubmitting } = state;

  return (
    <ModalFooter className="sm:justify-between">
      {isEditing && canDelete && onDelete ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onDelete}
          disabled={isSubmitting}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
          {t('common:buttons.delete')}
        </Button>
      ) : (
        <span />
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('common:buttons.cancel')}
        </Button>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting
            ? t('common:buttons.saving')
            : isEditing
              ? t('projects.saveChanges')
              : t('tasks.addTask')}
        </Button>
      </div>
    </ModalFooter>
  );
};

const TaskBillingFields: React.FC<{
  formState: TaskFormState;
  currency: string;
  dispatch: React.Dispatch<TaskFormAction>;
}> = ({ formState, currency, dispatch }) => {
  const { t } = useTranslation(['projects', 'common']);
  const translatedBillingTypeOptions = useBillingTypeOptions();
  const translatedBillingFrequencyOptions = useBillingFrequencyOptions();
  const { billingType, billingFrequency, monthlyEffort, duration, revenue } = formState;
  const totalEffort = parseFormNumber(monthlyEffort) * parseFormNumber(duration, 1);
  const totalRevenue = parseFormNumber(revenue) * parseFormNumber(duration, 1);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SelectControl
        id="task-billing-type"
        options={translatedBillingTypeOptions}
        value={billingType}
        onChange={(val) => {
          const nextBillingType = val as StoredBillingType;
          dispatch({ type: 'setBillingType', billingType: nextBillingType });
        }}
        label={t('projects:projects.billingType')}
        searchable={false}
        buttonClassName="h-9"
      />
      <SelectControl
        id="task-billing-frequency"
        options={translatedBillingFrequencyOptions}
        value={billingFrequency}
        onChange={(val) =>
          dispatch({
            type: 'setBillingFrequency',
            billingFrequency: val as BillingFrequency,
          })
        }
        label={t('projects:projects.billingFrequency')}
        searchable={false}
        buttonClassName="h-9"
      />
      <Field>
        <FieldLabel htmlFor="task-monthly-effort">
          {t('projects:projects.monthlyEffort')}
        </FieldLabel>
        <Input
          id="task-monthly-effort"
          type="number"
          min="0"
          step="1"
          value={monthlyEffort}
          onChange={(e) =>
            dispatch({
              type: 'setTextField',
              field: 'monthlyEffort',
              value: e.target.value,
            })
          }
          placeholder="0"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="task-duration">{t('projects:projects.duration')}</FieldLabel>
        <ValidatedNumberInput
          id="task-duration"
          min="0"
          value={duration}
          onValueChange={(value) =>
            dispatch({
              type: 'setTextField',
              field: 'duration',
              value,
            })
          }
          placeholder="1"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="task-expected-effort">
          {t('projects:projects.expectedEffort')}
        </FieldLabel>
        <output
          id="task-expected-effort"
          className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground tabular-nums"
        >
          {formatTaskNumber(totalEffort)}h
        </output>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-revenue">
          {`${t('projects:projects.taskRevenue')} (${currency})`}
        </FieldLabel>
        <ValidatedNumberInput
          id="task-revenue"
          min="0"
          value={revenue}
          onValueChange={(value) => dispatch({ type: 'setTextField', field: 'revenue', value })}
          placeholder="0,00"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="task-total-revenue">
          {`${t('projects:projects.taskTotalRevenue')} (${currency})`}
        </FieldLabel>
        <output
          id="task-total-revenue"
          className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground tabular-nums"
        >
          {currency}
          {formatTaskNumber(totalRevenue, 2)}
        </output>
      </Field>
    </div>
  );
};

const TaskFormModalSession: React.FC<TaskFormModalSessionProps> = ({
  isOpen,
  onClose,
  mode,
  editingTask,
  projects,
  clients,
  currency,
  permissions,
  onAdd,
  onUpdate,
  onDelete,
  onViewOrder,
  initialProjectId,
  projectLocked = false,
}) => {
  const { t } = useTranslation(['projects', 'common']);
  const [formState, dispatch] = useReducer(taskFormReducer, undefined, () =>
    createTaskFormState(mode, editingTask, initialProjectId, projects),
  );
  const { canCreate, canUpdate, canDelete } = permissions;
  const {
    name,
    projectId,
    description,
    billingType,
    billingFrequency,
    monthlyEffort,
    duration,
    revenue,
    notes,
    tempIsDisabled,
    isSubmitting,
  } = formState;

  const projectSelectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  );

  const canSubmit = mode === 'edit' ? canUpdate : canCreate;
  const isEditing = mode === 'edit' && Boolean(editingTask);

  const requestClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (isEditing && !canUpdate) return;
    if (!isEditing && !canCreate) return;
    if (!name || !projectId) return;
    const details: TaskFormDetails = {
      billingType,
      billingFrequency,
      monthlyEffort: monthlyEffort ? parseFloat(monthlyEffort) : undefined,
      duration: duration ? parseFloat(duration) : undefined,
      revenue: revenue ? parseFloat(revenue) : undefined,
      notes: notes.trim() || undefined,
    };
    dispatch({ type: 'setSubmitting', isSubmitting: true });
    try {
      if (isEditing && editingTask) {
        await onUpdate(editingTask.id, {
          name,
          projectId,
          description,
          isDisabled: tempIsDisabled,
          ...details,
        });
      } else {
        await onAdd(name, projectId, undefined, description, details);
      }
      onClose();
    } finally {
      dispatch({ type: 'setSubmitting', isSubmitting: false });
    }
  };

  const project = projects.find((p) => p.id === projectId);
  const orderId = project?.orderId;
  const client = clients.find((c) => c.id === project?.clientId);
  const isProjectDisabled = project?.isDisabled || false;
  const isClientDisabled = client?.isDisabled || false;
  const isInheritedDisabled = isProjectDisabled || isClientDisabled;
  const isCurrentlyDisabled = tempIsDisabled || isInheritedDisabled;

  return (
    <Modal isOpen={isOpen} onClose={requestClose}>
      <ModalContent size="2xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <TaskFormHeader
            isEditing={isEditing}
            isSubmitting={isSubmitting}
            onClose={requestClose}
          />

          <ModalBody className="space-y-6">
            {isEditing && orderId ? (
              <LinkedRecordBanner
                label={t('projects:projects.linkedOrder')}
                value={formatOrderId(orderId)}
                action={
                  onViewOrder
                    ? {
                        label: t('projects:projects.viewOrder'),
                        onClick: () => onViewOrder(orderId),
                      }
                    : undefined
                }
              />
            ) : null}

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <SelectControl
                  id="task-project"
                  options={projectSelectOptions}
                  value={projectId}
                  onChange={(val) => {
                    if (projectLocked) return;
                    const nextProjectId = val as string;
                    const nextProject = projects.find((item) => item.id === nextProjectId);
                    dispatch({
                      type: 'selectProject',
                      projectId: nextProjectId,
                      billing: isEditing ? undefined : deriveBillingFromProject(nextProject),
                    });
                  }}
                  label={t('tasks.project')}
                  required
                  placeholder={t('common:labels.selectOption')}
                  searchable={true}
                  disabled={projectLocked}
                  buttonClassName="h-9"
                />

                <Field>
                  <FieldLabel htmlFor="task-name" required>
                    {t('tasks.name')}
                  </FieldLabel>
                  <Input
                    id="task-name"
                    type="text"
                    value={name}
                    onChange={(e) =>
                      dispatch({ type: 'setTextField', field: 'name', value: e.target.value })
                    }
                    placeholder={t('tasks.taskNamePlaceholder')}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="task-description">{t('tasks.description')}</FieldLabel>
                <Textarea
                  id="task-description"
                  value={description}
                  onChange={(e) =>
                    dispatch({ type: 'setTextField', field: 'description', value: e.target.value })
                  }
                  placeholder={t('tasks.taskDescriptionPlaceholder')}
                  rows={3}
                  className="min-h-20 resize-none"
                />
              </Field>

              <TaskBillingFields formState={formState} currency={currency} dispatch={dispatch} />

              <Field>
                <FieldLabel htmlFor="task-notes">{t('projects:projects.taskNotes')}</FieldLabel>
                <Textarea
                  id="task-notes"
                  value={notes}
                  onChange={(e) =>
                    dispatch({ type: 'setTextField', field: 'notes', value: e.target.value })
                  }
                  placeholder={t('common:form.placeholderNotes')}
                  rows={3}
                  className="min-h-20 resize-none"
                />
              </Field>

              {isEditing && (
                <TaskDisabledToggleField
                  checked={isCurrentlyDisabled}
                  disabled={isInheritedDisabled}
                  inheritedFromClient={isClientDisabled}
                  clientName={client?.name}
                  projectName={project?.name}
                  onToggle={() => {
                    if (!isInheritedDisabled) {
                      dispatch({ type: 'toggleDisabled' });
                    }
                  }}
                />
              )}
            </div>
          </ModalBody>

          <TaskFormFooter
            state={{ isEditing, canDelete, canSubmit, isSubmitting }}
            onDelete={onDelete}
            onCancel={requestClose}
          />
        </form>
      </ModalContent>
    </Modal>
  );
};

const TaskFormModal: React.FC<TaskFormModalProps> = ({ editingTask = null, ...props }) => {
  const sessionKey = getTaskFormSessionKey(
    props.isOpen,
    props.mode,
    editingTask,
    props.initialProjectId,
  );

  return <TaskFormModalSession key={sessionKey} {...props} editingTask={editingTask} />;
};

export default TaskFormModal;
