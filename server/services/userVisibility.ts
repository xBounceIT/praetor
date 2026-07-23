import type { FastifyRequest } from 'fastify';
import type { EmployeeType, ManagerScopeOptions, UserListRow } from '../repositories/usersRepo.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';

export type UserVisibilityScope = ManagerScopeOptions & {
  canViewAllUsers: boolean;
};

export const HR_VIEW_PERMISSION_BY_EMPLOYEE_TYPE: Record<EmployeeType, string> = {
  app_user: 'hr.internal.view',
  internal: 'hr.internal.view',
  external: 'hr.external.view',
};

export const HR_DETAIL_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'jobTitle',
  'department',
  'responsibleUserId',
  'employeeCode',
  'hireDate',
  'terminationDate',
  'contractType',
  'employmentStatus',
  'workLocation',
  'emergencyContactName',
  'emergencyContactPhone',
  'address',
  'notes',
] as const;

const HR_RESPONSE_DETAIL_FIELDS = [...HR_DETAIL_FIELDS, 'responsibleUserName'] as const;

export const getUserVisibilityScope = (request: FastifyRequest): UserVisibilityScope => ({
  canViewAllUsers:
    hasPermission(request, 'administration.user_management_all.view') ||
    hasPermission(request, 'hr.work_units_all.view'),
  canViewManagedUsers:
    hasPermission(request, 'timesheets.tracker.view') ||
    hasPermission(request, 'timesheets.tracker_all.view') ||
    hasPermission(request, 'timesheets.ril.view') ||
    hasPermission(request, 'hr.work_units.view') ||
    hasPermission(request, 'hr.work_units_all.view') ||
    hasPermission(request, 'administration.user_management.view'),
  canViewInternal: hasPermission(request, 'hr.internal.view'),
  canViewExternal: hasPermission(request, 'hr.external.view'),
});

export const maskUserResponse = (
  user: UserListRow,
  options: {
    canViewCosts: boolean;
    canViewEmails: boolean;
    canViewHrDetails: boolean;
  },
): Partial<UserListRow> => {
  const response: Partial<UserListRow> = {
    ...user,
    email: options.canViewEmails ? user.email : '',
    costPerHour: options.canViewCosts ? user.costPerHour : 0,
  };

  if (!options.canViewHrDetails) {
    for (const field of HR_RESPONSE_DETAIL_FIELDS) {
      delete response[field];
    }
  }

  return response;
};
