import { Eye, EyeOff, UserPlus } from 'lucide-react';
import React, { useState } from 'react';
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
import { toastError } from '../../utils/toast';
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
  currentUserId: string;
  permissions: string[];
  roles: Role[];
  ssoProviders: SsoProvider[];
  currency: string;
}

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
  currentUserId,
  permissions,
  roles,
  ssoProviders,
  currency,
}) => {
  const { t } = useTranslation(['hr', 'common']);

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

  const [newFirstName, setNewFirstName] = useState('');
  const [newSurname, setNewSurname] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>(roleOptions[0]?.id || '');
  const usernameManuallyEdited = React.useRef(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [managingUserId, setManagingUserId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<{
    clientIds: string[];
    projectIds: string[];
    taskIds: string[];
  }>({
    clientIds: [],
    projectIds: [],
    taskIds: [],
  });
  const [initialAssignments, setInitialAssignments] = useState<{
    clientIds: string[];
    projectIds: string[];
    taskIds: string[];
  }>({
    clientIds: [],
    projectIds: [],
    taskIds: [],
  });
  const [clientSearch, setClientSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');
  const [filterProjectId, setFilterProjectId] = useState('all');

  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editSurname, setEditSurname] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<string>('');
  const [editAssignedRoleIds, setEditAssignedRoleIds] = useState<string[]>([]);
  const [editPrimaryRoleId, setEditPrimaryRoleId] = useState<string>('');
  const [initialEditAssignedRoleIds, setInitialEditAssignedRoleIds] = useState<string[]>([]);
  const [initialEditPrimaryRoleId, setInitialEditPrimaryRoleId] = useState<string>('');
  const [isLoadingEditRoles, setIsLoadingEditRoles] = useState(false);
  const [editRolesError, setEditRolesError] = useState('');
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({});
  const [editCostPerHour, setEditCostPerHour] = useState<string>('0');
  const [editIsDisabled, setEditIsDisabled] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [authMethodUser, setAuthMethodUser] = useState<User | null>(null);
  const [authMethodDraft, setAuthMethodDraft] = useState<UserAuthMethod>('local');
  const [authProviderDraft, setAuthProviderDraft] = useState<string>('');
  const [authMethodError, setAuthMethodError] = useState('');
  const [isSavingAuthMethod, setIsSavingAuthMethod] = useState(false);

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
  React.useEffect(() => {
    if (!newRole && roleOptions[0]?.id) {
      setNewRole(roleOptions[0].id);
    }
  }, [newRole, roleOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    const newErrors: Record<string, string> = {};
    if (!newFirstName?.trim()) newErrors.firstName = t('common:validation.nameRequired');
    if (!newSurname?.trim()) newErrors.surname = t('common:validation.surnameRequired');
    if (newEmail.trim() && !isValidEmail(newEmail)) {
      newErrors.email = t('common:validation.invalidEmail');
    }
    if (!newUsername?.trim()) newErrors.username = t('common:validation.usernameRequired');
    if (!newPassword?.trim()) newErrors.password = t('common:validation.passwordRequired');

    if (Object.keys(newErrors).length > 0) {
      setFormErrors(newErrors);
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
        setFormErrors({ username: t('common:validation.usernameAlreadyExists') || result.error });
      } else if (result.error?.toLowerCase().includes('email')) {
        setFormErrors({ email: t('common:validation.invalidEmail') || result.error });
      } else {
        setFormErrors({ general: result.error || t('common:messages.errorOccurred') });
      }
      return;
    }

    resetCreateUserForm();
    setIsCreateModalOpen(false);
  };

  const resetCreateUserForm = () => {
    setNewFirstName('');
    setNewSurname('');
    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setShowNewPassword(false);
    setNewRole(roleOptions[0]?.id || '');
    usernameManuallyEdited.current = false;
    setFormErrors({});
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    resetCreateUserForm();
  };

  React.useEffect(() => {
    if (filterClientId === 'all' || filterProjectId === 'all') return;
    const selectedProject = projects.find((project) => project.id === filterProjectId);
    if (!selectedProject || selectedProject.clientId !== filterClientId) {
      setFilterProjectId('all');
    }
  }, [filterClientId, filterProjectId, projects]);

  const openAssignments = async (userId: string) => {
    if (!canManageAssignments) return;
    setManagingUserId(userId);
    setIsLoadingAssignments(true);
    try {
      const data = await usersApi.getAssignments(userId);
      setAssignments(data);
      setInitialAssignments(JSON.parse(JSON.stringify(data))); // Deep clone for comparison
    } catch (err) {
      console.error('Failed to load assignments', err);
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const closeAssignments = () => {
    setManagingUserId(null);
    setAssignments({ clientIds: [], projectIds: [], taskIds: [] });
    setClientSearch('');
    setProjectSearch('');
    setTaskSearch('');
    setFilterClientId('all');
    setFilterProjectId('all');
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
    setAssignments((prev) => {
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
    });
  };

  const confirmDelete = (user: User) => {
    setUserToDelete(user);
    setIsDeleteConfirmOpen(true);
  };

  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
    setUserToDelete(null);
  };

  const handleDelete = () => {
    if (userToDelete) {
      onDeleteUser(userToDelete.id);
      setIsDeleteConfirmOpen(false);
      setUserToDelete(null);
    }
  };

  const handleEdit = (user: User) => {
    const { firstName, surname } = splitFullName(user.name);
    setEditingUser(user);
    setEditFirstName(firstName);
    setEditSurname(surname);
    setEditEmail(user.email || '');
    setEditRole(user.role);
    setEditCostPerHour(user.costPerHour?.toString() || '0');
    setEditIsDisabled(!!user.isDisabled);
    setEditFormErrors({});

    // Multi-role edit state (admin-only in practice because roles are admin-scoped)
    setEditRolesError('');
    if (user.id === currentUserId || roles.length === 0) {
      const fallback = [user.role];
      setEditAssignedRoleIds(fallback);
      setEditPrimaryRoleId(user.role);
      setInitialEditAssignedRoleIds(fallback);
      setInitialEditPrimaryRoleId(user.role);
      return;
    }

    setIsLoadingEditRoles(true);
    usersApi
      .getRoles(user.id)
      .then(({ roleIds, primaryRoleId }) => {
        const safeRoleIds = roleIds?.length ? roleIds : [user.role];
        const safePrimary = primaryRoleId || user.role;
        setEditAssignedRoleIds(safeRoleIds);
        setEditPrimaryRoleId(safePrimary);
        setInitialEditAssignedRoleIds(safeRoleIds);
        setInitialEditPrimaryRoleId(safePrimary);
      })
      .catch((err) => {
        console.error('Failed to load user roles:', err);
        setEditRolesError((err as Error).message || 'Failed to load roles');
        const fallback = [user.role];
        setEditAssignedRoleIds(fallback);
        setEditPrimaryRoleId(user.role);
        setInitialEditAssignedRoleIds(fallback);
        setInitialEditPrimaryRoleId(user.role);
      })
      .finally(() => {
        setIsLoadingEditRoles(false);
      });
  };

  const openAuthMethodDialog = (user: User) => {
    const method = user.authMethod || 'local';
    setAuthMethodUser(user);
    setAuthMethodDraft(method);
    setAuthProviderDraft(user.authProviderId || '');
    setAuthMethodError('');
  };

  const closeAuthMethodDialog = () => {
    if (isSavingAuthMethod) return;
    setAuthMethodUser(null);
    setAuthMethodError('');
  };

  const saveAuthMethod = async () => {
    if (!authMethodUser) return;
    const requiresProvider = isSsoAuthMethod(authMethodDraft);
    if (requiresProvider && !authProviderDraft) {
      setAuthMethodError(t('hr:workforce.authMethod.providerRequired'));
      return;
    }
    setIsSavingAuthMethod(true);
    setAuthMethodError('');
    try {
      await onUpdateUserAuthMethod(
        authMethodUser.id,
        authMethodDraft,
        requiresProvider ? authProviderDraft : null,
      );
      setAuthMethodUser(null);
    } catch (err) {
      setAuthMethodError((err as Error).message || t('common:messages.errorOccurred'));
    } finally {
      setIsSavingAuthMethod(false);
    }
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditRolesError('');
    setEditFormErrors({});
  };

  const sameStringSet = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const as = new Set(a);
    for (const v of b) if (!as.has(v)) return false;
    return true;
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
        setEditFormErrors(newErrors);
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
          setEditRolesError(t('hr:workforce.primaryRoleMustBeAssigned'));
          return;
        }
        if (editAssignedRoleIds.length < 1) {
          setEditRolesError(t('hr:workforce.assignedRolesRequired'));
          return;
        }
        setIsLoadingEditRoles(true);
        try {
          await onUpdateUserRoles(editingUser.id, editAssignedRoleIds, editPrimaryRoleId);
        } catch {
          // onUpdateUserRoles already surfaced an error
          return;
        } finally {
          setIsLoadingEditRoles(false);
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
      [...users].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
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
      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={cancelDelete}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="size-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">
                {t('hr:workforce.deleteUser')}
              </h3>
              <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
                {t('hr:workforce.deleteConfirmMessage', { name: userToDelete?.name })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={cancelDelete}
                className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('hr:workforce.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

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
                  setAuthMethodDraft(next);
                  setAuthProviderDraft('');
                  setAuthMethodError('');
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
                    setAuthProviderDraft(value);
                    setAuthMethodError('');
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

      {/* Edit User Modal */}
      <Modal isOpen={!!editingUser} onClose={closeEditModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 bg-zinc-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-user-pen text-praetor"></i>
              </div>
              <h3 className="text-lg font-semibold text-zinc-800">{t('hr:workforce.editUser')}</h3>
            </div>

            <div className="space-y-4">
              {editIdentityReadOnly && editingUser && (
                <p className="text-xs text-zinc-500">
                  {t('hr:workforce.identityManagedByProvider', {
                    provider: getAuthMethodLabel(editingUser),
                  })}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    {t('hr:workforce.name')}
                  </label>
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={(e) => {
                      setEditFirstName(e.target.value);
                      if (editFormErrors.firstName) {
                        setEditFormErrors((prev) => ({ ...prev, firstName: '' }));
                      }
                    }}
                    aria-label={t('hr:workforce.name')}
                    readOnly={editIdentityReadOnly}
                    disabled={editIdentityReadOnly}
                    className={`w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold ${
                      editFormErrors.firstName ? 'border-red-400' : 'border-zinc-200'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  />
                  {editFormErrors.firstName && (
                    <p className="text-xs text-red-500 mt-1">{editFormErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    {t('hr:workforce.surname')}
                  </label>
                  <input
                    type="text"
                    value={editSurname}
                    onChange={(e) => {
                      setEditSurname(e.target.value);
                      if (editFormErrors.surname) {
                        setEditFormErrors((prev) => ({ ...prev, surname: '' }));
                      }
                    }}
                    aria-label={t('hr:workforce.surname')}
                    readOnly={editIdentityReadOnly}
                    disabled={editIdentityReadOnly}
                    className={`w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold ${
                      editFormErrors.surname ? 'border-red-400' : 'border-zinc-200'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  />
                  {editFormErrors.surname && (
                    <p className="text-xs text-red-500 mt-1">{editFormErrors.surname}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                  {t('common:labels.email')}
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => {
                    setEditEmail(e.target.value);
                    if (editFormErrors.email) {
                      setEditFormErrors((prev) => ({ ...prev, email: '' }));
                    }
                  }}
                  placeholder="e.g. alice.smith@example.com"
                  aria-label={t('common:labels.email')}
                  readOnly={editIdentityReadOnly}
                  disabled={editIdentityReadOnly}
                  className={`w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold ${
                    editFormErrors.email ? 'border-red-400' : 'border-zinc-200'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
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
                        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                          {t('hr:workforce.assignedRoles')}
                        </label>
                        <div className="max-h-36 overflow-y-auto bg-zinc-50 border border-zinc-200 rounded-xl p-2 space-y-1">
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
                                    checked ? 'bg-white' : 'hover:bg-white/60'
                                  }`}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <Checkbox
                                      checked={checked}
                                      disabled={isPrimary && checked}
                                      onChange={() => {
                                        if (isPrimary && checked) return;
                                        setEditAssignedRoleIds((prev) => {
                                          if (prev.includes(r.id)) {
                                            return prev.filter((id) => id !== r.id);
                                          }
                                          return [...prev, r.id];
                                        });
                                      }}
                                    />
                                    <span className="text-sm font-semibold text-zinc-700 truncate">
                                      {r.name}
                                    </span>
                                  </div>
                                  {isPrimary && (
                                    <span className="text-[10px] font-black uppercase tracking-wider bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">
                                      {t('hr:workforce.primary')}
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1">
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
                        onChange={(val) => setEditPrimaryRoleId(val as string)}
                        buttonClassName="py-2 text-sm"
                        disabled={isLoadingEditRoles || editAssignedRoleIds.length < 1}
                      />

                      {isLoadingEditRoles && (
                        <p className="text-[10px] text-zinc-400 font-bold">
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
                        onChange={(val) => setEditRole(val as string)}
                        buttonClassName="py-2 text-sm"
                        disabled={isEditingSelf}
                      />
                      {isEditingSelf && (
                        <p className="text-[10px] text-zinc-400 mt-1">
                          {t('hr:workforce.cannotChangeOwnRole')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {canViewCosts && editingUser && canEditCostFor(editingUser.id) && (
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    {t('hr:workforce.costPerHour')}
                  </label>
                  <div className="flex items-center bg-zinc-50 border border-zinc-200 rounded-lg focus-within:ring-2 focus-within:ring-praetor transition-all overflow-hidden">
                    <div className="w-16 flex items-center justify-center text-zinc-400 text-sm font-bold border-r border-zinc-200 py-2 bg-zinc-100/30">
                      {currency}
                    </div>
                    <ValidatedNumberInput
                      value={editCostPerHour}
                      onValueChange={setEditCostPerHour}
                      className="flex-1 px-4 py-2 bg-transparent outline-none text-sm font-semibold"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}

              {editingUser?.id !== currentUserId && (
                <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-700">{t('hr:workforce.disabled')}</p>
                  </div>
                  <Toggle checked={editIsDisabled} onChange={setEditIsDisabled} />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-50 rounded-xl transition-colors"
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
                      setNewFirstName(val);
                      if (!usernameManuallyEdited.current) {
                        const surname = sanitizeUsernamePart(newSurname);
                        const first = sanitizeUsernamePart(val);
                        setNewUsername(first && surname ? `${first}.${surname}` : first || surname);
                      }
                      if (formErrors.firstName || formErrors.general) {
                        setFormErrors((prev) => ({ ...prev, firstName: '', general: '' }));
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
                      setNewSurname(val);
                      if (!usernameManuallyEdited.current) {
                        const first = sanitizeUsernamePart(newFirstName);
                        const surname = sanitizeUsernamePart(val);
                        setNewUsername(first && surname ? `${first}.${surname}` : first || surname);
                      }
                      if (formErrors.surname || formErrors.general) {
                        setFormErrors((prev) => ({ ...prev, surname: '', general: '' }));
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
                    setNewEmail(e.target.value);
                    if (formErrors.email || formErrors.general) {
                      setFormErrors((prev) => ({ ...prev, email: '', general: '' }));
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
                    setNewUsername(e.target.value);
                    if (formErrors.username || formErrors.general) {
                      setFormErrors((prev) => ({ ...prev, username: '', general: '' }));
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
                      setNewPassword(e.target.value);
                      if (formErrors.password || formErrors.general) {
                        setFormErrors((prev) => ({ ...prev, password: '', general: '' }));
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
                    onClick={() => setShowNewPassword((prev) => !prev)}
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
                onChange={(val) => setNewRole(val as string)}
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
          <HeaderAddButton onClick={() => setIsCreateModalOpen(true)}>
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
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50">
            <h3 className="font-semibold text-lg text-zinc-800">
              {t('hr:workforce.manageAccess', { name: managingUser?.name })}
            </h3>
            <button
              type="button"
              onClick={closeAssignments}
              aria-label={t('common:buttons.close')}
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
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
                    onChange={(val) => setFilterClientId(val as string)}
                    placeholder={t('hr:workforce.filterByClient')}
                    searchable={true}
                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 shadow-sm"
                  />
                  <SelectControl
                    options={projectFilterOptions}
                    value={filterProjectId}
                    onChange={(val) => setFilterProjectId(val as string)}
                    placeholder={t('hr:workforce.filterByProject')}
                    searchable={true}
                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 shadow-sm"
                    disabled={projectFilterOptions.length === 1}
                  />
                </div>

                <div
                  className={`grid grid-cols-1 ${canManageAssignments ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}
                >
                  {/* Clients Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-white z-10 pb-2 border-b border-zinc-100 mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-semibold text-zinc-700 text-sm uppercase tracking-wider">
                          {t('hr:workforce.clients')}
                        </h4>
                        <span className="text-xs font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">
                          {assignments.clientIds.length}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder={t('hr:workforce.searchClients')}
                        aria-label={t('hr:workforce.searchClients')}
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleClients.map((client) => (
                        <label
                          key={client.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.clientIds.includes(client.id)
                              ? 'bg-zinc-50 border-zinc-300 shadow-sm'
                              : 'bg-white border-zinc-200 hover:border-zinc-300'
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
                            <div className="size-5 rounded-full border-2 border-zinc-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                              <div
                                className={`size-2 rounded-full transition-all duration-200 ${assignments.clientIds.includes(client.id) ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'}`}
                              ></div>
                            </div>
                          </div>
                          <span
                            className={`text-sm font-semibold ${assignments.clientIds.includes(client.id) ? 'text-zinc-900' : 'text-zinc-600'}`}
                          >
                            {client.name}
                          </span>
                        </label>
                      ))}
                      {clients.length === 0 && (
                        <p className="text-xs text-zinc-400 italic">
                          {t('hr:workforce.noClientsFound')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Projects Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-white z-10 pb-2 border-b border-zinc-100 mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-semibold text-zinc-700 text-sm uppercase tracking-wider">
                          Projects
                        </h4>
                        <span className="text-xs font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">
                          {assignments.projectIds.length}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder={t('hr:workforce.searchProjects')}
                        aria-label={t('hr:workforce.searchProjects')}
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleProjects.map((project) => (
                        <label
                          key={project.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.projectIds.includes(project.id)
                              ? 'bg-zinc-50 border-zinc-300 shadow-sm'
                              : 'bg-white border-zinc-200 hover:border-zinc-300'
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
                            <div className="size-5 rounded-full border-2 border-zinc-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                              <div
                                className={`size-2 rounded-full transition-all duration-200 ${assignments.projectIds.includes(project.id) ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'}`}
                              ></div>
                            </div>
                          </div>
                          <div className="flex flex-col">
                            <span
                              className={`text-sm font-semibold ${assignments.projectIds.includes(project.id) ? 'text-zinc-900' : 'text-zinc-600'}`}
                            >
                              {project.name}
                            </span>
                            <span className="text-[10px] text-zinc-400">
                              {clients.find((c) => c.id === project.clientId)?.name ||
                                t('hr:workforce.unknownClient')}
                            </span>
                          </div>
                        </label>
                      ))}
                      {projects.length === 0 && (
                        <p className="text-xs text-zinc-400 italic">
                          {t('hr:workforce.noProjectsFound')}
                        </p>
                      )}
                    </div>
                  </div>

                  {canManageAssignments && (
                    <div className="space-y-3">
                      <div className="sticky top-0 bg-white z-10 pb-2 border-b border-zinc-100 mb-2">
                        <div className="flex items-center justify-between py-2">
                          <h4 className="font-semibold text-zinc-700 text-sm uppercase tracking-wider">
                            Tasks
                          </h4>
                          <span className="text-xs font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">
                            {assignments.taskIds.length}
                          </span>
                        </div>
                        <input
                          type="text"
                          placeholder={t('hr:workforce.searchTasks')}
                          aria-label={t('hr:workforce.searchTasks')}
                          value={taskSearch}
                          onChange={(e) => setTaskSearch(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
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
                                  ? 'bg-zinc-50 border-zinc-300 shadow-sm'
                                  : 'bg-white border-zinc-200 hover:border-zinc-300'
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
                                <div className="size-5 rounded-full border-2 border-zinc-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                                  <div
                                    className={`size-2 rounded-full transition-all duration-200 ${assignments.taskIds.includes(task.id) ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'}`}
                                  ></div>
                                </div>
                              </div>
                              <div className="flex flex-col">
                                <span
                                  className={`text-sm font-semibold ${assignments.taskIds.includes(task.id) ? 'text-zinc-900' : 'text-zinc-600'}`}
                                >
                                  {task.name}
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  {project?.name || t('hr:workforce.unknownProject')}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                        {tasks.length === 0 && (
                          <p className="text-xs text-zinc-400 italic">
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

          <div className="p-6 border-t border-zinc-200 bg-zinc-50 flex justify-end gap-3">
            <button
              type="button"
              onClick={closeAssignments}
              className="px-4 py-2 text-zinc-600 font-bold hover:bg-zinc-200 rounded-lg transition-colors text-sm"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={saveAssignments}
              disabled={JSON.stringify(assignments) === JSON.stringify(initialAssignments)}
              className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm active:scale-95 text-sm ${JSON.stringify(assignments) === JSON.stringify(initialAssignments) ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200' : 'bg-praetor text-white hover:bg-zinc-800'}`}
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
