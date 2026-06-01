import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Client, Project, ProjectTask, User } from '../../types';
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
  buildEmployeeCreatePayload,
  buildEmployeeHrPayload,
  createEmployeeHrForm,
  createEmptyEmployeeHrForm,
  type EmployeeCreatePayload,
  type EmployeeHrFormData,
  getEmployeeHrStatusBadgeType,
  validateEmployeeHrForm,
} from './employeeHrProfile';

export interface ExternalEmployeesViewProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  onAddEmployee: (employee: EmployeeCreatePayload) => Promise<{ success: boolean; error?: string }>;
  onUpdateEmployee: (id: string, updates: Partial<User>) => void;
  onDeleteEmployee: (id: string) => void;
  currency: string;
  permissions: string[];
}

const getSurname = (name: string): string => {
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : name;
};

interface EmptyStateProps {
  title: string;
  description: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description }) => (
  <div className="p-8 text-center">
    <i className="fa-solid fa-user-clock text-4xl mb-3 text-muted-foreground/50"></i>
    <p className="text-muted-foreground font-medium">{title}</p>
    <p className="text-sm text-muted-foreground mt-1">{description}</p>
  </div>
);

const ExternalEmployeesView: React.FC<ExternalEmployeesViewProps> = ({
  users,
  clients,
  projects,
  tasks,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  currency,
  permissions,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const canCreateEmployees = hasPermission(permissions, buildPermission('hr.external', 'create'));
  const canUpdateEmployees = hasPermission(permissions, buildPermission('hr.external', 'update'));
  const canDeleteEmployees = hasPermission(permissions, buildPermission('hr.external', 'delete'));
  const canViewCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'view'));
  const canUpdateCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'update'));
  const canManageEmployeeAssignments = hasPermission(
    permissions,
    buildPermission('hr.employee_assignments', 'update'),
  );
  const notSetLabel = t('employeeProfile.notSet');
  const formatOptionalText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };
  const renderOptionalText = (value: unknown, className = 'text-muted-foreground') => {
    const text = formatOptionalText(value);
    return (
      <span className={text ? className : 'text-muted-foreground'}>{text || notSetLabel}</span>
    );
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<User | null>(null);
  const [managingEmployee, setManagingEmployee] = useState<User | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<User | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter for external employees only, sorted by surname ascending
  const externalEmployees = useMemo(() => {
    const filtered = users.filter((u) => u.employeeType === 'external' && !u.isDisabled);

    return filtered.sort((a, b) => {
      const surnameA = getSurname(a.name).toLowerCase();
      const surnameB = getSurname(b.name).toLowerCase();
      return surnameA.localeCompare(surnameB);
    });
  }, [users]);

  const [formData, setFormData] = useState<EmployeeHrFormData>(createEmptyEmployeeHrForm);

  const openAddModal = () => {
    if (!canCreateEmployees) return;
    setEditingEmployee(null);
    setFormData(createEmptyEmployeeHrForm());
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (employee: User) => {
    if (!canUpdateEmployees) return;
    setEditingEmployee(employee);
    setFormData(createEmployeeHrForm(employee));
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingEmployee && !canUpdateEmployees) return;
    if (!editingEmployee && !canCreateEmployees) return;

    const identityReadOnly = Boolean(editingEmployee && editingEmployee.authMethod !== 'local');
    const newErrors = validateEmployeeHrForm(formData, {
      identityReadOnly,
      requiredMessage: t('common:validation.required'),
      invalidEmailMessage: t('common:validation.invalidEmail'),
      dateRangeMessage: t('employeeProfile.dateRangeInvalid'),
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      if (editingEmployee) {
        const updates = buildEmployeeHrPayload(formData, {
          includeIdentity: !identityReadOnly,
          includeCost: canViewCosts && canUpdateCosts,
        });
        onUpdateEmployee(editingEmployee.id, updates);
        setIsModalOpen(false);
      } else {
        const result = await onAddEmployee(
          buildEmployeeCreatePayload(formData, {
            includeCost: canViewCosts && canUpdateCosts,
          }),
        );
        if (result.success) {
          setIsModalOpen(false);
        } else {
          setErrors({ submit: result.error || 'Failed to create employee' });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = (employee: User) => {
    setEmployeeToDelete(employee);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (employeeToDelete) {
      onDeleteEmployee(employeeToDelete.id);
      setIsDeleteConfirmOpen(false);
      setEmployeeToDelete(null);
    }
  };

  // Define columns for StandardTable
  const columns: Column<User>[] = [
    {
      header: t('externalEmployees.name'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
            {row.avatarInitials}
          </div>
          <span className="font-semibold text-foreground">{row.name}</span>
        </div>
      ),
    },
    {
      header: t('employeeProfile.employeeCode'),
      accessorKey: 'employeeCode',
      cell: ({ value }: { value: unknown }) =>
        renderOptionalText(value, 'font-medium text-muted-foreground'),
    },
    {
      header: t('employeeProfile.contact'),
      id: 'contact',
      accessorFn: (row) => [row.email, row.phone].filter(Boolean).join(' '),
      cell: ({ row }) => {
        const email = row.email?.trim();
        const phone = row.phone?.trim();
        return (
          <div className="flex min-w-40 flex-col gap-0.5 text-sm">
            {email && <span className="text-foreground">{email}</span>}
            {phone && <span className="text-muted-foreground">{phone}</span>}
            {!email && !phone && <span className="text-muted-foreground">{notSetLabel}</span>}
          </div>
        );
      },
    },
    {
      header: t('employeeProfile.jobTitle'),
      id: 'roleTitle',
      accessorFn: (row) => row.jobTitle || '',
      cell: ({ row }) => (
        <div className="flex min-w-36 flex-col gap-0.5 text-sm">
          {renderOptionalText(row.jobTitle, 'font-medium text-foreground')}
          {row.contractType && (
            <span className="text-xs text-muted-foreground">
              {t(`employeeProfile.contractTypes.${row.contractType}`)}
            </span>
          )}
        </div>
      ),
    },
    {
      header: t('employeeProfile.department'),
      accessorKey: 'department',
      cell: ({ value }: { value: unknown }) => renderOptionalText(value),
    },
    {
      header: t('externalEmployees.type'),
      id: 'employeeTypeLabel',
      accessorFn: () => 'external',
      cell: () => <StatusBadge type="external" label={t('externalEmployees.externalBadge')} />,
      disableSorting: true,
    },
    ...(canViewCosts
      ? [
          {
            header: t('externalEmployees.costPerHour'),
            accessorKey: 'costPerHour' as keyof User,
            align: 'right' as const,
            cell: ({ value }: { value: unknown }) => (
              <span className="font-medium text-muted-foreground">
                {currency}
                {Number(value ?? 0).toFixed(2)}
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
      header: t('externalEmployees.actions'),
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {canManageEmployeeAssignments &&
            !row.hasTopManagerRole &&
            row.role !== TOP_MANAGER_ROLE_ID && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setManagingEmployee(row)}
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
          {canUpdateEmployees && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={() => openEditModal(row)}
                    aria-label={t('externalEmployees.editEmployee')}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('externalEmployees.editEmployee')}</TooltipContent>
            </Tooltip>
          )}
          {canDeleteEmployees && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={() => confirmDelete(row)}
                    aria-label={t('common:buttons.delete')}
                    className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
      disableSorting: true,
      disableFiltering: true,
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
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
                  ? t('externalEmployees.editEmployee')
                  : t('externalEmployees.addEmployee')}
              </ModalTitle>
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
            </ModalHeader>

            <ModalBody className="space-y-6">
              {errors.submit && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {errors.submit}
                </div>
              )}

              <EmployeeHrFields
                section="externalEmployees"
                prefix="external-employee"
                formData={formData}
                errors={errors}
                setFormData={setFormData}
                currency={currency}
                canViewCosts={canViewCosts}
                canUpdateCosts={canUpdateCosts}
                identityReadOnly={Boolean(
                  editingEmployee && editingEmployee.authMethod !== 'local',
                )}
              />
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                ) : (
                  t('externalEmployees.saveChanges')
                )}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t('externalEmployees.deleteEmployee')}
        description={t('externalEmployees.deleteConfirmMessage', { name: employeeToDelete?.name })}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{t('externalEmployees.title')}</h2>
          <p className="text-muted-foreground">{t('externalEmployees.subtitle')}</p>
        </div>
        {canCreateEmployees && (
          <HeaderAddButton actionSize="tall" onClick={openAddModal}>
            {t('externalEmployees.addEmployee')}
          </HeaderAddButton>
        )}
      </div>

      {/* External Employees Table */}
      <StandardTable<User>
        title={t('externalEmployees.title')}
        data={externalEmployees}
        columns={columns}
        onRowClick={canUpdateEmployees ? openEditModal : undefined}
        emptyState={
          <EmptyState
            title={t('externalEmployees.noEmployees')}
            description={t('externalEmployees.createFirst')}
          />
        }
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

export default ExternalEmployeesView;
