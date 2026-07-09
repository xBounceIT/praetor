import type React from 'react';
import api from '../../services/api';
import type { Role, User, UserAuthMethod, WorkUnit } from '../../types';
import { getErrorMessage } from '../../utils/errors';
import { TOP_MANAGER_ROLE_ID } from '../../utils/permissions';
import { toastError } from '../../utils/toast';

export type UserHandlersDeps = {
  currentUser: User | null;
  viewingUserId: string;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setRoles: React.Dispatch<React.SetStateAction<Role[]>>;
  setWorkUnits: React.Dispatch<React.SetStateAction<WorkUnit[]>>;
  setViewingUserId: React.Dispatch<React.SetStateAction<string>>;
  refreshMfaExemptionUsers?: () => void | Promise<void>;
};

type EmployeeCreatePayload = Partial<User> & { name: string; costPerHour?: number };

export const makeUserHandlers = (deps: UserHandlersDeps) => {
  const {
    currentUser,
    refreshMfaExemptionUsers: refreshMfaExemptionUsersCallback,
    setUsers,
    setRoles,
    setWorkUnits,
    setViewingUserId,
  } = deps;

  const refreshMfaExemptionUsers = async () => {
    if (!refreshMfaExemptionUsersCallback) return;
    try {
      await refreshMfaExemptionUsersCallback();
    } catch (err) {
      console.error('Failed to refresh MFA exemption users:', err);
    }
  };

  const addUser = async (
    name: string,
    username: string,
    password: string,
    role: string,
    email?: string,
  ) => {
    try {
      const user = await api.users.create(name, username, password, role, email);
      setUsers((prev) => [...prev, user]);
      await refreshMfaExemptionUsers();
      return { success: true } as const;
    } catch (err) {
      console.error('Failed to add user:', err);
      return { success: false as const, error: (err as Error).message };
    }
  };

  const updateUser = async (id: string, updates: Partial<User>) => {
    try {
      const updated = await api.users.update(id, updates);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      await refreshMfaExemptionUsers();
    } catch (err) {
      console.error('Failed to update user:', err);
      toastError(`Failed to update user: ${getErrorMessage(err)}`);
    }
  };

  const updateUserRoles = async (id: string, roleIds: string[], primaryRoleId: string) => {
    try {
      const updated = await api.users.updateRoles(id, roleIds, primaryRoleId);
      const hasTopManagerRole = roleIds.includes(TOP_MANAGER_ROLE_ID);
      const isAdminOnly = roleIds.length === 1 && roleIds.includes('admin');
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                role: updated.primaryRoleId,
                hasTopManagerRole,
                isAdminOnly,
              }
            : u,
        ),
      );
    } catch (err) {
      console.error('Failed to update user roles:', err);
      toastError(`Failed to update user roles: ${getErrorMessage(err)}`);
      throw err;
    }
  };

  const updateUserAuthMethod = async (
    id: string,
    authMethod: UserAuthMethod,
    authProviderId?: string | null,
  ) => {
    try {
      const updated = await api.users.updateAuthMethod(id, authMethod, authProviderId);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      console.error('Failed to update user authentication method:', err);
      toastError(`Failed to update user authentication method: ${getErrorMessage(err)}`);
      throw err;
    }
  };

  const deleteUser = async (id: string) => {
    try {
      await api.users.delete(id);
      // Functional updater: decide against the latest viewingUserId, not the
      // value captured at invocation. If the user navigated to a different
      // profile while the delete was in flight, that newer selection wins.
      setViewingUserId((prev) => (prev === id ? currentUser?.id || '' : prev));
      setUsers((prev) => prev.filter((u) => u.id !== id));
      await refreshMfaExemptionUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
      toastError(`Failed to delete user: ${getErrorMessage(err)}`);
    }
  };

  const addEmployee = async (
    data: EmployeeCreatePayload,
    employeeType: 'internal' | 'external',
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const employee = await api.employees.create({ ...data, employeeType });
      setUsers((prev) => [...prev, employee]);
      await refreshMfaExemptionUsers();
      return { success: true };
    } catch (err) {
      console.error(`Failed to add ${employeeType} employee:`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create employee',
      };
    }
  };

  const addInternalEmployee = (data: EmployeeCreatePayload) => addEmployee(data, 'internal');

  const addExternalEmployee = (data: EmployeeCreatePayload) => addEmployee(data, 'external');

  const updateEmployee = async (id: string, updates: Partial<User>) => {
    try {
      const updated = await api.employees.update(id, updates);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      await refreshMfaExemptionUsers();
    } catch (err) {
      console.error('Failed to update employee:', err);
    }
  };

  const deleteEmployee = async (id: string) => {
    try {
      await api.employees.delete(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      await refreshMfaExemptionUsers();
    } catch (err) {
      console.error('Failed to delete employee:', err);
    }
  };

  const createRole = async (name: string, permissions: string[]) => {
    try {
      const role = await api.roles.create(name, permissions);
      setRoles((prev) => [...prev, role]);
    } catch (err) {
      console.error('Failed to create role', err);
      throw err;
    }
  };

  const renameRole = async (id: string, name: string) => {
    try {
      const updated = await api.roles.rename(id, name);
      setRoles((prev) => prev.map((role) => (role.id === id ? updated : role)));
    } catch (err) {
      console.error('Failed to rename role', err);
      throw err;
    }
  };

  const updateRolePermissions = async (id: string, permissions: string[]) => {
    try {
      const updated = await api.roles.updatePermissions(id, permissions);
      setRoles((prev) => prev.map((role) => (role.id === id ? updated : role)));
    } catch (err) {
      console.error('Failed to update role permissions', err);
      throw err;
    }
  };

  const deleteRole = async (id: string) => {
    try {
      await api.roles.delete(id);
      setRoles((prev) => prev.filter((role) => role.id !== id));
    } catch (err) {
      console.error('Failed to delete role', err);
      throw err;
    }
  };

  const addWorkUnit = async (data: Partial<WorkUnit>) => {
    try {
      const unit = await api.workUnits.create(data);
      setWorkUnits((prev) => [...prev, unit]);
    } catch (err) {
      console.error('Failed to add work unit:', err);
      throw err;
    }
  };

  const updateWorkUnit = async (id: string, updates: Partial<WorkUnit>) => {
    try {
      const updated = await api.workUnits.update(id, updates);
      setWorkUnits((prev) => prev.map((w) => (w.id === id ? updated : w)));
    } catch (err) {
      console.error('Failed to update work unit:', err);
      throw err;
    }
  };

  const deleteWorkUnit = async (id: string) => {
    try {
      await api.workUnits.delete(id);
      setWorkUnits((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      console.error('Failed to delete work unit:', err);
      throw err;
    }
  };

  const fetchWorkUnits = async () => {
    try {
      const wu = await api.workUnits.list();
      setWorkUnits(wu);
    } catch (err) {
      console.error('Failed to refresh work units', err);
    }
  };

  return {
    addUser,
    updateUser,
    updateUserRoles,
    updateUserAuthMethod,
    deleteUser,
    addInternalEmployee,
    addExternalEmployee,
    updateEmployee,
    deleteEmployee,
    createRole,
    renameRole,
    updateRolePermissions,
    deleteRole,
    addWorkUnit,
    updateWorkUnit,
    deleteWorkUnit,
    fetchWorkUnits,
  };
};
