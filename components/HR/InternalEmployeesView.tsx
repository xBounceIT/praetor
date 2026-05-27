import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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

export interface InternalEmployeesViewProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  onAddEmployee: (
    name: string,
    costPerHour?: number,
  ) => Promise<{ success: boolean; error?: string }>;
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
    <i className="fa-solid fa-users text-4xl mb-3 text-zinc-300"></i>
    <p className="text-zinc-500 font-medium">{title}</p>
    <p className="text-sm text-zinc-400 mt-1">{description}</p>
  </div>
);

const InternalEmployeesView: React.FC<InternalEmployeesViewProps> = ({
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
  const canCreateEmployees = hasPermission(permissions, buildPermission('hr.internal', 'create'));
  const canUpdateEmployees = hasPermission(permissions, buildPermission('hr.internal', 'update'));
  const canDeleteEmployees = hasPermission(permissions, buildPermission('hr.internal', 'delete'));
  const canViewCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'view'));
  const canUpdateCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'update'));
  const canManageEmployeeAssignments = hasPermission(
    permissions,
    buildPermission('hr.employee_assignments', 'update'),
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<User | null>(null);
  const [managingEmployee, setManagingEmployee] = useState<User | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<User | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Combine and sort all employees by surname ascending
  const allEmployees = useMemo(() => {
    const filtered = users.filter(
      (u) =>
        !u.isDisabled &&
        !u.isAdminOnly &&
        (u.employeeType === 'internal' || u.employeeType === 'app_user' || !u.employeeType),
    );

    return filtered.sort((a, b) => {
      const surnameA = getSurname(a.name).toLowerCase();
      const surnameB = getSurname(b.name).toLowerCase();
      return surnameA.localeCompare(surnameB);
    });
  }, [users]);

  const [formData, setFormData] = useState<{ name: string; costPerHour: string }>({
    name: '',
    costPerHour: '',
  });

  const openAddModal = () => {
    if (!canCreateEmployees) return;
    setEditingEmployee(null);
    setFormData({
      name: '',
      costPerHour: '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (employee: User) => {
    if (!canUpdateEmployees) return;
    setEditingEmployee(employee);
    setFormData({
      name: employee.name || '',
      costPerHour: employee.costPerHour?.toString() || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingEmployee && !canUpdateEmployees) return;
    if (!editingEmployee && !canCreateEmployees) return;

    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) {
      newErrors.name = t('common:validation.required');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      if (editingEmployee) {
        const updates: Partial<User> = {
          name: formData.name.trim(),
        };

        // Only submit costPerHour when the input was actually rendered. Without
        // canViewCosts the GET response masked the field to 0, so including it
        // here on an unrelated edit (e.g. name) would silently clobber the real
        // DB value.
        if (canViewCosts && canUpdateCosts) {
          updates.costPerHour = formData.costPerHour ? parseFloat(formData.costPerHour) : 0;
        }

        onUpdateEmployee(editingEmployee.id, updates);
        setIsModalOpen(false);
      } else {
        const result = await onAddEmployee(
          formData.name.trim(),
          canUpdateCosts && formData.costPerHour ? parseFloat(formData.costPerHour) : undefined,
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
      header: t('internalEmployees.name'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-praetor/10 text-praetor flex items-center justify-center font-bold text-xs">
            {row.avatarInitials}
          </div>
          <span className="font-semibold text-zinc-800">{row.name}</span>
        </div>
      ),
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
              <span className="font-medium text-zinc-600">
                {currency}
                {Number(value ?? 0).toFixed(2)}
              </span>
            ),
          },
        ]
      : []),
    {
      header: t('internalEmployees.status'),
      accessorFn: () => 'active',
      cell: () => <StatusBadge type="active" label={t('internalEmployees.active')} />,
      disableSorting: true,
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
                      onClick={() => setManagingEmployee(row)}
                      aria-label={t('workforce.manageAssignments')}
                      className="p-2 text-zinc-400 hover:text-praetor hover:bg-praetor/5 rounded-lg transition-colors"
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
                    aria-label={t('internalEmployees.editEmployee')}
                    className="p-2 text-zinc-400 hover:text-praetor hover:bg-praetor/5 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('internalEmployees.editEmployee')}</TooltipContent>
            </Tooltip>
          )}
          {row.employeeType === 'internal'
            ? canDeleteEmployees && (
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
              )
            : canDeleteEmployees && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <span className="p-2 text-zinc-300 cursor-not-allowed">
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
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <ModalContent size="md">
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
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
            </ModalHeader>

            <ModalBody className="space-y-4">
              {errors.submit && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {errors.submit}
                </div>
              )}

              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="internal-employee-name">
                  {t('internalEmployees.name')} *
                </FieldLabel>
                <Input
                  id="internal-employee-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  aria-invalid={Boolean(errors.name)}
                  placeholder={t('internalEmployees.name')}
                />
                <FieldError className="text-xs">{errors.name}</FieldError>
              </Field>

              {canViewCosts && (
                <Field>
                  <FieldLabel htmlFor="internal-employee-cost">
                    {t('internalEmployees.costPerHour')}
                  </FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      {currency}
                    </span>
                    <Input
                      id="internal-employee-cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.costPerHour}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, costPerHour: e.target.value }))
                      }
                      className="pl-8"
                      placeholder="0.00"
                      disabled={!canUpdateCosts}
                    />
                  </div>
                </Field>
              )}
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                ) : (
                  t('internalEmployees.saveChanges')
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
        title={t('internalEmployees.deleteEmployee')}
        description={t('internalEmployees.deleteConfirmMessage', { name: employeeToDelete?.name })}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-800">{t('internalEmployees.title')}</h2>
          <p className="text-zinc-500">{t('internalEmployees.subtitle')}</p>
        </div>
        {canCreateEmployees && (
          <HeaderAddButton actionSize="tall" onClick={openAddModal}>
            {t('internalEmployees.addEmployee')}
          </HeaderAddButton>
        )}
      </div>

      {/* Employees Table */}
      <StandardTable<User>
        title={t('internalEmployees.allEmployees')}
        data={allEmployees}
        columns={columns}
        emptyState={
          <EmptyState
            title={t('internalEmployees.noEmployees')}
            description={t('internalEmployees.createFirst')}
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

export default InternalEmployeesView;
