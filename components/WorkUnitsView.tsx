import {
  Building2,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import type React from 'react';
import { useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { workUnitsApi } from '../services/api/workUnits';
import type { User, WorkUnit, WorkUnitMutationPayload } from '../types';
import { hasScopedActionPermission } from '../utils/permissions';
import { toastError } from '../utils/toast';
import HeaderAddButton from './shared/HeaderAddButton';
import MemberAvatarGroup from './shared/MemberAvatarGroup';
import Modal from './shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
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
  onUpdateWorkUnit: (id: string, updates: WorkUnitMutationPayload) => Promise<void>;
  onDeleteWorkUnit: (id: string) => Promise<void>;
  refreshWorkUnits: () => Promise<void>;
}

type WorkUnitsState = {
  isCreateModalOpen: boolean;
  isEditModalOpen: boolean;
  isManagerAssignmentModalOpen: boolean;
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
  | { type: 'openManagerAssignments'; unit: WorkUnit }
  | { type: 'openAssignments'; unit: WorkUnit }
  | { type: 'confirmDelete'; unit: WorkUnit }
  | { type: 'closeCreate' }
  | { type: 'closeEdit' }
  | { type: 'closeManagerAssignments' }
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
  descriptionText: React.ReactNode;
  titleIcon: React.ReactNode;
  submitLabel: React.ReactNode;
  submitDisabled?: boolean;
  showManagers?: boolean;
  managersRequired?: boolean;
  nameInputId: string;
  managersInputId?: string;
  descriptionInputId: string;
  name: string;
  selectedManagerIds?: string[];
  description: string;
  errors: Record<string, string>;
  isSubmitting: boolean;
  managerOptions?: Option[];
  t: (key: string) => string;
  onNameChange: (name: string) => void;
  onSelectedManagerIdsChange?: (managerIds: string[]) => void;
  onDescriptionChange: (description: string) => void;
  onClearError: (field: string) => void;
}

const EMPTY_MANAGER_IDS: string[] = [];
const EMPTY_MANAGER_OPTIONS: Option[] = [];

const WorkUnitFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  descriptionText,
  titleIcon,
  submitLabel,
  submitDisabled = false,
  showManagers = false,
  managersRequired = false,
  nameInputId,
  managersInputId,
  descriptionInputId,
  name,
  selectedManagerIds = EMPTY_MANAGER_IDS,
  description,
  errors,
  isSubmitting,
  managerOptions = EMPTY_MANAGER_OPTIONS,
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
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {titleIcon}
              </span>
              <div className="min-w-0 space-y-1">
                <ModalTitle>{title}</ModalTitle>
                <ModalDescription>{descriptionText}</ModalDescription>
              </div>
            </div>
            <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
          </ModalHeader>

          <ModalBody className="space-y-5">
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor={nameInputId} required>
                {t('hr:competenceCenters.unitName')}
              </FieldLabel>
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

            {showManagers && managersInputId && onSelectedManagerIdsChange && (
              <div className="space-y-2">
                <SelectControl
                  id={managersInputId}
                  label={t('hr:competenceCenters.managers')}
                  required={managersRequired}
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
            )}

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
  isManagerAssignmentModalOpen: false,
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
        description: action.unit.description || '',
        errors: {},
      };
    case 'openManagerAssignments':
      return {
        ...state,
        targetUnit: action.unit,
        selectedManagerIds: action.unit.managers?.map((manager) => manager.id) ?? [],
        isManagerAssignmentModalOpen: true,
      };
    case 'openAssignments':
      return { ...state, targetUnit: action.unit, isAssignmentModalOpen: true };
    case 'confirmDelete':
      return { ...state, targetUnit: action.unit, isDeleteConfirmOpen: true };
    case 'closeCreate':
      return { ...state, isCreateModalOpen: false };
    case 'closeEdit':
      return { ...state, isEditModalOpen: false, editingUnit: null };
    case 'closeManagerAssignments':
      return { ...state, isManagerAssignmentModalOpen: false, targetUnit: null };
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
  onEdit: (unit: WorkUnit) => void;
  onDelete: (unit: WorkUnit) => void;
  onManageManagers: (unit: WorkUnit) => void;
  onManageMembers: (unit: WorkUnit) => void;
}> = ({ unit, canUpdate, canDelete, onEdit, onDelete, onManageManagers, onManageMembers }) => {
  const { t } = useTranslation(['hr', 'common']);
  const memberCount = unit.userCount ?? unit.members?.length ?? 0;

  return (
    <Card className="gap-0 overflow-hidden py-0 transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-md">
      <CardHeader className="border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/10 text-primary">
            <Building2 className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <CardTitle className="min-w-0 text-base leading-snug">
                <h3 className="break-words">{unit.name}</h3>
              </CardTitle>
              <Badge
                variant="outline"
                className="h-5 px-1.5 font-normal text-[10px] text-muted-foreground"
              >
                {t('hr:competenceCenters.memberCount', { count: memberCount })}
              </Badge>
            </div>
            {unit.description && (
              <CardDescription className="mt-0.5 line-clamp-1 text-xs leading-snug">
                {unit.description}
              </CardDescription>
            )}
          </div>
        </div>

        {(canUpdate || canDelete) && (
          <CardAction className="flex items-center gap-0.5">
            {canUpdate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onEdit(unit)}
                    aria-label={`${t('common:buttons.edit')}: ${unit.name}`}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onDelete(unit)}
                    aria-label={`${t('common:buttons.delete')}: ${unit.name}`}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
              </Tooltip>
            )}
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="grid flex-1 p-0 sm:grid-cols-2">
        <section
          aria-label={`${t('hr:competenceCenters.managers')}: ${unit.name}`}
          className="flex flex-col gap-2.5 px-4 py-3 sm:border-r sm:border-border"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <UserRoundCog className="size-4" aria-hidden="true" />
            <h4 className="font-medium text-xs uppercase tracking-wide">
              {t('hr:competenceCenters.managers')}
            </h4>
          </div>
          <div className="flex min-h-7 flex-wrap items-center gap-1.5">
            {unit.managers.length > 0 ? (
              <MemberAvatarGroup members={unit.managers} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('hr:competenceCenters.noManagersAssigned')}
              </p>
            )}
          </div>
          {canUpdate && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-auto h-7 w-full"
              onClick={() => onManageManagers(unit)}
              aria-label={`${t('hr:competenceCenters.manageManagers')}: ${unit.name}`}
            >
              <UserRoundCog aria-hidden="true" />
              {t('hr:competenceCenters.manageManagers')}
            </Button>
          )}
        </section>

        <section
          aria-label={`${t('hr:competenceCenters.members')}: ${unit.name}`}
          className="flex flex-col gap-2.5 border-t border-border px-4 py-3 sm:border-t-0"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <UsersRound className="size-4" aria-hidden="true" />
            <h4 className="font-medium text-xs uppercase tracking-wide">
              {t('hr:competenceCenters.members')}
            </h4>
          </div>
          <div className="flex min-h-7 items-center">
            {unit.members?.length ? (
              <MemberAvatarGroup members={unit.members} />
            ) : memberCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('hr:competenceCenters.memberCount', { count: memberCount })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('hr:competenceCenters.noMembersAssigned')}
              </p>
            )}
          </div>
          {canUpdate && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-auto h-7 w-full"
              onClick={() => onManageMembers(unit)}
              aria-label={`${t('hr:competenceCenters.manageMembers')}: ${unit.name}`}
            >
              <UsersRound aria-hidden="true" />
              {t('hr:competenceCenters.manageMembers')}
            </Button>
          )}
        </section>
      </CardContent>
    </Card>
  );
};

const WorkUnitsEmptyState: React.FC<{ canCreate: boolean; onCreate: () => void }> = ({
  canCreate,
  onCreate,
}) => {
  const { t } = useTranslation('hr');

  return (
    <Empty className="col-span-full min-h-72 border border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Building2 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h3>
            {canCreate
              ? t('competenceCenters.noCompetenceCentersCreated')
              : t('competenceCenters.noCompetenceCentersAssigned')}
          </h3>
        </EmptyTitle>
        <EmptyDescription>
          {canCreate
            ? t('competenceCenters.noCompetenceCentersCreatedDescription')
            : t('competenceCenters.noCompetenceCentersAssignedDescription')}
        </EmptyDescription>
      </EmptyHeader>
      {canCreate && (
        <EmptyContent>
          <Button type="button" onClick={onCreate}>
            <Plus aria-hidden="true" />
            {t('competenceCenters.newCompetenceCenter')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
};

const WorkUnitsHeader: React.FC<{
  workUnitCount: number;
  canCreate: boolean;
  onCreate: () => void;
}> = ({ workUnitCount, canCreate, onCreate }) => {
  const { t } = useTranslation(['hr', 'common']);

  return (
    <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Building2 className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {t('hr:competenceCenters.title')}
            </h2>
            {workUnitCount > 0 && (
              <Badge
                variant="secondary"
                className="tabular-nums"
                aria-label={`${workUnitCount} ${t('hr:competenceCenters.title')}`}
              >
                {workUnitCount}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t('hr:competenceCenters.subtitle')}</p>
        </div>
      </div>
      {canCreate && (
        <HeaderAddButton onClick={onCreate}>
          {t('hr:competenceCenters.newCompetenceCenter')}
        </HeaderAddButton>
      )}
    </div>
  );
};

const WorkUnitsGrid: React.FC<{
  workUnits: WorkUnit[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onCreate: () => void;
  onEdit: (unit: WorkUnit) => void;
  onDelete: (unit: WorkUnit) => void;
  onManageManagers: (unit: WorkUnit) => void;
  onManageMembers: (unit: WorkUnit) => void;
}> = ({
  workUnits,
  canCreate,
  canUpdate,
  canDelete,
  onCreate,
  onEdit,
  onDelete,
  onManageManagers,
  onManageMembers,
}) => (
  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
    {workUnits.map((unit) => (
      <WorkUnitCard
        key={unit.id}
        unit={unit}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEdit={onEdit}
        onDelete={onDelete}
        onManageManagers={onManageManagers}
        onManageMembers={onManageMembers}
      />
    ))}

    {workUnits.length === 0 && <WorkUnitsEmptyState canCreate={canCreate} onCreate={onCreate} />}
  </div>
);

const WorkUnitManagerAssignmentModal: React.FC<{
  isOpen: boolean;
  unit: WorkUnit | null;
  managerOptions: Option[];
  selectedManagerIds: string[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => Promise<void>;
  onSelectedManagerIdsChange: (managerIds: string[]) => void;
}> = ({
  isOpen,
  unit,
  managerOptions,
  selectedManagerIds,
  isSubmitting,
  onClose,
  onSubmit,
  onSelectedManagerIdsChange,
}) => {
  const { t } = useTranslation(['hr', 'common']);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="lg">
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <ModalHeader>
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRoundCog className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 space-y-1">
                  <ModalTitle>{t('hr:competenceCenters.manageManagers')}</ModalTitle>
                  <ModalDescription>
                    {t('hr:competenceCenters.manageManagersDescription', { name: unit?.name })}
                  </ModalDescription>
                </div>
              </div>
              <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
            </ModalHeader>

            <ModalBody className="space-y-5">
              <SelectControl
                id="work-unit-manager-assignments"
                label={t('hr:competenceCenters.managers')}
                options={managerOptions}
                value={selectedManagerIds}
                onChange={(value) => onSelectedManagerIdsChange(value as string[])}
                isMulti={true}
                searchable={true}
                placeholder={t('hr:competenceCenters.selectManagers')}
                disabled={isSubmitting}
              />
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('common:buttons.saving') : t('hr:competenceCenters.saveManagers')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      )}
    </Modal>
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
                <TriangleAlert className="size-5" aria-hidden="true" />
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
    isManagerAssignmentModalOpen,
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
      await onUpdateWorkUnit(editingUnit.id, { name, description });
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

  const openManagerAssignments = (unit: WorkUnit) => {
    dispatch({ type: 'openManagerAssignments', unit });
  };

  const handleManagerUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!targetUnit || isSubmitting) return;

    dispatch({ type: 'setSubmitting', isSubmitting: true });
    try {
      await onUpdateWorkUnit(targetUnit.id, { managerIds: selectedManagerIds });
      dispatch({ type: 'closeManagerAssignments' });
    } catch (error) {
      console.error('Failed to update competence center managers', error);
      toastError(t('hr:competenceCenters.failedToSaveManagers'));
    } finally {
      dispatch({ type: 'setSubmitting', isSubmitting: false });
    }
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

  const requestCloseManagerAssignments = () => {
    if (isSubmitting) return;
    dispatch({ type: 'closeManagerAssignments' });
  };

  const closeAssignments = () => {
    dispatch({ type: 'closeAssignments' });
  };

  const requestCloseDeleteConfirm = () => {
    if (isDeleting) return;
    dispatch({ type: 'closeDeleteConfirm' });
  };

  const managerOptions = useMemo(() => {
    const options = users.map((user) => ({ id: user.id, name: user.name }));
    const knownManagerIds = new Set(options.map((option) => option.id));
    const assignedManagers = isManagerAssignmentModalOpen ? (targetUnit?.managers ?? []) : [];
    for (const manager of assignedManagers) {
      if (knownManagerIds.has(manager.id)) continue;
      knownManagerIds.add(manager.id);
      options.push(manager);
    }
    return options;
  }, [isManagerAssignmentModalOpen, targetUnit, users]);

  const canCreateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'create');
  const canUpdateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'update');
  const canDeleteWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'delete');

  return (
    <div className="space-y-6">
      <WorkUnitsHeader
        workUnitCount={workUnits.length}
        canCreate={canCreateWorkUnits}
        onCreate={openCreateModal}
      />

      <WorkUnitsGrid
        workUnits={workUnits}
        canCreate={canCreateWorkUnits}
        canUpdate={canUpdateWorkUnits}
        canDelete={canDeleteWorkUnits}
        onCreate={openCreateModal}
        onEdit={openEditModal}
        onDelete={confirmDelete}
        onManageManagers={openManagerAssignments}
        onManageMembers={openAssignments}
      />

      <WorkUnitFormModal
        isOpen={isCreateModalOpen}
        onClose={requestCloseCreateModal}
        onSubmit={handleCreate}
        title={t('hr:competenceCenters.newCompetenceCenter')}
        descriptionText={t('hr:competenceCenters.createDescription')}
        titleIcon={<Plus className="size-5" aria-hidden="true" />}
        submitLabel={t('hr:competenceCenters.createUnit')}
        submitDisabled={selectedManagerIds.length === 0}
        showManagers
        managersRequired
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
        descriptionText={t('hr:competenceCenters.editDescription')}
        titleIcon={<Pencil className="size-5" aria-hidden="true" />}
        submitLabel={t('hr:competenceCenters.saveChanges')}
        nameInputId="work-unit-edit-name"
        descriptionInputId="work-unit-edit-description"
        name={name}
        description={description}
        errors={errors}
        isSubmitting={isSubmitting}
        t={t}
        onNameChange={(nextName) => dispatch({ type: 'setName', name: nextName })}
        onDescriptionChange={(nextDescription) =>
          dispatch({ type: 'setDescription', description: nextDescription })
        }
        onClearError={(field) => dispatch({ type: 'clearError', field })}
      />

      <WorkUnitManagerAssignmentModal
        isOpen={isManagerAssignmentModalOpen && !!targetUnit}
        unit={targetUnit}
        managerOptions={managerOptions}
        selectedManagerIds={selectedManagerIds}
        isSubmitting={isSubmitting}
        onClose={requestCloseManagerAssignments}
        onSubmit={handleManagerUpdate}
        onSelectedManagerIdsChange={(managerIds) =>
          dispatch({ type: 'setSelectedManagerIds', selectedManagerIds: managerIds })
        }
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
        disabled={!canUpdateWorkUnits}
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
