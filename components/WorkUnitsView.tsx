import type React from 'react';
import { useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { workUnitsApi } from '../services/api/workUnits';
import type { User, WorkUnit } from '../types';
import { hasScopedActionPermission } from '../utils/permissions';
import HeaderAddButton from './shared/HeaderAddButton';
import Modal from './shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from './shared/ModalLayout';
import SelectControl, { type Option } from './shared/SelectControl';
import UserAssignmentModal from './shared/UserAssignmentModal';

export interface WorkUnitPayload {
  name: string;
  managerIds: string[];
  description: string;
}

export interface WorkUnitsViewProps {
  workUnits: WorkUnit[];
  users: User[];
  permissions: string[];
  onAddWorkUnit: (data: WorkUnitPayload) => Promise<void>;
  onUpdateWorkUnit: (id: string, updates: WorkUnitPayload) => Promise<void>;
  onDeleteWorkUnit: (id: string) => Promise<void>;
  refreshWorkUnits: () => Promise<void>;
}

type WorkUnitsState = {
  isCreateModalOpen: boolean;
  isEditModalOpen: boolean;
  isAssignmentModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  editingUnit: WorkUnit | null;
  targetUnit: WorkUnit | null;
  name: string;
  selectedManagerIds: string[];
  description: string;
  errors: Record<string, string>;
  isSubmitting: boolean;
  isDeleting: boolean;
};

type WorkUnitsAction =
  | { type: 'openCreate' }
  | { type: 'openEdit'; unit: WorkUnit }
  | { type: 'openAssignments'; unit: WorkUnit }
  | { type: 'confirmDelete'; unit: WorkUnit }
  | { type: 'closeCreate' }
  | { type: 'closeEdit' }
  | { type: 'closeAssignments' }
  | { type: 'closeDeleteConfirm' }
  | { type: 'deleteSuccess' }
  | { type: 'setName'; name: string }
  | { type: 'setSelectedManagerIds'; selectedManagerIds: string[] }
  | { type: 'setDescription'; description: string }
  | { type: 'setErrors'; errors: Record<string, string> }
  | { type: 'clearError'; field: string }
  | { type: 'setSubmitting'; isSubmitting: boolean }
  | { type: 'setDeleting'; isDeleting: boolean };

interface WorkUnitFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  title: React.ReactNode;
  titleIconClassName: string;
  submitLabel: React.ReactNode;
  submitDisabled?: boolean;
  nameInputId: string;
  managersInputId: string;
  descriptionInputId: string;
  name: string;
  selectedManagerIds: string[];
  description: string;
  errors: Record<string, string>;
  isSubmitting: boolean;
  managerOptions: Option[];
  t: (key: string) => string;
  onNameChange: (name: string) => void;
  onSelectedManagerIdsChange: (managerIds: string[]) => void;
  onDescriptionChange: (description: string) => void;
  onClearError: (field: string) => void;
}

const WorkUnitFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  titleIconClassName,
  submitLabel,
  submitDisabled = false,
  nameInputId,
  managersInputId,
  descriptionInputId,
  name,
  selectedManagerIds,
  description,
  errors,
  isSubmitting,
  managerOptions,
  t,
  onNameChange,
  onSelectedManagerIdsChange,
  onDescriptionChange,
  onClearError,
}: WorkUnitFormModalProps) => (
  <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
    {() => (
      <ModalContent size="lg">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i className={`fa-solid ${titleIconClassName}`} aria-hidden="true"></i>
              </span>
              {title}
            </ModalTitle>
            <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
          </ModalHeader>

          <ModalBody className="space-y-4">
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor={nameInputId}>{t('hr:competenceCenters.unitName')}</FieldLabel>
              <Input
                id={nameInputId}
                type="text"
                value={name}
                onChange={(e) => {
                  onNameChange(e.target.value);
                  if (errors.name) onClearError('name');
                }}
                aria-invalid={Boolean(errors.name)}
                aria-label={t('hr:competenceCenters.unitName')}
                className="font-semibold"
                required
                disabled={isSubmitting}
              />
              <FieldError className="text-xs">{errors.name}</FieldError>
            </Field>

            <div className="space-y-2">
              <SelectControl
                id={managersInputId}
                label={t('hr:competenceCenters.managers')}
                options={managerOptions}
                value={selectedManagerIds}
                onChange={(val) => {
                  onSelectedManagerIdsChange(val as string[]);
                  if (errors.managers) onClearError('managers');
                }}
                isMulti={true}
                searchable={true}
                placeholder={t('hr:competenceCenters.selectManagers')}
                disabled={isSubmitting}
                buttonClassName={
                  errors.managers
                    ? 'border-destructive focus-visible:ring-destructive/20'
                    : undefined
                }
              />
              <FieldError className="text-xs">{errors.managers}</FieldError>
            </div>

            <Field>
              <FieldLabel htmlFor={descriptionInputId}>
                {t('hr:competenceCenters.description')}
              </FieldLabel>
              <Textarea
                id={descriptionInputId}
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
                aria-label={t('hr:competenceCenters.description')}
                className="min-h-24 resize-y"
                disabled={isSubmitting}
              />
            </Field>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={submitDisabled || isSubmitting}>
              {isSubmitting ? t('common:buttons.saving') : submitLabel}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    )}
  </Modal>
);

const createWorkUnitsState = (): WorkUnitsState => ({
  isCreateModalOpen: false,
  isEditModalOpen: false,
  isAssignmentModalOpen: false,
  isDeleteConfirmOpen: false,
  editingUnit: null,
  targetUnit: null,
  name: '',
  selectedManagerIds: [],
  description: '',
  errors: {},
  isSubmitting: false,
  isDeleting: false,
});

const workUnitsReducer = (state: WorkUnitsState, action: WorkUnitsAction): WorkUnitsState => {
  switch (action.type) {
    case 'openCreate':
      return {
        ...state,
        isCreateModalOpen: true,
        name: '',
        selectedManagerIds: [],
        description: '',
        errors: {},
      };
    case 'openEdit':
      return {
        ...state,
        editingUnit: action.unit,
        isEditModalOpen: true,
        name: action.unit.name,
        selectedManagerIds: action.unit.managers?.map((manager) => manager.id) ?? [],
        description: action.unit.description || '',
        errors: {},
      };
    case 'openAssignments':
      return { ...state, targetUnit: action.unit, isAssignmentModalOpen: true };
    case 'confirmDelete':
      return { ...state, targetUnit: action.unit, isDeleteConfirmOpen: true };
    case 'closeCreate':
      return { ...state, isCreateModalOpen: false };
    case 'closeEdit':
      return { ...state, isEditModalOpen: false, editingUnit: null };
    case 'closeAssignments':
      return { ...state, isAssignmentModalOpen: false, targetUnit: null };
    case 'closeDeleteConfirm':
      return { ...state, isDeleteConfirmOpen: false };
    case 'deleteSuccess':
      return { ...state, isDeleteConfirmOpen: false, targetUnit: null };
    case 'setName':
      return { ...state, name: action.name };
    case 'setSelectedManagerIds':
      return { ...state, selectedManagerIds: action.selectedManagerIds };
    case 'setDescription':
      return { ...state, description: action.description };
    case 'setErrors':
      return { ...state, errors: action.errors };
    case 'clearError':
      return { ...state, errors: { ...state.errors, [action.field]: '' } };
    case 'setSubmitting':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'setDeleting':
      return { ...state, isDeleting: action.isDeleting };
  }
};

const WorkUnitCard: React.FC<{
  unit: WorkUnit;
  canUpdate: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  onEdit: (unit: WorkUnit) => void;
  onDelete: (unit: WorkUnit) => void;
  onManageMembers: (unit: WorkUnit) => void;
}> = ({ unit, canUpdate, canDelete, canManageMembers, onEdit, onDelete, onManageMembers }) => {
  const { t } = useTranslation(['hr', 'common']);

  return (
    <div className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-100 text-praetor text-xl">
          <i className="fa-solid fa-sitemap" aria-hidden="true"></i>
        </div>
        {(canUpdate || canDelete) && (
          <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            {canUpdate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => onEdit(unit)}
                      aria-label={t('common:buttons.edit')}
                      className="flex size-8 items-center justify-center rounded-lg bg-zinc-50 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-praetor"
                    >
                      <i className="fa-solid fa-pen" aria-hidden="true"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => onDelete(unit)}
                      aria-label={t('common:buttons.delete')}
                      className="flex size-8 items-center justify-center rounded-lg bg-zinc-50 text-red-600 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      <h3 className="mb-1 font-semibold text-lg text-zinc-800">{unit.name}</h3>
      {unit.description && (
        <p className="mb-4 line-clamp-2 text-sm text-zinc-500">{unit.description}</p>
      )}

      <div className="space-y-3 border-zinc-100 border-t pt-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-bold text-xs text-zinc-500">
            <i className="fa-solid fa-user-tie" aria-hidden="true"></i>
          </div>
          <div>
            <p className="font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
              {t('hr:competenceCenters.managers')}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {unit.managers && unit.managers.length > 0 ? (
                unit.managers.map((manager) => (
                  <span
                    key={manager.id}
                    className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 font-medium text-praetor text-xs"
                  >
                    {manager.name}
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-400 italic">
                  {t('hr:competenceCenters.noManagersAssigned')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-zinc-100 font-bold text-xs text-zinc-500">
              <i className="fa-solid fa-users" aria-hidden="true"></i>
            </div>
            <div>
              <p className="font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
                {t('hr:competenceCenters.members')}
              </p>
              <p className="font-bold text-sm text-zinc-700">
                {unit.userCount || 0} {t('hr:competenceCenters.users')}
              </p>
            </div>
          </div>
          {canManageMembers && (
            <Button type="button" onClick={() => onManageMembers(unit)}>
              {t('hr:competenceCenters.manageMembers')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const WorkUnitsEmptyState: React.FC<{ canCreate: boolean }> = ({ canCreate }) => {
  const { t } = useTranslation('hr');

  return (
    <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-20 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-zinc-50 text-2xl text-zinc-300">
        <i className="fa-solid fa-sitemap" aria-hidden="true"></i>
      </div>
      <h3 className="font-semibold text-lg text-zinc-800">
        {canCreate
          ? t('competenceCenters.noCompetenceCentersCreated')
          : t('competenceCenters.noCompetenceCentersAssigned')}
      </h3>
      <p className={`${canCreate ? 'max-w-sm' : 'max-w-md'} mt-1 text-zinc-500`}>
        {canCreate
          ? t('competenceCenters.noCompetenceCentersCreatedDescription')
          : t('competenceCenters.noCompetenceCentersAssignedDescription')}
      </p>
    </div>
  );
};

const WorkUnitDeleteConfirmModal: React.FC<{
  isOpen: boolean;
  unit: WorkUnit | null;
  isDeleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}> = ({ isOpen, unit, isDeleting, onClose, onDelete }) => {
  const { t } = useTranslation(['hr', 'common']);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="sm">
          <ModalHeader className="justify-center text-center">
            <div className="space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <i className="fa-solid fa-triangle-exclamation text-xl" aria-hidden="true"></i>
              </div>
              <ModalTitle className="justify-center">
                {t('hr:competenceCenters.deleteCompetenceCenter')}
              </ModalTitle>
            </div>
          </ModalHeader>
          <ModalBody className="text-center text-muted-foreground text-sm leading-relaxed">
            {t('hr:competenceCenters.deleteConfirmMessage', { name: unit?.name })}
          </ModalBody>
          <ModalFooter className="grid grid-cols-2 sm:flex">
            <Button type="button" variant="outline" onClick={onClose} disabled={isDeleting}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={onDelete} disabled={isDeleting}>
              {isDeleting ? t('common:buttons.saving') : t('hr:competenceCenters.yesDelete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

const WorkUnitsView: React.FC<WorkUnitsViewProps> = ({
  workUnits,
  users,
  permissions,
  onAddWorkUnit,
  onUpdateWorkUnit,
  onDeleteWorkUnit,
  refreshWorkUnits,
}) => {
  const { t } = useTranslation(['hr', 'common', 'form']);
  const [state, dispatch] = useReducer(workUnitsReducer, undefined, createWorkUnitsState);
  const {
    isCreateModalOpen,
    isEditModalOpen,
    isAssignmentModalOpen,
    isDeleteConfirmOpen,
    editingUnit,
    targetUnit,
    name,
    selectedManagerIds,
    description,
    errors,
    isSubmitting,
    isDeleting,
  } = state;

  const openCreateModal = () => {
    dispatch({ type: 'openCreate' });
  };

  const openEditModal = (unit: WorkUnit) => {
    dispatch({ type: 'openEdit', unit });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.unitNameRequired');
    if (selectedManagerIds.length === 0)
      newErrors.managers = t('common:validation.managersRequired');

    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'setErrors', errors: newErrors });
      return;
    }

    dispatch({ type: 'setSubmitting', isSubmitting: true });
    try {
      await onAddWorkUnit({ name, managerIds: selectedManagerIds, description });
      dispatch({ type: 'closeCreate' });
    } finally {
      dispatch({ type: 'setSubmitting', isSubmitting: false });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.unitNameRequired');

    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'setErrors', errors: newErrors });
      return;
    }

    if (!editingUnit || !name) return;
    dispatch({ type: 'setSubmitting', isSubmitting: true });
    try {
      await onUpdateWorkUnit(editingUnit.id, { name, managerIds: selectedManagerIds, description });
      dispatch({ type: 'closeEdit' });
    } finally {
      dispatch({ type: 'setSubmitting', isSubmitting: false });
    }
  };

  const confirmDelete = (unit: WorkUnit) => {
    dispatch({ type: 'confirmDelete', unit });
  };

  const handleDelete = async () => {
    if (!targetUnit) return;
    if (isDeleting) return;
    dispatch({ type: 'setDeleting', isDeleting: true });
    try {
      await onDeleteWorkUnit(targetUnit.id);
      dispatch({ type: 'deleteSuccess' });
    } finally {
      dispatch({ type: 'setDeleting', isDeleting: false });
    }
  };

  const openAssignments = (unit: WorkUnit) => {
    dispatch({ type: 'openAssignments', unit });
  };

  const loadAssignedUnitUserIds = (signal?: AbortSignal) => {
    if (!targetUnit) return Promise.resolve([]);
    return workUnitsApi.getUsers(targetUnit.id, signal);
  };

  const saveAssignedUnitUserIds = async (userIds: string[]) => {
    if (!targetUnit) return;
    await workUnitsApi.updateUsers(targetUnit.id, userIds);
    await refreshWorkUnits();
  };

  const requestCloseCreateModal = () => {
    if (isSubmitting) return;
    dispatch({ type: 'closeCreate' });
  };

  const requestCloseEditModal = () => {
    if (isSubmitting) return;
    dispatch({ type: 'closeEdit' });
  };

  const closeAssignments = () => {
    dispatch({ type: 'closeAssignments' });
  };

  const requestCloseDeleteConfirm = () => {
    if (isDeleting) return;
    dispatch({ type: 'closeDeleteConfirm' });
  };

  const managerOptions = users.map((u) => ({ id: u.id, name: u.name }));

  const canCreateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'create');
  const canUpdateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'update');
  const canDeleteWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'delete');
  const canManageMembers = canUpdateWorkUnits;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-800 tracking-tight">
            {t('hr:competenceCenters.title')}
          </h2>
          <p className="text-zinc-500 font-medium">{t('hr:competenceCenters.subtitle')}</p>
        </div>
        {canCreateWorkUnits && (
          <HeaderAddButton actionSize="wide" onClick={openCreateModal}>
            {t('hr:competenceCenters.newCompetenceCenter')}
          </HeaderAddButton>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workUnits.map((unit) => (
          <WorkUnitCard
            key={unit.id}
            unit={unit}
            canUpdate={canUpdateWorkUnits}
            canDelete={canDeleteWorkUnits}
            canManageMembers={canManageMembers}
            onEdit={openEditModal}
            onDelete={confirmDelete}
            onManageMembers={openAssignments}
          />
        ))}

        {workUnits.length === 0 && <WorkUnitsEmptyState canCreate={canCreateWorkUnits} />}
      </div>

      <WorkUnitFormModal
        isOpen={isCreateModalOpen}
        onClose={requestCloseCreateModal}
        onSubmit={handleCreate}
        title={t('hr:competenceCenters.newCompetenceCenter')}
        titleIconClassName="fa-plus"
        submitLabel={t('hr:competenceCenters.createUnit')}
        submitDisabled={selectedManagerIds.length === 0}
        nameInputId="work-unit-create-name"
        managersInputId="work-unit-create-managers"
        descriptionInputId="work-unit-create-description"
        name={name}
        selectedManagerIds={selectedManagerIds}
        description={description}
        errors={errors}
        isSubmitting={isSubmitting}
        managerOptions={managerOptions}
        t={t}
        onNameChange={(nextName) => dispatch({ type: 'setName', name: nextName })}
        onSelectedManagerIdsChange={(managerIds) =>
          dispatch({ type: 'setSelectedManagerIds', selectedManagerIds: managerIds })
        }
        onDescriptionChange={(nextDescription) =>
          dispatch({ type: 'setDescription', description: nextDescription })
        }
        onClearError={(field) => dispatch({ type: 'clearError', field })}
      />

      <WorkUnitFormModal
        isOpen={isEditModalOpen}
        onClose={requestCloseEditModal}
        onSubmit={handleUpdate}
        title={t('hr:competenceCenters.editCompetenceCenter')}
        titleIconClassName="fa-pen-to-square"
        submitLabel={t('hr:competenceCenters.saveChanges')}
        nameInputId="work-unit-edit-name"
        managersInputId="work-unit-edit-managers"
        descriptionInputId="work-unit-edit-description"
        name={name}
        selectedManagerIds={selectedManagerIds}
        description={description}
        errors={errors}
        isSubmitting={isSubmitting}
        managerOptions={managerOptions}
        t={t}
        onNameChange={(nextName) => dispatch({ type: 'setName', name: nextName })}
        onSelectedManagerIdsChange={(managerIds) =>
          dispatch({ type: 'setSelectedManagerIds', selectedManagerIds: managerIds })
        }
        onDescriptionChange={(nextDescription) =>
          dispatch({ type: 'setDescription', description: nextDescription })
        }
        onClearError={(field) => dispatch({ type: 'clearError', field })}
      />

      {/* Assignment Modal */}
      <UserAssignmentModal
        isOpen={isAssignmentModalOpen && !!targetUnit}
        onClose={closeAssignments}
        users={users}
        loadAssignedUserIds={loadAssignedUnitUserIds}
        saveAssignedUserIds={saveAssignedUnitUserIds}
        entityLabel={t('hr:competenceCenters.title')}
        entityName={targetUnit?.name || ''}
        title={t('hr:competenceCenters.manageMembers')}
        description={t('hr:competenceCenters.addRemoveUsers', { name: targetUnit?.name })}
        loadErrorMessage={t('hr:competenceCenters.failedToLoadUnitUsers')}
        saveErrorMessage={t('hr:competenceCenters.failedToSaveAssignments')}
        saveButtonLabel={t('hr:competenceCenters.saveAssignments')}
        disabled={!canManageMembers}
      />

      <WorkUnitDeleteConfirmModal
        isOpen={isDeleteConfirmOpen && !!targetUnit}
        unit={targetUnit}
        isDeleting={isDeleting}
        onClose={requestCloseDeleteConfirm}
        onDelete={handleDelete}
      />
    </div>
  );
};

export default WorkUnitsView;
