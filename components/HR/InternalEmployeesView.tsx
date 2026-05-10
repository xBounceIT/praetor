import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Client, Project, ProjectTask, User } from '../../types';
import { buildPermission, hasPermission, TOP_MANAGER_ROLE_ID } from '../../utils/permissions';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
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
  const canViewCosts = hasPermission(permissions, buildPermission('hr.costs', 'view'));
  const canUpdateCosts = hasPermission(permissions, buildPermission('hr.costs', 'update'));
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

        if (canUpdateCosts) {
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
                      onClick={() => setManagingEmployee(row)}
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
                    onClick={() => openEditModal(row)}
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
                        onClick={() => confirmDelete(row)}
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
            <h3 className="text-xl font-semibold text-zinc-800 flex items-center gap-3">
              <div className="size-10 bg-zinc-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingEmployee ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingEmployee
                ? t('internalEmployees.editEmployee')
                : t('internalEmployees.addEmployee')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="size-10 flex items-center justify-center rounded-xl hover:bg-zinc-100 text-zinc-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
            {errors.submit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errors.submit}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 ml-1">
                {t('internalEmployees.name')} *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className={`w-full px-4 py-3 border ${
                  errors.name ? 'border-red-300' : 'border-zinc-200'
                } rounded-xl focus:ring-2 focus:ring-praetor/20 focus:border-praetor transition-all bg-zinc-50/50`}
                placeholder={t('internalEmployees.name')}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1 ml-1">{errors.name}</p>}
            </div>

            {canViewCosts && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 ml-1">
                  {t('internalEmployees.costPerHour')}
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-medium">
                    {currency}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.costPerHour}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, costPerHour: e.target.value }))
                    }
                    className="w-full pl-8 pr-4 py-3 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor/20 focus:border-praetor transition-all bg-zinc-50/50"
                    placeholder="0.00"
                    disabled={!canUpdateCosts}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-3 border border-zinc-200 rounded-xl text-zinc-600 font-bold hover:bg-zinc-50 transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-3 bg-praetor text-white rounded-xl font-bold hover:bg-praetor/90 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? (
                  <i className="fa-solid fa-spinner fa-spin"></i>
                ) : (
                  t('internalEmployees.saveChanges')
                )}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center">
            <div className="size-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fa-solid fa-trash text-2xl text-red-600"></i>
            </div>
            <h3 className="text-xl font-semibold text-zinc-800 mb-2">
              {t('internalEmployees.deleteEmployee')}
            </h3>
            <p className="text-zinc-500">
              {t('internalEmployees.deleteConfirmMessage', { name: employeeToDelete?.name })}
            </p>
          </div>
          <div className="flex border-t border-zinc-100">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 px-6 py-4 text-zinc-600 font-bold hover:bg-zinc-50 transition-colors"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 px-6 py-4 bg-red-600 text-white font-bold hover:bg-red-700 transition-colors"
            >
              {t('internalEmployees.yesDelete')}
            </button>
          </div>
        </div>
      </Modal>

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
