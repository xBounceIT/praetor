import type { FastifyRequest } from 'fastify';
import type { ManagerScopeOptions } from '../repositories/usersRepo.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';

export type UserVisibilityScope = ManagerScopeOptions & {
  canViewAllUsers: boolean;
};

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
