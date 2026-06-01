import type React from 'react';
import { useState } from 'react';
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
import SelectControl from './shared/SelectControl';
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const [editingUnit, setEditingUnit] = useState<WorkUnit | null>(null);
  const [targetUnit, setTargetUnit] = useState<WorkUnit | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openCreateModal = () => {
    setName('');
    setSelectedManagerIds([]);
    setDescription('');
    setErrors({});
    setIsCreateModalOpen(true);
  };

  const openEditModal = (unit: WorkUnit) => {
    setEditingUnit(unit);
    setName(unit.name);
    // Map existing managers to IDs
    setSelectedManagerIds(unit.managers ? unit.managers.map((m) => m.id) : []);
    setDescription(unit.description || '');
    setErrors({});
    setIsEditModalOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.unitNameRequired');
    if (selectedManagerIds.length === 0)
      newErrors.managers = t('common:validation.managersRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddWorkUnit({ name, managerIds: selectedManagerIds, description });
      setIsCreateModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.unitNameRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!editingUnit || !name) return;
    setIsSubmitting(true);
    try {
      await onUpdateWorkUnit(editingUnit.id, { name, managerIds: selectedManagerIds, description });
      setIsEditModalOpen(false);
      setEditingUnit(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = (unit: WorkUnit) => {
    setTargetUnit(unit);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!targetUnit) return;
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteWorkUnit(targetUnit.id);
      setIsDeleteConfirmOpen(false);
      setTargetUnit(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const openAssignments = (unit: WorkUnit) => {
    setTargetUnit(unit);
    setIsAssignmentModalOpen(true);
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
    setIsCreateModalOpen(false);
  };

  const requestCloseEditModal = () => {
    if (isSubmitting) return;
    setIsEditModalOpen(false);
  };

  const closeAssignments = () => {
    setIsAssignmentModalOpen(false);
    setTargetUnit(null);
  };

  const requestCloseDeleteConfirm = () => {
    if (isDeleting) return;
    setIsDeleteConfirmOpen(false);
  };

  /*
  const toggleManagerSelection = (userId: string) => {
    setSelectedManagerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };
  */

  const managerOptions = users.map((u) => ({ id: u.id, name: u.name }));

  const canCreateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'create');
  const canUpdateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'update');
  const canDeleteWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'delete');
  const canManageMembers = canUpdateWorkUnits;

  const renderWorkUnitFormModal = ({
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
  }: {
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
  }) => (
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
                    setName(e.target.value);
                    if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
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
                    setSelectedManagerIds(val as string[]);
                    if (errors.managers) setErrors((prev) => ({ ...prev, managers: '' }));
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
                  onChange={(e) => setDescription(e.target.value)}
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
          <div
            key={unit.id}
            className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm hover:shadow-md transition-shadow group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="size-12 rounded-xl bg-zinc-100 text-praetor flex items-center justify-center text-xl">
                <i className="fa-solid fa-sitemap"></i>
              </div>
              {(canUpdateWorkUnits || canDeleteWorkUnits) && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canUpdateWorkUnits && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={() => openEditModal(unit)}
                            aria-label={t('common:buttons.edit')}
                            className="size-8 rounded-lg bg-zinc-50 text-zinc-400 hover:text-praetor hover:bg-zinc-100 flex items-center justify-center transition-colors"
                          >
                            <i className="fa-solid fa-pen"></i>
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
                    </Tooltip>
                  )}
                  {canDeleteWorkUnits && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={() => confirmDelete(unit)}
                            aria-label={t('common:buttons.delete')}
                            className="size-8 rounded-lg bg-zinc-50 text-red-600 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            <h3 className="text-lg font-semibold text-zinc-800 mb-1">{unit.name}</h3>
            {unit.description && (
              <p className="text-sm text-zinc-500 mb-4 line-clamp-2">{unit.description}</p>
            )}

            <div className="space-y-3 pt-4 border-t border-zinc-100">
              <div className="flex items-start gap-3">
                <div className="size-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 text-xs font-bold shrink-0">
                  <i className="fa-solid fa-user-tie"></i>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                    {t('hr:competenceCenters.managers')}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {unit.managers && unit.managers.length > 0 ? (
                      unit.managers.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-praetor"
                        >
                          {m.name}
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
                  <div className="size-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 text-xs font-bold">
                    <i className="fa-solid fa-users"></i>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                      {t('hr:competenceCenters.members')}
                    </p>
                    <p className="text-sm font-bold text-zinc-700">
                      {unit.userCount || 0} {t('hr:competenceCenters.users')}
                    </p>
                  </div>
                </div>
                {canManageMembers && (
                  <Button type="button" onClick={() => openAssignments(unit)}>
                    {t('hr:competenceCenters.manageMembers')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}

        {workUnits.length === 0 && (
          <div className="col-span-full py-20 bg-white rounded-2xl border-2 border-dashed border-zinc-200 flex flex-col items-center justify-center text-center px-6">
            <div className="size-16 bg-zinc-50 rounded-full flex items-center justify-center text-zinc-300 text-2xl mb-4">
              <i className="fa-solid fa-sitemap"></i>
            </div>
            {canCreateWorkUnits ? (
              <>
                <h3 className="text-lg font-semibold text-zinc-800">
                  {t('hr:competenceCenters.noCompetenceCentersCreated')}
                </h3>
                <p className="text-zinc-500 max-w-sm mt-1">
                  {t('hr:competenceCenters.noCompetenceCentersCreatedDescription')}
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-zinc-800">
                  {t('hr:competenceCenters.noCompetenceCentersAssigned')}
                </h3>
                <p className="text-zinc-500 max-w-md mt-1">
                  {t('hr:competenceCenters.noCompetenceCentersAssignedDescription')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {renderWorkUnitFormModal({
        isOpen: isCreateModalOpen,
        onClose: requestCloseCreateModal,
        onSubmit: handleCreate,
        title: t('hr:competenceCenters.newCompetenceCenter'),
        titleIconClassName: 'fa-plus',
        submitLabel: t('hr:competenceCenters.createUnit'),
        submitDisabled: selectedManagerIds.length === 0,
        nameInputId: 'work-unit-create-name',
        managersInputId: 'work-unit-create-managers',
        descriptionInputId: 'work-unit-create-description',
      })}

      {renderWorkUnitFormModal({
        isOpen: isEditModalOpen,
        onClose: requestCloseEditModal,
        onSubmit: handleUpdate,
        title: t('hr:competenceCenters.editCompetenceCenter'),
        titleIconClassName: 'fa-pen-to-square',
        submitLabel: t('hr:competenceCenters.saveChanges'),
        nameInputId: 'work-unit-edit-name',
        managersInputId: 'work-unit-edit-managers',
        descriptionInputId: 'work-unit-edit-description',
      })}

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

      {/* Delete Confirm Modal */}
      <Modal
        isOpen={isDeleteConfirmOpen && !!targetUnit}
        onClose={requestCloseDeleteConfirm}
        ariaLabel={null}
      >
        {() => (
          <ModalContent size="sm">
            <ModalHeader className="justify-center text-center">
              <div className="space-y-3">
                <div className="size-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto text-destructive">
                  <i className="fa-solid fa-triangle-exclamation text-xl" aria-hidden="true"></i>
                </div>
                <ModalTitle className="justify-center">
                  {t('hr:competenceCenters.deleteCompetenceCenter')}
                </ModalTitle>
              </div>
            </ModalHeader>
            <ModalBody className="text-center text-sm text-muted-foreground leading-relaxed">
              {t('hr:competenceCenters.deleteConfirmMessage', { name: targetUnit?.name })}
            </ModalBody>
            <ModalFooter className="grid grid-cols-2 sm:flex">
              <Button
                type="button"
                variant="outline"
                onClick={requestCloseDeleteConfirm}
                disabled={isDeleting}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? t('common:buttons.saving') : t('hr:competenceCenters.yesDelete')}
              </Button>
            </ModalFooter>
          </ModalContent>
        )}
      </Modal>
    </div>
  );
};

export default WorkUnitsView;
