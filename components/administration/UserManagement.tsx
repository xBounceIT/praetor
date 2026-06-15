import { Eye, EyeOff, Trash2, TriangleAlert, UserPlus } from 'lucide-react';
import React, { useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usersApi } from '../../services/api/users';
import type {
  Client,
  Project,
  ProjectTask,
  Role,
  SsoProvider,
  User,
  UserAuthMethod,
} from '../../types';
import { buildPermission, hasPermission, TOP_MANAGER_ROLE_ID } from '../../utils/permissions';
import { toastError, toastSuccess } from '../../utils/toast';
import Checkbox from '../shared/Checkbox';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Toggle from '../shared/Toggle';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const isSsoAuthMethod = (authMethod: UserAuthMethod): authMethod is 'oidc' | 'saml' =>
  authMethod === 'oidc' || authMethod === 'saml';

const isProviderManagedIdentity = (user: Pick<User, 'authMethod'> | null | undefined) =>
  (user?.authMethod || 'local') !== 'local';

const sanitizeUsernamePart = (s: string) =>
  s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const isValidEmail = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;

  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@')) return false;

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);
  if (!localPart || !domainPart) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (localPart.includes('..') || domainPart.includes('..')) return false;
  if (!domainPart.includes('.')) return false;

  const domainLabels = domainPart.split('.');
  if (domainLabels.some((label) => !label)) return false;
  if (domainLabels.some((label) => label.startsWith('-') || label.endsWith('-'))) return false;

  return true;
};

const splitFullName = (fullName: string) => {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: '', surname: '' };
  }

  const [firstName, ...surnameParts] = trimmed.split(/\s+/);
  return { firstName, surname: surnameParts.join(' ') };
};

const buildFullName = (firstName: string, surname: string) =>
  `${firstName.trim()} ${surname.trim()}`.trim();

const sameStringSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const as = new Set(a);
  for (const v of b) if (!as.has(v)) return false;
  return true;
};

const getAuthMethodBadgeType = (user: User): StatusType => {
  switch (user.authMethod || 'local') {
    case 'ldap':
      return 'auth_ldap';
    case 'oidc':
      return 'auth_oidc';
    case 'saml':
      return 'auth_saml';
    default:
      return 'auth_local';
  }
};

export interface UserManagementProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  onAddUser: (
    name: string,
    username: string,
    password: string,
    role: string,
    email?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteUser: (id: string) => void;
  onUpdateUser: (id: string, updates: Partial<User>) => void;
  onUpdateUserRoles: (id: string, roleIds: string[], primaryRoleId: string) => Promise<void>;
  onUpdateUserAuthMethod: (
    id: string,
    authMethod: UserAuthMethod,
    authProviderId?: string | null,
  ) => Promise<void>;
  onResetUserTotp: (userId: string) => Promise<void>;
  currentUserId: string;
  permissions: string[];
  roles: Role[];
  ssoProviders: SsoProvider[];
  currency: string;
}

interface AssignmentSelection {
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
}

const EMPTY_ASSIGNMENTS: AssignmentSelection = {
  clientIds: [],
  projectIds: [],
  taskIds: [],
};

interface UserManagementState {
  // Create-user form
  newFirstName: string;
  newSurname: string;
  newEmail: string;
  newUsername: string;
  newPassword: string;
  newRole: string;
  formErrors: Record<string, string>;
  showNewPassword: boolean;
  isCreateModalOpen: boolean;
  // Assignment modal
  managingUserId: string | null;
  assignments: AssignmentSelection;
  initialAssignments: AssignmentSelection;
  clientSearch: string;
  projectSearch: string;
  taskSearch: string;
  filterClientId: string;
  filterProjectId: string;
  isLoadingAssignments: boolean;
  // Delete confirmation
  isDeleteConfirmOpen: boolean;
  userToDelete: User | null;
  // Edit-user modal
  editingUser: User | null;
  editFirstName: string;
  editSurname: string;
  editEmail: string;
  editRole: string;
  editAssignedRoleIds: string[];
  editPrimaryRoleId: string;
  initialEditAssignedRoleIds: string[];
  initialEditPrimaryRoleId: string;
  isLoadingEditRoles: boolean;
  editRolesError: string;
  editFormErrors: Record<string, string>;
  editCostPerHour: string;
  editIsDisabled: boolean;
  // Auth-method dialog
  authMethodUser: User | null;
  authMethodDraft: UserAuthMethod;
  authProviderDraft: string;
  authMethodError: string;
  isSavingAuthMethod: boolean;
  // TOTP reset dialog
  totpResetUser: User | null;
  totpResetError: string;
  isResettingTotp: boolean;
}

const getInitialUserManagementState = (defaultRole: string): UserManagementState => ({
  newFirstName: '',
  newSurname: '',
  newEmail: '',
  newUsername: '',
  newPassword: '',
  newRole: defaultRole,
  formErrors: {},
  showNewPassword: false,
  isCreateModalOpen: false,
  managingUserId: null,
  assignments: EMPTY_ASSIGNMENTS,
  initialAssignments: EMPTY_ASSIGNMENTS,
  clientSearch: '',
  projectSearch: '',
  taskSearch: '',
  filterClientId: 'all',
  filterProjectId: 'all',
  isLoadingAssignments: false,
  isDeleteConfirmOpen: false,
  userToDelete: null,
  editingUser: null,
  editFirstName: '',
  editSurname: '',
  editEmail: '',
  editRole: '',
  editAssignedRoleIds: [],
  editPrimaryRoleId: '',
  initialEditAssignedRoleIds: [],
  initialEditPrimaryRoleId: '',
  isLoadingEditRoles: false,
  editRolesError: '',
  editFormErrors: {},
  editCostPerHour: '0',
  editIsDisabled: false,
  authMethodUser: null,
  authMethodDraft: 'local',
  authProviderDraft: '',
  authMethodError: '',
  isSavingAuthMethod: false,
  totpResetUser: null,
  totpResetError: '',
  isResettingTotp: false,
});

type UserManagementAction =
  | { type: 'set'; values: Partial<UserManagementState> }
  | { type: 'patchFormErrors'; value: Record<string, string> }
  | { type: 'patchEditFormErrors'; value: Record<string, string> }
  | { type: 'toggleEditAssignedRole'; roleId: string }
  | { type: 'toggleAssignment'; assignments: AssignmentSelection };

const userManagementReducer = (
  state: UserManagementState,
  action: UserManagementAction,
): UserManagementState => {
  switch (action.type) {
    case 'set':
      return { ...state, ...action.values };
    case 'patchFormErrors':
      return { ...state, formErrors: { ...state.formErrors, ...action.value } };
    case 'patchEditFormErrors':
      return { ...state, editFormErrors: { ...state.editFormErrors, ...action.value } };
    case 'toggleEditAssignedRole':
      return {
        ...state,
        editAssignedRoleIds: state.editAssignedRoleIds.includes(action.roleId)
          ? state.editAssignedRoleIds.filter((id) => id !== action.roleId)
          : [...state.editAssignedRoleIds, action.roleId],
      };
    case 'toggleAssignment':
      return { ...state, assignments: action.assignments };
    default:
      return state;
  }
};

const UserManagement: React.FC<UserManagementProps> = ({
  users,
  clients,
  projects,
  tasks,
  onAddUser,
  onDeleteUser,
  onUpdateUser,
  onUpdateUserRoles,
  onUpdateUserAuthMethod,
  onResetUserTotp,
  currentUserId,
  permissions,
  roles,
  ssoProviders,
  currency,
}) => {
  const { t } = useTranslation(['hr', 'common']);

  const roleOptions = React.useMemo(
    () =>
      roles.length
        ? roles.map((role) => ({ id: role.id, name: role.name }))
        : [
            { id: 'user', name: t('hr:roles.user') },
            { id: 'manager', name: t('hr:roles.manager') },
            { id: TOP_MANAGER_ROLE_ID, name: t('hr:roles.top_manager') },
            { id: 'admin', name: t('hr:roles.admin') },
          ],
    [roles, t],
  );

  const roleLookup = React.useMemo(() => {
    return new Map(roles.map((role) => [role.id, role]));
  }, [roles]);

  const usernameManuallyEdited = React.useRef(false);
  const [state, dispatch] = useReducer(userManagementReducer, roleOptions[0]?.id || '', (role) =>
    getInitialUserManagementState(role),
  );
  const {
    newFirstName,
    newSurname,
    newEmail,
    newUsername,
    newPassword,
    newRole,
    formErrors,
    showNewPassword,
    isCreateModalOpen,
    managingUserId,
    assignments,
    initialAssignments,
    clientSearch,
    projectSearch,
    taskSearch,
    filterClientId,
    filterProjectId,
    isLoadingAssignments,
    isDeleteConfirmOpen,
    userToDelete,
    editingUser,
    editFirstName,
    editSurname,
    editEmail,
    editRole,
    editAssignedRoleIds,
    editPrimaryRoleId,
    initialEditAssignedRoleIds,
    initialEditPrimaryRoleId,
    isLoadingEditRoles,
    editRolesError,
    editFormErrors,
    editCostPerHour,
    editIsDisabled,
    authMethodUser,
    authMethodDraft,
    authProviderDraft,
    authMethodError,
    isSavingAuthMethod,
    totpResetUser,
    totpResetError,
    isResettingTotp,
  } = state;

  const canCreateUsers = hasPermission(
    permissions,
    buildPermission('administration.user_management', 'create'),
  );
  const canUpdateUsers = hasPermission(
    permissions,
    buildPermission('administration.user_management', 'update'),
  );
  const canDeleteUsers = hasPermission(
    permissions,
    buildPermission('administration.user_management', 'delete'),
  );
  // Column-visibility flag: show the costPerHour column if the caller has at
  // least one of the cost-view grants. With the explicit self/other split, the
  // API masks per row — a user with only `hr.costs.view` sees their own cost
  // populated and others as 0; a user with only `hr.costs_all.view` sees the
  // reverse. Hiding the column entirely is only correct when neither grant is
  // held.
  const canViewOwnCost = hasPermission(permissions, buildPermission('hr.costs', 'view'));
  const canViewAllCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'view'));
  const canViewCosts = canViewOwnCost || canViewAllCosts;
  const canUpdateAllCosts = hasPermission(permissions, buildPermission('hr.costs_all', 'update'));
  const canUpdateOwnCost = hasPermission(permissions, buildPermission('hr.costs', 'update'));
  const canEditCostFor = (targetUserId: string) =>
    canUpdateAllCosts || (canUpdateOwnCost && targetUserId === currentUserId);
  const canManageAssignments = canUpdateUsers;
  if (!newRole && roleOptions[0]?.id) {
    dispatch({ type: 'set', values: { newRole: roleOptions[0].id } });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'set', values: { formErrors: {} } });

    const newErrors: Record<string, string> = {};
    if (!newFirstName?.trim()) newErrors.firstName = t('common:validation.nameRequired');
    if (!newSurname?.trim()) newErrors.surname = t('common:validation.surnameRequired');
    if (newEmail.trim() && !isValidEmail(newEmail)) {
      newErrors.email = t('common:validation.invalidEmail');
    }
    if (!newUsername?.trim()) newErrors.username = t('common:validation.usernameRequired');
    if (!newPassword?.trim()) newErrors.password = t('common:validation.passwordRequired');

    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'set', values: { formErrors: newErrors } });
      return;
    }

    const fullName = buildFullName(newFirstName, newSurname);
    const result = await onAddUser(
      fullName,
      newUsername.trim(),
      newPassword,
      newRole,
      newEmail.trim(),
    );
    if (!result.success) {
      if (result.error?.includes('Username already exists')) {
        dispatch({
          type: 'set',
          values: {
            formErrors: { username: t('common:validation.usernameAlreadyExists') || result.error },
          },
        });
      } else if (result.error?.toLowerCase().includes('email')) {
        dispatch({
          type: 'set',
          values: { formErrors: { email: t('common:validation.invalidEmail') || result.error } },
        });
      } else {
        dispatch({
          type: 'set',
          values: { formErrors: { general: result.error || t('common:messages.errorOccurred') } },
        });
      }
      return;
    }

    resetCreateUserForm();
    dispatch({ type: 'set', values: { isCreateModalOpen: false } });
  };

  const resetCreateUserForm = () => {
    usernameManuallyEdited.current = false;
    dispatch({
      type: 'set',
      values: {
        newFirstName: '',
        newSurname: '',
        newEmail: '',
        newUsername: '',
        newPassword: '',
        showNewPassword: false,
        newRole: roleOptions[0]?.id || '',
        formErrors: {},
      },
    });
  };

  const closeCreateModal = () => {
    dispatch({ type: 'set', values: { isCreateModalOpen: false } });
    resetCreateUserForm();
  };

  if (filterClientId !== 'all' && filterProjectId !== 'all') {
    const selectedProject = projects.find((project) => project.id === filterProjectId);
    if (!selectedProject || selectedProject.clientId !== filterClientId) {
      dispatch({ type: 'set', values: { filterProjectId: 'all' } });
    }
  }

  const openAssignments = async (userId: string) => {
    if (!canManageAssignments) return;
    dispatch({ type: 'set', values: { managingUserId: userId, isLoadingAssignments: true } });
    try {
      const data = await usersApi.getAssignments(userId);
      dispatch({
        type: 'set',
        values: {
          assignments: data,
          initialAssignments: JSON.parse(JSON.stringify(data)), // Deep clone for comparison
        },
      });
    } catch (err) {
      console.error('Failed to load assignments', err);
    } finally {
      dispatch({ type: 'set', values: { isLoadingAssignments: false } });
    }
  };

  const closeAssignments = () => {
    dispatch({
      type: 'set',
      values: {
        managingUserId: null,
        assignments: { clientIds: [], projectIds: [], taskIds: [] },
        clientSearch: '',
        projectSearch: '',
        taskSearch: '',
        filterClientId: 'all',
        filterProjectId: 'all',
      },
    });
  };

  const saveAssignments = async () => {
    if (!managingUserId || !canManageAssignments) return;
    try {
      await usersApi.updateAssignments(
        managingUserId,
        assignments.clientIds,
        assignments.projectIds,
        assignments.taskIds,
      );
      closeAssignments();
    } catch (err) {
      console.error('Failed to save assignments', err);
      toastError(t('hr:competenceCenters.failedToSaveAssignments'));
    }
  };

  const toggleAssignment = (type: 'client' | 'project' | 'task', id: string) => {
    if (!canManageAssignments) return;
    const nextAssignments = ((prev: AssignmentSelection): AssignmentSelection => {
      const list =
        type === 'client' ? prev.clientIds : type === 'project' ? prev.projectIds : prev.taskIds;
      const isAdding = !list.includes(id);
      const newList = isAdding ? [...list, id] : list.filter((item) => item !== id);

      let newClientIds = prev.clientIds;
      let newProjectIds = prev.projectIds;
      let newTaskIds = prev.taskIds;

      if (type === 'task') {
        newTaskIds = newList;
        if (isAdding) {
          const task = tasks.find((t) => t.id === id);
          if (task) {
            const project = projects.find((p) => p.id === task.projectId);
            if (project && !newProjectIds.includes(project.id)) {
              newProjectIds = [...newProjectIds, project.id];
            }
            if (project) {
              const client = clients.find((c) => c.id === project.clientId);
              if (client && !newClientIds.includes(client.id)) {
                newClientIds = [...newClientIds, client.id];
              }
            }
          }
        } else {
          const task = tasks.find((t) => t.id === id);
          if (newTaskIds.length === 0) {
            newProjectIds = [];
            newClientIds = [];
          } else if (task) {
            const project = projects.find((p) => p.id === task.projectId);
            if (project) {
              const hasTaskForProject = newTaskIds.some((taskId) => {
                const remainingTask = tasks.find((t) => t.id === taskId);
                return remainingTask?.projectId === project.id;
              });

              if (!hasTaskForProject) {
                newProjectIds = newProjectIds.filter((projectId) => projectId !== project.id);
              }

              const client = clients.find((c) => c.id === project.clientId);
              if (client) {
                const hasProjectForClient = newProjectIds.some((projectId) => {
                  const remainingProject = projects.find((p) => p.id === projectId);
                  return remainingProject?.clientId === client.id;
                });

                if (!hasProjectForClient) {
                  newClientIds = newClientIds.filter((clientId) => clientId !== client.id);
                }
              }
            }
          }
        }
      } else if (type === 'project') {
        newProjectIds = newList;
        const project = projects.find((p) => p.id === id);
        if (project) {
          if (isAdding) {
            if (!newClientIds.includes(project.clientId)) {
              newClientIds = [...newClientIds, project.clientId];
            }
          } else {
            const hasProjectForClient = newProjectIds.some((projectId) => {
              const remainingProject = projects.find((p) => p.id === projectId);
              return remainingProject?.clientId === project.clientId;
            });

            const hasTaskForClient = newTaskIds.some((taskId) => {
              const remainingTask = tasks.find((t) => t.id === taskId);
              const remainingProject = remainingTask
                ? projects.find((p) => p.id === remainingTask.projectId)
                : null;
              return remainingProject?.clientId === project.clientId;
            });

            if (!hasProjectForClient && !hasTaskForClient) {
              newClientIds = newClientIds.filter((clientId) => clientId !== project.clientId);
            }
          }
        }
      } else {
        newClientIds = newList;
      }

      return {
        clientIds: newClientIds,
        projectIds: newProjectIds,
        taskIds: newTaskIds,
      };
    })(assignments);
    dispatch({ type: 'toggleAssignment', assignments: nextAssignments });
  };

  const confirmDelete = (user: User) => {
    dispatch({ type: 'set', values: { userToDelete: user, isDeleteConfirmOpen: true } });
  };

  const cancelDelete = () => {
    dispatch({ type: 'set', values: { isDeleteConfirmOpen: false, userToDelete: null } });
  };

  const handleDelete = () => {
    if (userToDelete) {
      onDeleteUser(userToDelete.id);
      dispatch({ type: 'set', values: { isDeleteConfirmOpen: false, userToDelete: null } });
    }
  };

  const handleEdit = (user: User) => {
    const { firstName, surname } = splitFullName(user.name);
    // Multi-role edit state (admin-only in practice because roles are admin-scoped)
    if (user.id === currentUserId || roles.length === 0) {
      const fallback = [user.role];
      dispatch({
        type: 'set',
        values: {
          editingUser: user,
          editFirstName: firstName,
          editSurname: surname,
          editEmail: user.email || '',
          editRole: user.role,
          editCostPerHour: user.costPerHour?.toString() || '0',
          editIsDisabled: !!user.isDisabled,
          editFormErrors: {},
          editRolesError: '',
          editAssignedRoleIds: fallback,
          editPrimaryRoleId: user.role,
          initialEditAssignedRoleIds: fallback,
          initialEditPrimaryRoleId: user.role,
        },
      });
      return;
    }

    dispatch({
      type: 'set',
      values: {
        editingUser: user,
        editFirstName: firstName,
        editSurname: surname,
        editEmail: user.email || '',
        editRole: user.role,
        editCostPerHour: user.costPerHour?.toString() || '0',
        editIsDisabled: !!user.isDisabled,
        editFormErrors: {},
        editRolesError: '',
        isLoadingEditRoles: true,
      },
    });
    usersApi
      .getRoles(user.id)
      .then(({ roleIds, primaryRoleId }) => {
        const safeRoleIds = roleIds?.length ? roleIds : [user.role];
        const safePrimary = primaryRoleId || user.role;
        dispatch({
          type: 'set',
          values: {
            editAssignedRoleIds: safeRoleIds,
            editPrimaryRoleId: safePrimary,
            initialEditAssignedRoleIds: safeRoleIds,
            initialEditPrimaryRoleId: safePrimary,
          },
        });
      })
      .catch((err) => {
        console.error('Failed to load user roles:', err);
        const fallback = [user.role];
        dispatch({
          type: 'set',
          values: {
            editRolesError: (err as Error).message || 'Failed to load roles',
            editAssignedRoleIds: fallback,
            editPrimaryRoleId: user.role,
            initialEditAssignedRoleIds: fallback,
            initialEditPrimaryRoleId: user.role,
          },
        });
      })
      .finally(() => {
        dispatch({ type: 'set', values: { isLoadingEditRoles: false } });
      });
  };

  const openAuthMethodDialog = (user: User) => {
    const method = user.authMethod || 'local';
    dispatch({
      type: 'set',
      values: {
        authMethodUser: user,
        authMethodDraft: method,
        authProviderDraft: user.authProviderId || '',
        authMethodError: '',
      },
    });
  };

  const closeAuthMethodDialog = () => {
    if (isSavingAuthMethod) return;
    dispatch({ type: 'set', values: { authMethodUser: null, authMethodError: '' } });
  };

  const saveAuthMethod = async () => {
    if (!authMethodUser) return;
    const requiresProvider = isSsoAuthMethod(authMethodDraft);
    if (requiresProvider && !authProviderDraft) {
      dispatch({
        type: 'set',
        values: { authMethodError: t('hr:workforce.authMethod.providerRequired') },
      });
      return;
    }
    dispatch({ type: 'set', values: { isSavingAuthMethod: true, authMethodError: '' } });
    try {
      await onUpdateUserAuthMethod(
        authMethodUser.id,
        authMethodDraft,
        requiresProvider ? authProviderDraft : null,
      );
      dispatch({ type: 'set', values: { authMethodUser: null } });
    } catch (err) {
      dispatch({
        type: 'set',
        values: { authMethodError: (err as Error).message || t('common:messages.errorOccurred') },
      });
    } finally {
      dispatch({ type: 'set', values: { isSavingAuthMethod: false } });
    }
  };

  const openTotpResetDialog = (user: User) => {
    dispatch({ type: 'set', values: { totpResetUser: user, totpResetError: '' } });
  };

  const closeTotpResetDialog = () => {
    if (isResettingTotp) return;
    dispatch({ type: 'set', values: { totpResetUser: null, totpResetError: '' } });
  };

  const confirmTotpReset = async () => {
    if (!totpResetUser) return;
    dispatch({ type: 'set', values: { isResettingTotp: true, totpResetError: '' } });
    try {
      await onResetUserTotp(totpResetUser.id);
      dispatch({ type: 'set', values: { totpResetUser: null } });
      toastSuccess(t('hr:totpReset.success'));
    } catch (err) {
      dispatch({
        type: 'set',
        values: { totpResetError: (err as Error).message || t('common:messages.errorOccurred') },
      });
    } finally {
      dispatch({ type: 'set', values: { isResettingTotp: false } });
    }
  };

  const closeEditModal = () => {
    dispatch({
      type: 'set',
      values: { editingUser: null, editRolesError: '', editFormErrors: {} },
    });
  };

  const saveEdit = async () => {
    if (editingUser) {
      const identityReadOnly = isProviderManagedIdentity(editingUser);
      const newErrors: Record<string, string> = {};
      const originalHasSurname = !!splitFullName(editingUser.name).surname.trim();
      if (!identityReadOnly) {
        if (!editFirstName.trim()) newErrors.firstName = t('common:validation.nameRequired');
        if (originalHasSurname && !editSurname.trim()) {
          newErrors.surname = t('common:validation.surnameRequired');
        }
        if (editEmail.trim() && !isValidEmail(editEmail)) {
          newErrors.email = t('common:validation.invalidEmail');
        }
      }

      if (Object.keys(newErrors).length > 0) {
        dispatch({ type: 'set', values: { editFormErrors: newErrors } });
        return;
      }

      const updates: Partial<User> = {};

      if (!identityReadOnly) {
        const name = buildFullName(editFirstName, editSurname);
        const email = editEmail.trim();
        if (name !== editingUser.name) {
          updates.name = name;
        }
        if (email !== (editingUser.email || '')) {
          updates.email = email;
        }
      }

      if (editIsDisabled !== !!editingUser.isDisabled) {
        updates.isDisabled = editIsDisabled;
      }

      const isEditingSelf = editingUser.id === currentUserId;
      const canEditAssignedRoles = canUpdateUsers && !isEditingSelf && roles.length > 0;
      const hasRoleAssignmentChanges =
        canEditAssignedRoles &&
        (!sameStringSet(editAssignedRoleIds, initialEditAssignedRoleIds) ||
          editPrimaryRoleId !== initialEditPrimaryRoleId);

      if (!canEditAssignedRoles) {
        // Legacy single-role edit (kept for fallback / non-admin environments)
        if (
          canUpdateUsers &&
          editingUser?.id !== currentUserId &&
          editRole &&
          editRole !== editingUser?.role
        ) {
          updates.role = editRole;
        }
      } else if (hasRoleAssignmentChanges) {
        if (!editAssignedRoleIds.includes(editPrimaryRoleId)) {
          dispatch({
            type: 'set',
            values: { editRolesError: t('hr:workforce.primaryRoleMustBeAssigned') },
          });
          return;
        }
        if (editAssignedRoleIds.length < 1) {
          dispatch({
            type: 'set',
            values: { editRolesError: t('hr:workforce.assignedRolesRequired') },
          });
          return;
        }
        dispatch({ type: 'set', values: { isLoadingEditRoles: true } });
        try {
          await onUpdateUserRoles(editingUser.id, editAssignedRoleIds, editPrimaryRoleId);
        } catch {
          // onUpdateUserRoles already surfaced an error
          return;
        } finally {
          dispatch({ type: 'set', values: { isLoadingEditRoles: false } });
        }
      }

      // Only include costPerHour when the input was actually rendered for the
      // caller; otherwise the value comes from the masked GET response (0) and
      // would silently overwrite the real DB cost on an unrelated edit.
      if (canViewCosts && canEditCostFor(editingUser.id)) {
        const costPerHour = parseFloat(editCostPerHour) || 0;
        if (costPerHour !== (editingUser.costPerHour || 0)) {
          updates.costPerHour = costPerHour;
        }
      }

      if (Object.keys(updates).length > 0) {
        onUpdateUser(editingUser.id, updates);
      }
      closeEditModal();
    }
  };

  const managingUser = users.find((u) => u.id === managingUserId);
  const isEditingSelf = editingUser?.id === currentUserId;
  const canEditRole = canUpdateUsers && !isEditingSelf;
  const canEditAssignedRoles = canUpdateUsers && !isEditingSelf && roles.length > 0;
  const editIdentityReadOnly = isProviderManagedIdentity(editingUser);
  const hasIdentityChanges =
    !!editingUser &&
    !editIdentityReadOnly &&
    (buildFullName(editFirstName, editSurname) !== editingUser.name ||
      editEmail.trim() !== (editingUser.email || ''));
  const hasAssignedRoleChanges =
    !!editingUser &&
    canEditAssignedRoles &&
    (!sameStringSet(editAssignedRoleIds, initialEditAssignedRoleIds) ||
      editPrimaryRoleId !== initialEditPrimaryRoleId);
  const hasEditChanges =
    !!editingUser &&
    (hasIdentityChanges ||
      editIsDisabled !== !!editingUser.isDisabled ||
      (canViewCosts &&
        canEditCostFor(editingUser.id) &&
        parseFloat(editCostPerHour) !== (editingUser.costPerHour || 0)) ||
      (canEditRole && editRole !== editingUser.role) ||
      hasAssignedRoleChanges);

  const filteredProjectsForFilter =
    filterClientId === 'all'
      ? projects
      : projects.filter((project) => project.clientId === filterClientId);

  const clientFilterOptions = [
    { id: 'all', name: t('hr:workforce.allClients') },
    ...clients.map((client) => ({ id: client.id, name: client.name })),
  ];

  const projectFilterOptions = [
    { id: 'all', name: t('hr:workforce.allProjects') },
    ...filteredProjectsForFilter.map((project) => ({ id: project.id, name: project.name })),
  ];

  // Synchronized Filtering Logic
  const getFilteredData = () => {
    const searchClient = clientSearch.toLowerCase();
    const searchProject = projectSearch.toLowerCase();
    const searchTask = taskSearch.toLowerCase();
    const selectedClientFilter = filterClientId !== 'all' ? filterClientId : null;
    const selectedProjectFilter = filterProjectId !== 'all' ? filterProjectId : null;

    // 1. Visible Tasks
    const visibleTasks = tasks.filter((t) => {
      if (selectedProjectFilter && t.projectId !== selectedProjectFilter) return false;
      // Must match task search
      if (searchTask && !t.name.toLowerCase().includes(searchTask)) return false;

      const project = projects.find((p) => p.id === t.projectId);
      if (!project) return false;

      if (selectedClientFilter && project.clientId !== selectedClientFilter) return false;

      // Must match project search (via parent project)
      if (searchProject && !project.name.toLowerCase().includes(searchProject)) return false;

      const client = clients.find((c) => c.id === project.clientId);
      if (!client) return false;

      // Must match client search (via grandparent client)
      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;

      return true;
    });

    // 2. Visible Projects
    const visibleProjects = projects.filter((p) => {
      if (selectedProjectFilter && p.id !== selectedProjectFilter) return false;
      if (selectedClientFilter && p.clientId !== selectedClientFilter) return false;
      // Must match project search
      if (searchProject && !p.name.toLowerCase().includes(searchProject)) return false;

      const client = clients.find((c) => c.id === p.clientId);
      if (!client) return false;

      // Must match client search (via parent client)
      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;

      // If task search is active, project must contain at least one matching task
      if (searchTask) {
        const hasMatchingTask = tasks.some(
          (t) => t.projectId === p.id && t.name.toLowerCase().includes(searchTask),
        );
        if (!hasMatchingTask) return false;
      }

      return true;
    });

    // 3. Visible Clients
    const visibleClients = clients.filter((c) => {
      if (selectedClientFilter && c.id !== selectedClientFilter) return false;

      if (selectedProjectFilter) {
        const selectedProject = projects.find((project) => project.id === selectedProjectFilter);
        if (!selectedProject || selectedProject.clientId !== c.id) return false;
      }
      // Must match client search
      if (searchClient && !c.name.toLowerCase().includes(searchClient)) return false;

      // If project or task search is active, client must have at least one valid descendant path
      if (searchProject || searchTask) {
        const hasMatchingPath = projects.some((p) => {
          if (p.clientId !== c.id) return false;

          if (selectedProjectFilter && p.id !== selectedProjectFilter) return false;

          if (searchProject && !p.name.toLowerCase().includes(searchProject)) return false;

          if (searchTask) {
            return tasks.some(
              (t) => t.projectId === p.id && t.name.toLowerCase().includes(searchTask),
            );
          }

          return true;
        });

        if (!hasMatchingPath) return false;
      }

      return true;
    });

    return { visibleClients, visibleProjects, visibleTasks };
  };

  const { visibleClients, visibleProjects, visibleTasks } = getFilteredData();

  const sortedUsers = React.useMemo(
    () =>
      users.toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [users],
  );

  const emptyEmailLabel = t('common:common.none');
  const noUsersFoundLabel = t('hr:workforce.noUsers');
  const authMethodOptions: Array<{ id: UserAuthMethod; name: string }> = [
    { id: 'local', name: t('hr:workforce.authMethod.local') },
    { id: 'ldap', name: t('hr:workforce.authMethod.ldap') },
    { id: 'oidc', name: t('hr:workforce.authMethod.oidc') },
    { id: 'saml', name: t('hr:workforce.authMethod.saml') },
  ];
  const isSsoAuthMethodDraft = isSsoAuthMethod(authMethodDraft);
  const providerOptions = isSsoAuthMethodDraft
    ? ssoProviders.filter((provider) => provider.enabled && provider.protocol === authMethodDraft)
    : [];
  const getAuthMethodLabel = (user: User) => {
    const method = user.authMethod || 'local';
    if (isSsoAuthMethod(method)) {
      const protocol = method.toUpperCase();
      return `${protocol}: ${user.authProviderName || t('hr:workforce.authMethod.providerMissing')}`;
    }
    return t(`hr:workforce.authMethod.${method}`);
  };
  const getUserStatusLabel = (user: User) =>
    user.isDisabled ? t('common:common.disabled') : t('common:common.active');
  const getRolePresentation = (user: User) => {
    const role = roleLookup.get(user.role);
    const isAdminRole = role?.isAdmin || user.role === 'admin';
    const isTopManagerRole = role?.id === TOP_MANAGER_ROLE_ID || user.role === TOP_MANAGER_ROLE_ID;
    const isManagerRole = role?.isSystem && !isAdminRole && role?.id === 'manager';

    return {
      roleBadgeType: (isAdminRole
        ? 'role_admin'
        : isTopManagerRole
          ? 'role_top_manager'
          : isManagerRole
            ? 'role_manager'
            : role?.isSystem
              ? 'role_user'
              : 'role_custom') as StatusType,
      roleName: role?.name || user.role,
    };
  };

  const userColumns: Column<User>[] = [
    {
      header: t('hr:workforce.user'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-zinc-100 text-praetor flex items-center justify-center text-xs font-bold">
            {row.avatarInitials}
          </div>
          <span className="font-bold text-zinc-800">{row.name}</span>
          {row.id === currentUserId && (
            <span className="text-[10px] bg-praetor px-2 py-0.5 rounded text-white font-bold uppercase">
              {t('hr:workforce.you')}
            </span>
          )}
        </div>
      ),
    },
    {
      header: t('hr:workforce.username'),
      accessorKey: 'username',
      cell: ({ row }) => <span className="text-sm text-zinc-600 font-mono">{row.username}</span>,
    },
    {
      header: t('common:labels.email'),
      accessorFn: (user) => user.email || emptyEmailLabel,
      cell: ({ row }) =>
        row.email ? (
          <span className="text-sm font-medium text-zinc-600 break-all">{row.email}</span>
        ) : (
          <span className="text-sm font-medium text-zinc-400">{emptyEmailLabel}</span>
        ),
    },
    {
      header: t('hr:workforce.role'),
      accessorFn: (user) => getRolePresentation(user).roleName,
      cell: ({ row }) => {
        const { roleBadgeType, roleName } = getRolePresentation(row);
        return <StatusBadge type={roleBadgeType} label={roleName} />;
      },
    },
    {
      header: t('hr:workforce.authMethod.column'),
      accessorFn: (user) => getAuthMethodLabel(user),
      cell: ({ row }) => (
        <StatusBadge type={getAuthMethodBadgeType(row)} label={getAuthMethodLabel(row)} />
      ),
    },
    {
      header: t('common:labels.status'),
      accessorFn: (user) => getUserStatusLabel(user),
      cell: ({ row }) => (
        <StatusBadge
          type={row.isDisabled ? 'disabled' : 'active'}
          label={getUserStatusLabel(row)}
        />
      ),
    },
    {
      header: t('hr:workforce.actions'),
      id: 'actions',
      align: 'right',
      sticky: 'right',
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row }) => {
        const hasManagedTopManagerAssignments =
          row.hasTopManagerRole || row.role === TOP_MANAGER_ROLE_ID;

        return (
          <div className="flex items-center justify-end gap-2">
            {canManageAssignments && !hasManagedTopManagerAssignments && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      aria-label={t('hr:workforce.manageAssignments')}
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignments(row.id);
                      }}
                      className="text-zinc-400 hover:text-praetor transition-colors p-2"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('hr:workforce.manageAssignments')}</TooltipContent>
              </Tooltip>
            )}
            {canUpdateUsers && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        aria-label={t('hr:workforce.editUser')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(row);
                        }}
                        className="text-zinc-400 hover:text-praetor transition-colors p-2"
                      >
                        <i className="fa-solid fa-user-pen"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('hr:workforce.editUser')}</TooltipContent>
                </Tooltip>
                {row.employeeType === 'app_user' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          aria-label={t('hr:workforce.authMethod.changeAction')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openAuthMethodDialog(row);
                          }}
                          disabled={row.id === currentUserId}
                          className="text-zinc-400 hover:text-praetor disabled:opacity-0 transition-colors p-2"
                        >
                          <i className="fa-solid fa-key"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('hr:workforce.authMethod.changeAction')}</TooltipContent>
                  </Tooltip>
                )}
                {row.employeeType === 'app_user' && !isProviderManagedIdentity(row) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          aria-label={t('hr:totpReset.action')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openTotpResetDialog(row);
                          }}
                          disabled={row.id === currentUserId}
                          className="text-zinc-400 hover:text-praetor disabled:opacity-0 transition-colors p-2"
                        >
                          <i className="fa-solid fa-shield-halved"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('hr:totpReset.action')}</TooltipContent>
                  </Tooltip>
                )}
                {row.isDisabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          aria-label={t('hr:workforce.reEnableUser')}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateUser(row.id, { isDisabled: false });
                          }}
                          className="text-zinc-400 hover:text-praetor transition-colors p-2 rounded-lg"
                        >
                          <i className="fa-solid fa-rotate-left"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('hr:workforce.reEnableUser')}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          aria-label={t('hr:workforce.disableUser')}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateUser(row.id, { isDisabled: true });
                          }}
                          disabled={row.id === currentUserId}
                          className="text-amber-700 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-0 transition-colors p-2 rounded-lg"
                        >
                          <i className="fa-solid fa-ban"></i>
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('hr:workforce.disableUser')}</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
            {canDeleteUsers && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      aria-label={t('hr:workforce.deleteUser')}
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(row);
                      }}
                      disabled={row.id === currentUserId}
                      className="text-zinc-400 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('hr:workforce.deleteUser')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <Dialog
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelDelete();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader className="items-center text-center sm:text-center">
            <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <TriangleAlert aria-hidden="true" />
            </div>
            <DialogTitle>{t('hr:workforce.deleteUser')}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {t('hr:workforce.deleteConfirmMessage', { name: userToDelete?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button type="button" variant="outline" onClick={cancelDelete}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              {t('hr:workforce.yesDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!authMethodUser}
        onOpenChange={(open) => {
          if (!open) {
            closeAuthMethodDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('hr:workforce.authMethod.changeAction')}</DialogTitle>
            <DialogDescription>
              {t('hr:workforce.authMethod.description', { name: authMethodUser?.name })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t('hr:workforce.authMethod.methodLabel')}
              </label>
              <Select
                value={authMethodDraft}
                onValueChange={(value) => {
                  const next = value as UserAuthMethod;
                  dispatch({
                    type: 'set',
                    values: {
                      authMethodDraft: next,
                      authProviderDraft: '',
                      authMethodError: '',
                    },
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectGroup>
                    {authMethodOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {isSsoAuthMethodDraft && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {t('hr:workforce.authMethod.providerLabel')}
                </label>
                <Select
                  value={authProviderDraft || undefined}
                  onValueChange={(value) => {
                    dispatch({
                      type: 'set',
                      values: { authProviderDraft: value, authMethodError: '' },
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('hr:workforce.authMethod.providerPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    <SelectGroup>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {providerOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('hr:workforce.authMethod.noProviders')}
                  </p>
                )}
              </div>
            )}

            {authMethodError && <p className="text-sm text-destructive">{authMethodError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAuthMethodDialog}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="button" onClick={saveAuthMethod} disabled={isSavingAuthMethod}>
              {isSavingAuthMethod ? t('common:buttons.saving') : t('common:buttons.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!totpResetUser}
        onOpenChange={(open) => {
          if (!open) {
            closeTotpResetDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('hr:totpReset.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('hr:totpReset.confirmDescription', { name: totpResetUser?.name })}
            </DialogDescription>
          </DialogHeader>

          {totpResetError && <p className="text-sm text-destructive">{totpResetError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeTotpResetDialog}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="button" onClick={confirmTotpReset} disabled={isResettingTotp}>
              {isResettingTotp ? t('common:buttons.saving') : t('hr:totpReset.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <Modal isOpen={!!editingUser} onClose={closeEditModal}>
        <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-muted rounded-full flex items-center justify-center">
                <i className="fa-solid fa-user-pen text-praetor"></i>
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                {t('hr:workforce.editUser')}
              </h3>
            </div>

            <div className="space-y-4">
              {editIdentityReadOnly && editingUser && (
                <p className="text-xs text-muted-foreground">
                  {t('hr:workforce.identityManagedByProvider', {
                    provider: getAuthMethodLabel(editingUser),
                  })}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    {t('hr:workforce.name')} {!editIdentityReadOnly && <RequiredMark />}
                  </label>
                  <Input
                    type="text"
                    value={editFirstName}
                    onChange={(e) => {
                      dispatch({ type: 'set', values: { editFirstName: e.target.value } });
                      if (editFormErrors.firstName) {
                        dispatch({ type: 'patchEditFormErrors', value: { firstName: '' } });
                      }
                    }}
                    aria-label={t('hr:workforce.name')}
                    readOnly={editIdentityReadOnly}
                    disabled={editIdentityReadOnly}
                    aria-invalid={Boolean(editFormErrors.firstName)}
                  />
                  {editFormErrors.firstName && (
                    <p className="text-xs text-red-500 mt-1">{editFormErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    {t('hr:workforce.surname')}
                  </label>
                  <Input
                    type="text"
                    value={editSurname}
                    onChange={(e) => {
                      dispatch({ type: 'set', values: { editSurname: e.target.value } });
                      if (editFormErrors.surname) {
                        dispatch({ type: 'patchEditFormErrors', value: { surname: '' } });
                      }
                    }}
                    aria-label={t('hr:workforce.surname')}
                    readOnly={editIdentityReadOnly}
                    disabled={editIdentityReadOnly}
                    aria-invalid={Boolean(editFormErrors.surname)}
                  />
                  {editFormErrors.surname && (
                    <p className="text-xs text-red-500 mt-1">{editFormErrors.surname}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  {t('common:labels.email')}
                </label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => {
                    dispatch({ type: 'set', values: { editEmail: e.target.value } });
                    if (editFormErrors.email) {
                      dispatch({ type: 'patchEditFormErrors', value: { email: '' } });
                    }
                  }}
                  placeholder="e.g. alice.smith@example.com"
                  aria-label={t('common:labels.email')}
                  readOnly={editIdentityReadOnly}
                  disabled={editIdentityReadOnly}
                  aria-invalid={Boolean(editFormErrors.email)}
                />
                {editFormErrors.email && (
                  <p className="text-xs text-red-500 mt-1">{editFormErrors.email}</p>
                )}
              </div>

              {canUpdateUsers && (
                <div>
                  {canEditAssignedRoles ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                          {t('hr:workforce.assignedRoles')}
                        </label>
                        <div className="max-h-36 overflow-y-auto bg-muted/50 border border-border rounded-xl p-2 space-y-1">
                          {roles
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((r) => {
                              const checked = editAssignedRoleIds.includes(r.id);
                              const isPrimary = r.id === editPrimaryRoleId;
                              return (
                                <label
                                  key={r.id}
                                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                    checked ? 'bg-background shadow-sm' : 'hover:bg-accent'
                                  }`}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <Checkbox
                                      checked={checked}
                                      disabled={isPrimary && checked}
                                      onChange={() => {
                                        if (isPrimary && checked) return;
                                        dispatch({ type: 'toggleEditAssignedRole', roleId: r.id });
                                      }}
                                    />
                                    <span className="text-sm font-semibold text-foreground truncate">
                                      {r.name}
                                    </span>
                                  </div>
                                  {isPrimary && (
                                    <span className="text-[10px] font-black uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded">
                                      {t('hr:workforce.primary')}
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {t('hr:workforce.primaryRoleHelp')}
                        </p>
                      </div>

                      <SelectControl
                        label={t('hr:workforce.primaryRole')}
                        options={editAssignedRoleIds.flatMap((id) => {
                          const role = roles.find((r) => r.id === id);
                          return role ? [{ id: role.id, name: role.name }] : [];
                        })}
                        value={editPrimaryRoleId}
                        onChange={(val) =>
                          dispatch({ type: 'set', values: { editPrimaryRoleId: val as string } })
                        }
                        buttonClassName="py-2 text-sm"
                        disabled={isLoadingEditRoles || editAssignedRoleIds.length < 1}
                      />

                      {isLoadingEditRoles && (
                        <p className="text-[10px] text-muted-foreground font-bold">
                          {t('hr:workforce.loadingRoles')}
                        </p>
                      )}
                      {editRolesError && (
                        <p className="text-[10px] text-red-500 font-bold">{editRolesError}</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <SelectControl
                        label={t('hr:workforce.role')}
                        options={roleOptions}
                        value={editRole}
                        onChange={(val) =>
                          dispatch({ type: 'set', values: { editRole: val as string } })
                        }
                        buttonClassName="py-2 text-sm"
                        disabled={isEditingSelf}
                      />
                      {isEditingSelf && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {t('hr:workforce.cannotChangeOwnRole')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {canViewCosts && editingUser && canEditCostFor(editingUser.id) && (
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    {t('hr:workforce.costPerHour')}
                  </label>
                  <div className="flex items-center border border-input bg-transparent dark:bg-input/30 rounded-lg focus-within:ring-2 focus-within:ring-praetor transition-all overflow-hidden">
                    <div className="w-16 flex items-center justify-center text-muted-foreground text-sm font-bold border-r border-input py-2 bg-muted/50">
                      {currency}
                    </div>
                    <ValidatedNumberInput
                      value={editCostPerHour}
                      onValueChange={(value) =>
                        dispatch({ type: 'set', values: { editCostPerHour: value } })
                      }
                      className="flex-1 px-4 py-2 bg-transparent outline-none text-sm font-semibold"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}

              {editingUser?.id !== currentUserId && (
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl border border-border">
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {t('hr:workforce.disabled')}
                    </p>
                  </div>
                  <Toggle
                    checked={editIsDisabled}
                    onChange={(checked) =>
                      dispatch({ type: 'set', values: { editIsDisabled: checked } })
                    }
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="flex-1 py-3 text-sm font-bold text-muted-foreground hover:bg-muted rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!hasEditChanges}
                className={`flex-1 py-3 text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 text-white ${!hasEditChanges ? 'bg-zinc-300 shadow-none cursor-not-allowed' : 'bg-praetor shadow-zinc-200 hover:bg-zinc-800'}`}
              >
                {t('hr:workforce.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
      {/* Create User Dialog */}
      {canCreateUsers && (
        <Dialog
          open={isCreateModalOpen}
          onOpenChange={(open) => {
            if (!open) closeCreateModal();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-5" aria-hidden="true" />
                {t('hr:workforce.createNewUser')}
              </DialogTitle>
              <DialogDescription>{t('hr:workforce.createNewUserDescription')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="create-user-first-name">
                    {t('hr:workforce.name')}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="create-user-first-name"
                    type="text"
                    value={newFirstName}
                    onChange={(e) => {
                      const val = e.target.value;
                      const values: Partial<UserManagementState> = { newFirstName: val };
                      if (!usernameManuallyEdited.current) {
                        const surname = sanitizeUsernamePart(newSurname);
                        const first = sanitizeUsernamePart(val);
                        values.newUsername =
                          first && surname ? `${first}.${surname}` : first || surname;
                      }
                      dispatch({ type: 'set', values });
                      if (formErrors.firstName || formErrors.general) {
                        dispatch({
                          type: 'patchFormErrors',
                          value: { firstName: '', general: '' },
                        });
                      }
                    }}
                    placeholder="e.g. Alice"
                    aria-invalid={!!formErrors.firstName}
                    required
                  />
                  {formErrors.firstName && (
                    <p className="text-xs text-destructive">{formErrors.firstName}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-user-surname">
                    {t('hr:workforce.surname')}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="create-user-surname"
                    type="text"
                    value={newSurname}
                    onChange={(e) => {
                      const val = e.target.value;
                      const values: Partial<UserManagementState> = { newSurname: val };
                      if (!usernameManuallyEdited.current) {
                        const first = sanitizeUsernamePart(newFirstName);
                        const surname = sanitizeUsernamePart(val);
                        values.newUsername =
                          first && surname ? `${first}.${surname}` : first || surname;
                      }
                      dispatch({ type: 'set', values });
                      if (formErrors.surname || formErrors.general) {
                        dispatch({ type: 'patchFormErrors', value: { surname: '', general: '' } });
                      }
                    }}
                    placeholder="e.g. Smith"
                    aria-invalid={!!formErrors.surname}
                    required
                  />
                  {formErrors.surname && (
                    <p className="text-xs text-destructive">{formErrors.surname}</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-email">{t('common:labels.email')}</Label>
                <Input
                  id="create-user-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => {
                    dispatch({ type: 'set', values: { newEmail: e.target.value } });
                    if (formErrors.email || formErrors.general) {
                      dispatch({ type: 'patchFormErrors', value: { email: '', general: '' } });
                    }
                  }}
                  placeholder="e.g. alice.smith@example.com"
                  aria-invalid={!!formErrors.email}
                />
                {formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-username">
                  {t('hr:workforce.username')}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <Input
                  id="create-user-username"
                  type="text"
                  value={newUsername}
                  onChange={(e) => {
                    usernameManuallyEdited.current = true;
                    dispatch({ type: 'set', values: { newUsername: e.target.value } });
                    if (formErrors.username || formErrors.general) {
                      dispatch({ type: 'patchFormErrors', value: { username: '', general: '' } });
                    }
                  }}
                  placeholder="e.g. alice.smith"
                  aria-invalid={!!formErrors.username}
                  required
                />
                {formErrors.username && (
                  <p className="text-xs text-destructive">{formErrors.username}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-password">
                  {t('hr:workforce.password')}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <div className="relative">
                  <Input
                    id="create-user-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => {
                      dispatch({ type: 'set', values: { newPassword: e.target.value } });
                      if (formErrors.password || formErrors.general) {
                        dispatch({ type: 'patchFormErrors', value: { password: '', general: '' } });
                      }
                    }}
                    placeholder={t('hr:workforce.password')}
                    aria-invalid={!!formErrors.password}
                    autoComplete="new-password"
                    required
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'set', values: { showNewPassword: !showNewPassword } })
                    }
                    aria-label={
                      showNewPassword
                        ? t('common:labels.hidePassword')
                        : t('common:labels.showPassword')
                    }
                    aria-pressed={showNewPassword}
                    className="absolute inset-y-0 right-0 flex items-center justify-center px-2 text-muted-foreground hover:text-foreground rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {showNewPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {formErrors.password && (
                  <p className="text-xs text-destructive">{formErrors.password}</p>
                )}
              </div>
              <SelectControl
                id="create-user-role"
                label={t('hr:workforce.role')}
                options={roleOptions}
                value={newRole}
                onChange={(val) => dispatch({ type: 'set', values: { newRole: val as string } })}
              />

              {formErrors.general && (
                <p className="text-sm font-medium text-destructive">{formErrors.general}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeCreateModal}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit">{t('common:buttons.add')}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {canCreateUsers && (
        <div className="flex justify-end">
          <HeaderAddButton
            onClick={() => dispatch({ type: 'set', values: { isCreateModalOpen: true } })}
          >
            {t('hr:workforce.addUser')}
          </HeaderAddButton>
        </div>
      )}

      <StandardTable<User>
        title={t('hr:workforce.title')}
        viewKey="admin.users"
        data={sortedUsers}
        columns={userColumns}
        defaultRowsPerPage={5}
        emptyState={noUsersFoundLabel}
        rowClassName={(user) =>
          user.isDisabled
            ? 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-zinc-50'
            : 'hover:bg-zinc-50'
        }
        onRowClick={canUpdateUsers ? handleEdit : undefined}
      />

      {/* Assignment Modal */}
      <Modal
        isOpen={!!managingUserId}
        onClose={closeAssignments}
        zIndex={50}
        backdropClass="bg-zinc-900/50 backdrop-blur-sm"
      >
        <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/50">
            <h3 className="font-semibold text-lg text-foreground">
              {t('hr:workforce.manageAccess', { name: managingUser?.name })}
            </h3>
            <button
              type="button"
              onClick={closeAssignments}
              aria-label={t('common:buttons.close')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {isLoadingAssignments ? (
              <div className="flex items-center justify-center py-12">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <SelectControl
                    options={clientFilterOptions}
                    value={filterClientId}
                    onChange={(val) =>
                      dispatch({ type: 'set', values: { filterClientId: val as string } })
                    }
                    placeholder={t('hr:workforce.filterByClient')}
                    searchable={true}
                    buttonClassName="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-semibold text-foreground shadow-sm"
                  />
                  <SelectControl
                    options={projectFilterOptions}
                    value={filterProjectId}
                    onChange={(val) =>
                      dispatch({ type: 'set', values: { filterProjectId: val as string } })
                    }
                    placeholder={t('hr:workforce.filterByProject')}
                    searchable={true}
                    buttonClassName="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-semibold text-foreground shadow-sm"
                    disabled={projectFilterOptions.length === 1}
                  />
                </div>

                <div
                  className={`grid grid-cols-1 ${canManageAssignments ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}
                >
                  {/* Clients Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-card z-10 pb-2 border-b border-border mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-semibold text-foreground text-sm uppercase tracking-wider">
                          {t('hr:workforce.clients')}
                        </h4>
                        <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                          {assignments.clientIds.length}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder={t('hr:workforce.searchClients')}
                        aria-label={t('hr:workforce.searchClients')}
                        value={clientSearch}
                        onChange={(e) =>
                          dispatch({ type: 'set', values: { clientSearch: e.target.value } })
                        }
                        className="w-full px-3 py-1.5 text-sm border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-praetor outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleClients.map((client) => (
                        <label
                          key={client.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.clientIds.includes(client.id)
                              ? 'bg-accent border-border shadow-sm'
                              : 'bg-card border-border hover:border-input'
                          }`}
                        >
                          <div className="relative flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              checked={assignments.clientIds.includes(client.id)}
                              onChange={() => toggleAssignment('client', client.id)}
                              aria-label={client.name}
                              className="sr-only peer"
                            />
                            <div className="size-5 rounded-full border-2 border-border relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-background shadow-sm flex items-center justify-center">
                              <div
                                className={`size-2 rounded-full transition-all duration-200 ${assignments.clientIds.includes(client.id) ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'}`}
                              ></div>
                            </div>
                          </div>
                          <span
                            className={`text-sm font-semibold ${assignments.clientIds.includes(client.id) ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {client.name}
                          </span>
                        </label>
                      ))}
                      {clients.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">
                          {t('hr:workforce.noClientsFound')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Projects Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-card z-10 pb-2 border-b border-border mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-semibold text-foreground text-sm uppercase tracking-wider">
                          Projects
                        </h4>
                        <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                          {assignments.projectIds.length}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder={t('hr:workforce.searchProjects')}
                        aria-label={t('hr:workforce.searchProjects')}
                        value={projectSearch}
                        onChange={(e) =>
                          dispatch({ type: 'set', values: { projectSearch: e.target.value } })
                        }
                        className="w-full px-3 py-1.5 text-sm border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-praetor outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleProjects.map((project) => (
                        <label
                          key={project.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.projectIds.includes(project.id)
                              ? 'bg-accent border-border shadow-sm'
                              : 'bg-card border-border hover:border-input'
                          }`}
                        >
                          <div className="relative flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              checked={assignments.projectIds.includes(project.id)}
                              onChange={() => toggleAssignment('project', project.id)}
                              aria-label={project.name}
                              className="sr-only peer"
                            />
                            <div className="size-5 rounded-full border-2 border-border relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-background shadow-sm flex items-center justify-center">
                              <div
                                className={`size-2 rounded-full transition-all duration-200 ${assignments.projectIds.includes(project.id) ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'}`}
                              ></div>
                            </div>
                          </div>
                          <div className="flex flex-col">
                            <span
                              className={`text-sm font-semibold ${assignments.projectIds.includes(project.id) ? 'text-foreground' : 'text-muted-foreground'}`}
                            >
                              {project.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {clients.find((c) => c.id === project.clientId)?.name ||
                                t('hr:workforce.unknownClient')}
                            </span>
                          </div>
                        </label>
                      ))}
                      {projects.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">
                          {t('hr:workforce.noProjectsFound')}
                        </p>
                      )}
                    </div>
                  </div>

                  {canManageAssignments && (
                    <div className="space-y-3">
                      <div className="sticky top-0 bg-card z-10 pb-2 border-b border-border mb-2">
                        <div className="flex items-center justify-between py-2">
                          <h4 className="font-semibold text-foreground text-sm uppercase tracking-wider">
                            Tasks
                          </h4>
                          <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                            {assignments.taskIds.length}
                          </span>
                        </div>
                        <input
                          type="text"
                          placeholder={t('hr:workforce.searchTasks')}
                          aria-label={t('hr:workforce.searchTasks')}
                          value={taskSearch}
                          onChange={(e) =>
                            dispatch({ type: 'set', values: { taskSearch: e.target.value } })
                          }
                          className="w-full px-3 py-1.5 text-sm border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-praetor outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                      <div className="space-y-2">
                        {visibleTasks.map((task) => {
                          const project = projects.find((p) => p.id === task.projectId);
                          return (
                            <label
                              key={task.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                assignments.taskIds.includes(task.id)
                                  ? 'bg-accent border-border shadow-sm'
                                  : 'bg-card border-border hover:border-input'
                              }`}
                            >
                              <div className="relative flex items-center justify-center shrink-0">
                                <input
                                  type="checkbox"
                                  checked={assignments.taskIds.includes(task.id)}
                                  onChange={() => toggleAssignment('task', task.id)}
                                  aria-label={task.name}
                                  className="sr-only peer"
                                />
                                <div className="size-5 rounded-full border-2 border-border relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-background shadow-sm flex items-center justify-center">
                                  <div
                                    className={`size-2 rounded-full transition-all duration-200 ${assignments.taskIds.includes(task.id) ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'}`}
                                  ></div>
                                </div>
                              </div>
                              <div className="flex flex-col">
                                <span
                                  className={`text-sm font-semibold ${assignments.taskIds.includes(task.id) ? 'text-foreground' : 'text-muted-foreground'}`}
                                >
                                  {task.name}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {project?.name || t('hr:workforce.unknownProject')}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                        {tasks.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">
                            {t('hr:workforce.noTasksFound')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="p-6 border-t border-border bg-muted/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={closeAssignments}
              className="px-4 py-2 text-muted-foreground font-bold hover:bg-muted rounded-lg transition-colors text-sm"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={saveAssignments}
              disabled={JSON.stringify(assignments) === JSON.stringify(initialAssignments)}
              className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm active:scale-95 text-sm ${JSON.stringify(assignments) === JSON.stringify(initialAssignments) ? 'bg-muted text-muted-foreground cursor-not-allowed border border-border' : 'bg-praetor text-white hover:bg-praetor/90'}`}
            >
              {t('hr:workforce.saveAssignments')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default UserManagement;
