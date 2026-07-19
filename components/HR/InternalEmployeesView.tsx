import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usersApi } from '../../services/api/users';
import type {
  Client,
  Project,
  ProjectTask,
  ResponsibleUserOption,
  User,
  WorkUnit,
} from '../../types';
import { formatDecimal } from '../../utils/numbers';
import { buildPermission, hasPermission, TOP_MANAGER_ROLE_ID } from '../../utils/permissions';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import EmployeeAssignmentsModal from './EmployeeAssignmentsModal';
import EmployeeHrFields from './EmployeeHrFields';
import {
  getEmployeeContactValue,
  LEGACY_CONTACT_COLUMN_ID,
  mapLegacyContactFilterValue,
} from './employeeContactViewAliases';
import {
  buildEmployeeCreatePayload,
  buildEmployeeHrPayload,
  buildHourlyCostPeriodInputs,
  type EmployeeCreatePayload,
  getEmployeeDepartmentDisplay,
  getEmployeeHrStatusBadgeType,
  getResponsibleUserDisplay,
  validateEmployeeHrForm,
  validateHourlyCostPeriods,
} from './employeeHrProfile';
import { useEmployeeViewState } from './useEmployeeViewState';

export interface InternalEmployeesViewProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  workUnits: WorkUnit[];
  responsibleUserOptions: ResponsibleUserOption[];
  onAddEmployee: (employee: EmployeeCreatePayload) => Promise<{ success: boolean; error?: string }>;
  onUpdateEmployee: (id: string, updates: Partial<User>) => void | Promise<void>;
  onDeleteEmployee: (id: string) => void;
  currency: string;
  permissions: string[];
}

// Prefer the structured surname (populated from the directory / HR profile); fall back to the
// last whitespace-separated token of the display name for users without a stored last name.
const getSurname = (user: User): string => {
  const explicit = user.lastName?.trim();
  if (explicit) return explicit;
  const parts = user.name.trim().split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : user.name;
};

interface EmptyStateProps {
  title: string;
  description: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description }) => (
  <div className="p-8 text-center">
    <i className="fa-solid fa-users text-4xl mb-3 text-muted-foreground/50"></i>
    <p className="text-muted-foreground font-medium">{title}</p>
    <p className="text-sm text-muted-foreground mt-1">{description}</p>
  </div>
);

const formatOptionalText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const OptionalText: React.FC<{
  value: unknown;
  fallback: string;
  className?: string;
}> = ({ value, fallback, className = 'text-muted-foreground' }) => {
  const text = formatOptionalText(value);
  return <span className={text ? className : 'text-muted-foreground'}>{text || fallback}</span>;
};

interface InternalEmployeesTableProps {
  employees: User[];
  workUnits: WorkUnit[];
  responsibleUserOptions: ResponsibleUserOption[];
  currency: string;
  permissions: {
    canViewCosts: boolean;
    canEditCosts: boolean;
    canManageEmployeeAssignments: boolean;
    canUpdateEmployees: boolean;
    canDeleteEmployees: boolean;
  };
  onManageEmployee: (employee: User) => void;
  onEditEmployee: (employee: User) => void;
  onDeleteEmployee: (employee: User) => void;
}

const InternalEmployeesTable: React.FC<InternalEmployeesTableProps> = ({
  employees,
  workUnits,
  responsibleUserOptions,
  currency,
  permissions,
  onManageEmployee,
  onEditEmployee,
  onDeleteEmployee,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const notSetLabel = t('employeeProfile.notSet');
  const displayEmployees = useMemo(
    () =>
      employees.map((employee) => ({
        ...employee,
        department: getEmployeeDepartmentDisplay(employee, workUnits) || undefined,
        responsibleUserName:
          getResponsibleUserDisplay(employee, responsibleUserOptions) || undefined,
      })),
    [employees, responsibleUserOptions, workUnits],
  );
  const {
    canViewCosts,
    canEditCosts,
    canManageEmployeeAssignments,
    canUpdateEmployees,
    canDeleteEmployees,
  } = permissions;
  const canOpenEmployee = canUpdateEmployees || canViewCosts;
  const canEditEmployee = canUpdateEmployees || canEditCosts;
  const columns = useMemo<Column<User>[]>(
    () => [
      {
        header: t('internalEmployees.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-praetor/10 text-praetor flex items-center justify-center font-bold text-xs">
              {row.avatarInitials}
            </div>
            <span className="font-semibold text-foreground">{row.name}</span>
          </div>
        ),
      },
      {
        header: t('employeeProfile.employeeCode'),
        accessorKey: 'employeeCode',
        cell: ({ value }) => (
          <OptionalText
            value={value}
            fallback={notSetLabel}
            className="font-medium text-muted-foreground"
          />
        ),
      },
      {
        header: t('common:labels.email'),
        accessorKey: 'email',
        legacyHiddenColumnIds: [LEGACY_CONTACT_COLUMN_ID],
        legacySortColumnIds: [LEGACY_CONTACT_COLUMN_ID],
        legacyFilterColumnIds: [LEGACY_CONTACT_COLUMN_ID],
        legacySortAccessorFn: getEmployeeContactValue,
        legacyFilterAccessorFn: getEmployeeContactValue,
        mapLegacyFilterValue: mapLegacyContactFilterValue,
        cell: ({ value }) => (
          <OptionalText value={value} fallback={notSetLabel} className="text-foreground" />
        ),
      },
      {
        header: t('employeeProfile.phone'),
        accessorKey: 'phone',
        legacyHiddenColumnIds: [LEGACY_CONTACT_COLUMN_ID],
        cell: ({ value }) => <OptionalText value={value} fallback={notSetLabel} />,
      },
      {
        header: t('employeeProfile.jobTitle'),
        id: 'roleTitle',
        accessorFn: (row) => row.jobTitle || '',
        cell: ({ row }) => (
          <OptionalText
            value={row.jobTitle}
            fallback={notSetLabel}
            className="font-medium text-foreground"
          />
        ),
      },
      {
        header: t('employeeProfile.department'),
        accessorKey: 'department',
        cell: ({ value }) => <OptionalText value={value} fallback={notSetLabel} />,
      },
      {
        header: t('employeeProfile.responsible'),
        accessorKey: 'responsibleUserName',
        cell: ({ value }) => <OptionalText value={value} fallback={notSetLabel} />,
      },
      {
        header: t('internalEmployees.type'),
        accessorKey: 'employeeType',
        filterFormat: (value) =>
          value === 'internal'
            ? t('internalEmployees.internalBadge')
            : t('internalEmployees.appUserBadge'),
        cell: ({ row }) => (
          <StatusBadge
            type={row.employeeType === 'internal' ? 'internal' : 'app_user'}
            label={
              row.employeeType === 'internal'
                ? t('internalEmployees.internalBadge')
                : t('internalEmployees.appUserBadge')
            }
          />
        ),
      },
      ...(canViewCosts
        ? [
            {
              header: t('internalEmployees.costPerHour'),
              accessorKey: 'costPerHour' as keyof User,
              align: 'right' as const,
              cell: ({ value }: { value: unknown }) => (
                <span className="font-medium text-muted-foreground">
                  {currency}
                  {formatDecimal(Number(value ?? 0))}
                </span>
              ),
            },
          ]
        : []),
      {
        header: t('employeeProfile.hrStatus'),
        id: 'hrStatus',
        accessorFn: (row) => row.employmentStatus || '',
        filterFormat: (value) =>
          value ? t(`employeeProfile.employmentStatuses.${String(value)}`) : notSetLabel,
        cell: ({ row }) => {
          const status = row.employmentStatus;
          if (!status) {
            return <span className="text-muted-foreground">{notSetLabel}</span>;
          }
          return (
            <StatusBadge
              type={getEmployeeHrStatusBadgeType(status)}
              label={t(`employeeProfile.employmentStatuses.${status}`)}
            />
          );
        },
      },
      {
        header: t('internalEmployees.actions'),
        id: 'actions',
        align: 'right' as const,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            {canManageEmployeeAssignments &&
              !row.hasTopManagerRole &&
              row.role !== TOP_MANAGER_ROLE_ID && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={() => onManageEmployee(row)}
                        aria-label={t('workforce.manageAssignments')}
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                      >
                        <i className="fa-solid fa-link"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('workforce.manageAssignments')}</TooltipContent>
                </Tooltip>
              )}
            {canOpenEmployee && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => onEditEmployee(row)}
                      aria-label={t(
                        canEditEmployee ? 'internalEmployees.editEmployee' : 'common:buttons.view',
                      )}
                      className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                    >
                      <i
                        className={`fa-solid ${canEditEmployee ? 'fa-pen-to-square' : 'fa-eye'}`}
                      ></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t(canEditEmployee ? 'internalEmployees.editEmployee' : 'common:buttons.view')}
                </TooltipContent>
              </Tooltip>
            )}
            {row.employeeType === 'internal'
              ? canDeleteEmployees && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          onClick={() => onDeleteEmployee(row)}
                          aria-label={t('common:buttons.delete')}
                          className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
                  </Tooltip>
                )
              : canDeleteEmployees && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <span className="p-2 text-muted-foreground/50 cursor-not-allowed">
                          <i className="fa-solid fa-lock"></i>
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('internalEmployees.cannotDeleteAppUser')}</TooltipContent>
                  </Tooltip>
                )}
          </div>
        ),
        disableSorting: true,
        disableFiltering: true,
      },
    ],
    [
      canDeleteEmployees,
      canEditEmployee,
      canManageEmployeeAssignments,
      canOpenEmployee,
      canViewCosts,
      currency,
      notSetLabel,
      onDeleteEmployee,
      onEditEmployee,
      onManageEmployee,
      t,
    ],
  );

  return (
    <StandardTable<User>
      title={t('internalEmployees.allEmployees')}
      data={displayEmployees}
      columns={columns}
      onRowClick={canOpenEmployee ? onEditEmployee : undefined}
      emptyState={
        <EmptyState
          title={t('internalEmployees.noEmployees')}
          description={t('internalEmployees.createFirst')}
        />
      }
    />
  );
};

const InternalEmployeesView: React.FC<InternalEmployeesViewProps> = ({
  users,
  clients,
  projects,
  tasks,
  workUnits,
  responsibleUserOptions,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  currency,
  permissions,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const canCreateEmployees = hasPermission(
    permissions,
    buildPermission('administration.user_management', 'create'),
  );
  const canUpdateEmployees = hasPermission(permissions, buildPermission('hr.internal', 'update'));
  const canDeleteEmployees = hasPermission(
    permissions,
    buildPermission('administration.user_management', 'delete'),
  );
  const canViewCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'view'));
  const canUpdateCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'update'));
  const canEditCosts = canViewCosts && canUpdateCosts;
  const canOpenEmployee = canUpdateEmployees || canViewCosts;
  const canManageEmployeeAssignments = hasPermission(
    permissions,
    buildPermission('hr.employee_assignments', 'update'),
  );
  const {
    state,
    setFormData,
    setHourlyCostPeriods,
    openAddEmployeeModal,
    openEditEmployeeModal,
    closeEmployeeModal,
    setManagingEmployee,
    confirmEmployeeDelete,
    completeEmployeeDelete,
    setEmployeeErrors,
    startEmployeeSubmit,
    finishEmployeeSubmit,
    completeEmployeeSubmit,
    startHourlyCostPeriodsLoad,
    completeHourlyCostPeriodsLoad,
    failHourlyCostPeriodsLoad,
  } = useEmployeeViewState();
  const {
    isModalOpen,
    editingEmployee,
    managingEmployee,
    isDeleteConfirmOpen,
    employeeToDelete,
    errors,
    isSubmitting,
    formData,
    hourlyCostPeriods,
    isHourlyCostPeriodsLoading,
    hourlyCostPeriodsLoadError,
  } = state;
  const identityReadOnly = Boolean(editingEmployee && editingEmployee.authMethod !== 'local');

  // Combine and sort all employees by surname ascending
  const allEmployees = useMemo(() => {
    const filtered = users.filter(
      (u) =>
        !u.isDisabled &&
        !u.isAdminOnly &&
        (u.employeeType === 'internal' || u.employeeType === 'app_user' || !u.employeeType),
    );

    return filtered.sort((a, b) => {
      const surnameA = getSurname(a).toLowerCase();
      const surnameB = getSurname(b).toLowerCase();
      return surnameA.localeCompare(surnameB);
    });
  }, [users]);

  const openAddModal = () => {
    if (!canCreateEmployees) return;
    openAddEmployeeModal();
  };

  const openEditModal = (employee: User) => {
    if (!canOpenEmployee) return;
    openEditEmployeeModal(employee);
    if (!canViewCosts) return;

    startHourlyCostPeriodsLoad(employee.id);
    void usersApi
      .getHourlyCostPeriods(employee.id)
      .then((periods) => completeHourlyCostPeriodsLoad(employee.id, periods))
      .catch(() =>
        failHourlyCostPeriodsLoad(employee.id, t('employeeProfile.costPeriods.loadError')),
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingEmployee && !canUpdateEmployees && !canEditCosts) return;
    if (!editingEmployee && !canCreateEmployees) return;

    const newErrors =
      editingEmployee && !canUpdateEmployees
        ? {}
        : validateEmployeeHrForm(formData, {
            identityReadOnly,
            requiredMessage: t('common:validation.required'),
            invalidEmailMessage: t('common:validation.invalidEmail'),
            dateRangeMessage: t('employeeProfile.dateRangeInvalid'),
          });

    if (canEditCosts) {
      Object.assign(
        newErrors,
        validateHourlyCostPeriods(hourlyCostPeriods, {
          required: t('common:validation.required'),
          duplicateDate: t('employeeProfile.costPeriods.duplicateDate'),
          nonNegativeCost: t('employeeProfile.costPeriods.nonNegativeCost'),
        }),
      );
      if (isHourlyCostPeriodsLoading || hourlyCostPeriodsLoadError) {
        newErrors.hourlyCostPeriods = hourlyCostPeriodsLoadError || t('common:states.loading');
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setEmployeeErrors(newErrors);
      return;
    }

    startEmployeeSubmit();

    try {
      if (editingEmployee) {
        const updates: Partial<User> = canUpdateEmployees
          ? buildEmployeeHrPayload(formData, {
              includeIdentity: !identityReadOnly,
            })
          : {};
        if (canEditCosts) {
          updates.hourlyCostPeriods = buildHourlyCostPeriodInputs(hourlyCostPeriods);
        }
        await onUpdateEmployee(editingEmployee.id, updates);
        completeEmployeeSubmit();
      } else {
        const payload = buildEmployeeCreatePayload(formData, {
          includeHrDetails: canUpdateEmployees,
        });
        if (canEditCosts) {
          payload.hourlyCostPeriods = buildHourlyCostPeriodInputs(hourlyCostPeriods);
        }
        const result = await onAddEmployee(payload);
        if (result.success) {
          completeEmployeeSubmit();
        } else {
          setEmployeeErrors({ submit: result.error || 'Failed to create employee' });
        }
      }
    } finally {
      finishEmployeeSubmit();
    }
  };

  const confirmDelete = (employee: User) => {
    confirmEmployeeDelete(employee);
  };

  const handleDelete = () => {
    if (employeeToDelete) {
      onDeleteEmployee(employeeToDelete.id);
      completeEmployeeDelete();
    }
  };

  return (
    <div className="space-y-8">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeEmployeeModal}>
        <ModalContent size="2xl">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <ModalHeader>
              <ModalTitle className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                  <i
                    className={`fa-solid ${editingEmployee ? 'fa-pen-to-square' : 'fa-plus'}`}
                    aria-hidden="true"
                  ></i>
                </span>
                {editingEmployee
                  ? t('internalEmployees.editEmployee')
                  : t('internalEmployees.addEmployee')}
              </ModalTitle>
              <ModalCloseButton onClick={closeEmployeeModal} />
            </ModalHeader>

            <ModalBody className="space-y-6">
              {errors.submit && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {errors.submit}
                </div>
              )}

              <EmployeeHrFields
                prefix="internal-employee"
                formData={formData}
                errors={errors}
                setFormData={setFormData}
                currency={currency}
                hourlyCostPeriods={hourlyCostPeriods}
                setHourlyCostPeriods={setHourlyCostPeriods}
                isHourlyCostPeriodsLoading={isHourlyCostPeriodsLoading}
                hourlyCostPeriodsLoadError={hourlyCostPeriodsLoadError}
                canViewCosts={canViewCosts}
                canUpdateCosts={canUpdateCosts}
                identityReadOnly={identityReadOnly}
                canEditHrDetails={canUpdateEmployees}
                departmentValue={getEmployeeDepartmentDisplay(editingEmployee, workUnits)}
                responsibleUserOptions={responsibleUserOptions}
                currentEmployeeId={editingEmployee?.id ?? null}
              />
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={closeEmployeeModal}>
                {t('common:buttons.cancel')}
              </Button>
              {(!editingEmployee || canUpdateEmployees || canEditCosts) && (
                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    (canEditCosts &&
                      (isHourlyCostPeriodsLoading || Boolean(hourlyCostPeriodsLoadError)))
                  }
                >
                  {isSubmitting ? (
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                  ) : (
                    t('internalEmployees.saveChanges')
                  )}
                </Button>
              )}
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={completeEmployeeDelete}
        onConfirm={handleDelete}
        title={t('internalEmployees.deleteEmployee')}
        description={t('internalEmployees.deleteConfirmMessage', { name: employeeToDelete?.name })}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{t('internalEmployees.title')}</h2>
          <p className="text-muted-foreground">{t('internalEmployees.subtitle')}</p>
        </div>
        {canCreateEmployees && (
          <HeaderAddButton actionSize="tall" onClick={openAddModal}>
            {t('internalEmployees.addEmployee')}
          </HeaderAddButton>
        )}
      </div>

      <InternalEmployeesTable
        employees={allEmployees}
        workUnits={workUnits}
        responsibleUserOptions={responsibleUserOptions}
        currency={currency}
        permissions={{
          canViewCosts,
          canEditCosts,
          canManageEmployeeAssignments,
          canUpdateEmployees,
          canDeleteEmployees,
        }}
        onManageEmployee={setManagingEmployee}
        onEditEmployee={openEditModal}
        onDeleteEmployee={confirmDelete}
      />

      <EmployeeAssignmentsModal
        user={managingEmployee}
        clients={clients}
        projects={projects}
        tasks={tasks}
        isOpen={!!managingEmployee}
        onClose={() => setManagingEmployee(null)}
      />
    </div>
  );
};

export default InternalEmployeesView;
