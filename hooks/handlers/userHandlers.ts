import type React from 'react';
import api from '../../services/api';
import type { Role, User, WorkUnit } from '../../types';
import { TOP_MANAGER_ROLE_ID } from '../../utils/permissions';

export type UserHandlersDeps = {
  currentUser: User | null;
  viewingUserId: string;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setRoles: React.Dispatch<React.SetStateAction<Role[]>>;
  setWorkUnits: React.Dispatch<React.SetStateAction<WorkUnit[]>>;
  setViewingUserId: React.Dispatch<React.SetStateAction<string>>;
};

export const makeUserHandlers = (deps: UserHandlersDeps) => {
  const { currentUser, viewingUserId, setUsers, setRoles, setWorkUnits, setViewingUserId } = deps;

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
    } catch (err) {
      console.error('Failed to update user:', err);
      alert('Failed to update user: ' + (err as Error).message);
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
      alert('Failed to update user roles: ' + (err as Error).message);
      throw err;
    }
  };

  const deleteUser = async (id: string) => {
    try {
      if (viewingUserId === id) {
        setViewingUserId(currentUser?.id || '');
      }
      await api.users.delete(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const addEmployee = async (
    name: string,
    employeeType: 'internal' | 'external',
    costPerHour?: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const employee = await api.employees.create({ name, employeeType, costPerHour });
      setUsers((prev) => [...prev, employee]);
      return { success: true };
    } catch (err) {
      console.error(`Failed to add ${employeeType} employee:`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create employee',
      };
    }
  };

  const addInternalEmployee = (name: string, costPerHour?: number) =>
    addEmployee(name, 'internal', costPerHour);

  const addExternalEmployee = (name: string, costPerHour?: number) =>
    addEmployee(name, 'external', costPerHour);

  const updateEmployee = async (id: string, updates: Partial<User>) => {
    try {
      const updated = await api.employees.update(id, updates);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      console.error('Failed to update employee:', err);
    }
  };

  const deleteEmployee = async (id: string) => {
    try {
      await api.employees.delete(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
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
