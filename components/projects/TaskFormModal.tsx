import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  BillingFrequency,
  Client,
  Project,
  ProjectTask,
  StoredBillingType,
} from '../../types';
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

const formatOrderId = (id: string) => `#${id.replace('co-', '')}`;

const billingTypeOptions = [
  { id: 'time_and_materials', name: 'projects:projects.billingTypes.timeAndMaterials' },
  { id: 'retainer', name: 'projects:projects.billingTypes.retainer' },
];

const billingFrequencyOptions = [
  { id: 'monthly', name: 'projects:projects.billingFrequencies.monthly' },
  { id: 'one_time', name: 'projects:projects.billingFrequencies.oneTime' },
];

export type RecurringConfig = { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' };

export type TaskFormDetails = Pick<
  ProjectTask,
  'expectedEffort' | 'monthlyEffort' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
>;

export interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  editingTask?: ProjectTask | null;
  projects: Project[];
  clients: Client[];
  currency: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
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

const deriveBillingFromProject = (project: Project | undefined) => {
  const billingType: StoredBillingType =
    project?.billingType === 'retainer' ? 'retainer' : 'time_and_materials';
  const billingFrequency: BillingFrequency =
    billingType === 'time_and_materials' ? 'monthly' : (project?.billingFrequency ?? 'monthly');
  return { billingType, billingFrequency };
};

const TaskFormModal: React.FC<TaskFormModalProps> = ({
  isOpen,
  onClose,
  mode,
  editingTask = null,
  projects,
  clients,
  currency,
  canCreate,
  canUpdate,
  canDelete,
  onAdd,
  onUpdate,
  onDelete,
  onViewOrder,
  initialProjectId,
  projectLocked = false,
}) => {
  const { t } = useTranslation(['projects', 'common']);

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [billingType, setBillingType] = useState<StoredBillingType>('time_and_materials');
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('monthly');
  const [monthlyEffort, setMonthlyEffort] = useState('');
  const [expectedEffort, setExpectedEffort] = useState('');
  const [revenue, setRevenue] = useState('');
  const [notes, setNotes] = useState('');
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Track the (mode, editingTask, initialProjectId) tuple we last initialized for. The init effect
  // runs once per distinct session and skips re-runs caused by unrelated dep changes (e.g. a new
  // `projects` array reference from the parent) that would otherwise clobber in-progress user
  // input. Resetting to null on close lets the next open trigger a fresh init.
  const initializedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      initializedForRef.current = null;
      return;
    }
    const sessionKey = `${mode}|${editingTask?.id ?? ''}|${initialProjectId ?? ''}`;
    if (initializedForRef.current === sessionKey) return;
    initializedForRef.current = sessionKey;
    if (mode === 'edit' && editingTask) {
      setName(editingTask.name);
      setProjectId(editingTask.projectId);
      setDescription(editingTask.description || '');
      setBillingType(editingTask.billingType ?? 'time_and_materials');
      setBillingFrequency(
        editingTask.billingType === 'time_and_materials'
          ? 'monthly'
          : (editingTask.billingFrequency ?? 'monthly'),
      );
      setMonthlyEffort(
        editingTask.monthlyEffort !== undefined ? String(editingTask.monthlyEffort) : '',
      );
      setExpectedEffort(
        editingTask.expectedEffort !== undefined ? String(editingTask.expectedEffort) : '',
      );
      setRevenue(editingTask.revenue !== undefined ? String(editingTask.revenue) : '');
      setNotes(editingTask.notes ?? '');
      setTempIsDisabled(editingTask.isDisabled || false);
    } else {
      setName('');
      setProjectId(initialProjectId ?? '');
      setDescription('');
      const seedProject = initialProjectId
        ? projects.find((p) => p.id === initialProjectId)
        : undefined;
      const seeded = deriveBillingFromProject(seedProject);
      setBillingType(seeded.billingType);
      setBillingFrequency(seeded.billingFrequency);
      setMonthlyEffort('');
      setExpectedEffort('');
      setRevenue('');
      setNotes('');
      setTempIsDisabled(false);
    }
  }, [isOpen, mode, editingTask, initialProjectId, projects]);

  const translatedBillingTypeOptions = useMemo(
    () => billingTypeOptions.map((option) => ({ id: option.id, name: t(option.name) })),
    [t],
  );
  const translatedBillingFrequencyOptions = useMemo(
    () => billingFrequencyOptions.map((option) => ({ id: option.id, name: t(option.name) })),
    [t],
  );

  const projectSelectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  );

  const canSubmit = mode === 'edit' ? canUpdate : canCreate;
  const isEditing = mode === 'edit' && editingTask;

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
      billingFrequency: billingType === 'time_and_materials' ? 'monthly' : billingFrequency,
      monthlyEffort: monthlyEffort ? parseFloat(monthlyEffort) : undefined,
      expectedEffort: expectedEffort ? parseFloat(expectedEffort) : undefined,
      revenue: revenue ? parseFloat(revenue) : undefined,
      notes: notes.trim() || undefined,
    };
    setIsSubmitting(true);
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
      setIsSubmitting(false);
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
            <ModalCloseButton onClick={requestClose} disabled={isSubmitting} />
          </ModalHeader>

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
                    setProjectId(nextProjectId);
                    if (!isEditing) {
                      const nextProject = projects.find((item) => item.id === nextProjectId);
                      const next = deriveBillingFromProject(nextProject);
                      setBillingType(next.billingType);
                      setBillingFrequency(next.billingFrequency);
                    }
                  }}
                  label={t('tasks.project')}
                  placeholder={t('common:labels.selectOption')}
                  searchable={true}
                  disabled={projectLocked}
                  buttonClassName="h-9"
                />

                <Field>
                  <FieldLabel htmlFor="task-name">{t('tasks.name')}</FieldLabel>
                  <Input
                    id="task-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('tasks.taskNamePlaceholder')}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="task-description">{t('tasks.description')}</FieldLabel>
                <Textarea
                  id="task-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('tasks.taskDescriptionPlaceholder')}
                  rows={3}
                  className="min-h-20 resize-none"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SelectControl
                  id="task-billing-type"
                  options={translatedBillingTypeOptions}
                  value={billingType}
                  onChange={(val) => {
                    const nextBillingType = val as StoredBillingType;
                    setBillingType(nextBillingType);
                    if (nextBillingType === 'time_and_materials') setBillingFrequency('monthly');
                  }}
                  label={t('projects:projects.billingType')}
                  searchable={false}
                  buttonClassName="h-9"
                />
                <SelectControl
                  id="task-billing-frequency"
                  options={
                    billingType === 'retainer'
                      ? translatedBillingFrequencyOptions
                      : translatedBillingFrequencyOptions.filter(
                          (option) => option.id === 'monthly',
                        )
                  }
                  value={billingType === 'time_and_materials' ? 'monthly' : billingFrequency}
                  onChange={(val) => setBillingFrequency(val as BillingFrequency)}
                  label={t('projects:projects.billingFrequency')}
                  disabled={billingType === 'time_and_materials'}
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
                    onChange={(e) => setMonthlyEffort(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-expected-effort">
                    {t('projects:projects.expectedEffort')}
                  </FieldLabel>
                  <Input
                    id="task-expected-effort"
                    type="number"
                    min="0"
                    step="1"
                    value={expectedEffort}
                    onChange={(e) => setExpectedEffort(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-revenue">
                    {`${t('projects:projects.taskRevenue')} (${currency})`}
                  </FieldLabel>
                  <Input
                    id="task-revenue"
                    type="number"
                    min="0"
                    step="0.01"
                    value={revenue}
                    onChange={(e) => setRevenue(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="task-notes">{t('projects:projects.taskNotes')}</FieldLabel>
                <Textarea
                  id="task-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('common:form.placeholderNotes')}
                  rows={3}
                  className="min-h-20 resize-none"
                />
              </Field>

              {isEditing && (
                <Field>
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          isInheritedDisabled ? 'text-muted-foreground' : 'text-foreground'
                        }`}
                      >
                        {t('tasks.isDisabled')}
                      </p>
                      {isInheritedDisabled && (
                        <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-600">
                          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                          {isClientDisabled
                            ? t('projects.inheritedFromDisabledClient', {
                                clientName: client?.name,
                              })
                            : t('tasks.inheritedFromDisabledProject', {
                                projectName: project?.name,
                              })}
                        </p>
                      )}
                    </div>
                    <Toggle
                      checked={isCurrentlyDisabled}
                      onChange={() => {
                        if (!isInheritedDisabled) {
                          setTempIsDisabled(!tempIsDisabled);
                        }
                      }}
                      disabled={isInheritedDisabled}
                    />
                  </div>
                </Field>
              )}
            </div>
          </ModalBody>

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
              <Button
                type="button"
                variant="outline"
                onClick={requestClose}
                disabled={isSubmitting}
              >
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
        </form>
      </ModalContent>
    </Modal>
  );
};

export default TaskFormModal;
