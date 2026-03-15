import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usersApi } from '../../services/api';
import type { Client, Project, ProjectTask, Role, User } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import Checkbox from '../shared/Checkbox';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Toggle from '../shared/Toggle';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

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
  currentUserId: string;
  permissions: string[];
  roles: Role[];
  currency: string;
}

const USERS_ROWS_PER_PAGE_STORAGE_KEY = 'praetor_workforce_users_rowsPerPage';

const UserManagement: React.FC<UserManagementProps> = ({
  users,
  clients,
  projects,
  tasks,
  onAddUser,
  onDeleteUser,
  onUpdateUser,
  onUpdateUserRoles,
  currentUserId,
  permissions,
  roles,
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
  const [userSearch, setUserSearch] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [usersCurrentPage, setUsersCurrentPage] = useState(1);
  const [usersRowsPerPage, setUsersRowsPerPage] = useState(() => {
    const saved = localStorage.getItem(USERS_ROWS_PER_PAGE_STORAGE_KEY);
    return saved ? parseInt(saved, 10) : 5;
  });

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
  const canViewCosts = hasPermission(permissions, buildPermission('hr.costs', 'view'));
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

    setNewFirstName('');
    setNewSurname('');
    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setNewRole(roleOptions[0]?.id || '');
    usernameManuallyEdited.current = false;
    setIsCreateModalOpen(false);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setNewFirstName('');
    setNewSurname('');
    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setNewRole(roleOptions[0]?.id || '');
    usernameManuallyEdited.current = false;
    setFormErrors({});
  };

  const handleUsersRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setUsersRowsPerPage(value);
    localStorage.setItem(USERS_ROWS_PER_PAGE_STORAGE_KEY, value.toString());
    setUsersCurrentPage(1);
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
      alert(t('hr:workUnits.failedToSaveAssignments'));
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
      const newErrors: Record<string, string> = {};
      const originalHasSurname = !!splitFullName(editingUser.name).surname.trim();
      if (!editFirstName.trim()) newErrors.firstName = t('common:validation.nameRequired');
      if (originalHasSurname && !editSurname.trim()) {
        newErrors.surname = t('common:validation.surnameRequired');
      }
      if (editEmail.trim() && !isValidEmail(editEmail)) {
        newErrors.email = t('common:validation.invalidEmail');
      }

      if (Object.keys(newErrors).length > 0) {
        setEditFormErrors(newErrors);
        return;
      }

      const updates: Partial<User> = {
        name: buildFullName(editFirstName, editSurname),
        email: editEmail.trim(),
        isDisabled: editIsDisabled,
      };

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

      if (canViewCosts && canUpdateUsers) {
        updates.costPerHour = parseFloat(editCostPerHour) || 0;
      }

      onUpdateUser(editingUser?.id, updates);
      closeEditModal();
    }
  };

  const managingUser = users.find((u) => u.id === managingUserId);
  const isEditingSelf = editingUser?.id === currentUserId;
  const canEditRole = canUpdateUsers && !isEditingSelf;
  const canEditAssignedRoles = canUpdateUsers && !isEditingSelf && roles.length > 0;
  const hasAssignedRoleChanges =
    !!editingUser &&
    canEditAssignedRoles &&
    (!sameStringSet(editAssignedRoleIds, initialEditAssignedRoleIds) ||
      editPrimaryRoleId !== initialEditPrimaryRoleId);
  const hasEditChanges =
    !!editingUser &&
    (buildFullName(editFirstName, editSurname) !== editingUser.name ||
      editEmail.trim() !== (editingUser.email || '') ||
      editIsDisabled !== !!editingUser.isDisabled ||
      (canViewCosts &&
        canUpdateUsers &&
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

    // Debug logging
    console.log('UserManagement Debug:', {
      clientsCount: clients.length,
      projectsCount: projects.length,
      tasksCount: tasks.length,
      visibleClientsCount: visibleClients.length,
      visibleProjectsCount: visibleProjects.length,
      visibleTasksCount: visibleTasks.length,
      filterClientId,
      filterProjectId,
      clientSearch,
      assignments,
    });

    return { visibleClients, visibleProjects, visibleTasks };
  };

  const { visibleClients, visibleProjects, visibleTasks } = getFilteredData();

  const userSearchValue = userSearch.trim().toLowerCase();
  const matchesUserSearch = (user: User, term: string) => {
    if (!term) return true;
    return (
      user.name.toLowerCase().includes(term) ||
      user.username.toLowerCase().includes(term) ||
      (user.email?.toLowerCase() || '').includes(term)
    );
  };
  const usersFiltered = [...users]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .filter((user) => matchesUserSearch(user, userSearchValue));

  const usersTotalPages = Math.ceil(usersFiltered.length / usersRowsPerPage);

  React.useEffect(() => {
    if (usersTotalPages === 0) {
      if (usersCurrentPage !== 1) {
        setUsersCurrentPage(1);
      }
      return;
    }

    if (usersCurrentPage > usersTotalPages) {
      setUsersCurrentPage(usersTotalPages);
    }
  }, [usersCurrentPage, usersTotalPages]);

  const usersStartIndex = (usersCurrentPage - 1) * usersRowsPerPage;
  const paginatedUsers = usersFiltered.slice(usersStartIndex, usersStartIndex + usersRowsPerPage);
  const emptyEmailLabel = t('common:common.none');
  const noUsersFoundLabel = t('hr:workforce.noUsers');
  const getUserStatusLabel = (user: User) =>
    user.isDisabled ? t('common:common.disabled') : t('common:common.active');
  const getRolePresentation = (user: User) => {
    const role = roleLookup.get(user.role);
    const isAdminRole = role?.isAdmin || user.role === 'admin';
    const isManagerRole = role?.isSystem && !isAdminRole && role?.id === 'manager';

    return {
      roleBadgeClass: isAdminRole
        ? 'bg-slate-800 text-white border-slate-700'
        : isManagerRole
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : role?.isSystem
            ? 'bg-slate-100 text-slate-600 border-slate-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      roleIcon: isAdminRole ? 'fa-shield-halved' : isManagerRole ? 'fa-briefcase' : 'fa-user',
      roleName: role?.name || user.role,
    };
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={cancelDelete}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">{t('hr:workforce.deleteUser')}</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('hr:workforce.deleteConfirmMessage', { name: userToDelete?.name })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={cancelDelete}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('hr:workforce.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={!!editingUser} onClose={closeEditModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-user-pen text-praetor"></i>
              </div>
              <h3 className="text-lg font-black text-slate-800">{t('hr:workforce.editUser')}</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
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
                    className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold ${
                      editFormErrors.firstName ? 'border-red-400' : 'border-slate-200'
                    }`}
                  />
                  {editFormErrors.firstName && (
                    <p className="text-xs text-red-500 mt-1">{editFormErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
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
                    className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold ${
                      editFormErrors.surname ? 'border-red-400' : 'border-slate-200'
                    }`}
                  />
                  {editFormErrors.surname && (
                    <p className="text-xs text-red-500 mt-1">{editFormErrors.surname}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
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
                  className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold ${
                    editFormErrors.email ? 'border-red-400' : 'border-slate-200'
                  }`}
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
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                          {t('hr:workforce.assignedRoles')}
                        </label>
                        <div className="max-h-36 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-1">
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
                                    <span className="text-sm font-semibold text-slate-700 truncate">
                                      {r.name}
                                    </span>
                                  </div>
                                  {isPrimary && (
                                    <span className="text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                                      {t('hr:workforce.primary')}
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {t('hr:workforce.primaryRoleHelp')}
                        </p>
                      </div>

                      <CustomSelect
                        label={t('hr:workforce.primaryRole')}
                        options={editAssignedRoleIds
                          .map((id) => roles.find((r) => r.id === id))
                          .filter(Boolean)
                          .map((r) => ({ id: (r as Role).id, name: (r as Role).name }))}
                        value={editPrimaryRoleId}
                        onChange={(val) => setEditPrimaryRoleId(val as string)}
                        buttonClassName="py-2 text-sm"
                        disabled={isLoadingEditRoles || editAssignedRoleIds.length < 1}
                      />

                      {isLoadingEditRoles && (
                        <p className="text-[10px] text-slate-400 font-bold">
                          {t('hr:workforce.loadingRoles')}
                        </p>
                      )}
                      {editRolesError && (
                        <p className="text-[10px] text-red-500 font-bold">{editRolesError}</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <CustomSelect
                        label={t('hr:workforce.role')}
                        options={roleOptions}
                        value={editRole}
                        onChange={(val) => setEditRole(val as string)}
                        buttonClassName="py-2 text-sm"
                        disabled={isEditingSelf}
                      />
                      {isEditingSelf && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          {t('hr:workforce.cannotChangeOwnRole')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {canViewCosts && canUpdateUsers && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {t('hr:workforce.costPerHour')}
                  </label>
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-praetor transition-all overflow-hidden">
                    <div className="w-16 flex items-center justify-center text-slate-400 text-sm font-bold border-r border-slate-200 py-2 bg-slate-100/30">
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
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <p className="text-sm font-bold text-slate-700">{t('hr:workforce.disabled')}</p>
                  </div>
                  <Toggle checked={editIsDisabled} onChange={setEditIsDisabled} color="red" />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={closeEditModal}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={saveEdit}
                disabled={!hasEditChanges}
                className={`flex-1 py-3 text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 text-white ${!hasEditChanges ? 'bg-slate-300 shadow-none cursor-not-allowed' : 'bg-praetor shadow-slate-200 hover:bg-slate-800'}`}
              >
                {t('hr:workforce.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
      {/* Create User Modal */}
      {canCreateUsers && (
        <Modal isOpen={isCreateModalOpen} onClose={closeCreateModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i className="fa-solid fa-user-plus"></i>
                </div>
                {t('hr:workforce.createNewUser')}
              </h3>
              <button
                onClick={closeCreateModal}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 ml-1 mb-1">
                    {t('hr:workforce.name')}
                  </label>
                  <input
                    type="text"
                    value={newFirstName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewFirstName(val);
                      if (!usernameManuallyEdited.current) {
                        const surname = newSurname.trim().toLowerCase().replace(/\s+/g, '');
                        const first = val.trim().toLowerCase().replace(/\s+/g, '');
                        setNewUsername(first && surname ? `${first}.${surname}` : first || surname);
                      }
                      if (formErrors.firstName || formErrors.general) {
                        setFormErrors({ ...formErrors, firstName: '', general: '' });
                      }
                    }}
                    placeholder="e.g. Alice"
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-praetor transition-all bg-slate-50/50 outline-none text-sm font-semibold ${formErrors.firstName ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor/20'}`}
                  />
                  {formErrors.firstName && (
                    <p className="text-xs text-red-500 mt-1 ml-1">{formErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 ml-1 mb-1">
                    {t('hr:workforce.surname')}
                  </label>
                  <input
                    type="text"
                    value={newSurname}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewSurname(val);
                      if (!usernameManuallyEdited.current) {
                        const first = newFirstName.trim().toLowerCase().replace(/\s+/g, '');
                        const surname = val.trim().toLowerCase().replace(/\s+/g, '');
                        setNewUsername(first && surname ? `${first}.${surname}` : first || surname);
                      }
                      if (formErrors.surname || formErrors.general) {
                        setFormErrors({ ...formErrors, surname: '', general: '' });
                      }
                    }}
                    placeholder="e.g. Smith"
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-praetor transition-all bg-slate-50/50 outline-none text-sm font-semibold ${formErrors.surname ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor/20'}`}
                  />
                  {formErrors.surname && (
                    <p className="text-xs text-red-500 mt-1 ml-1">{formErrors.surname}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 ml-1 mb-1">
                  {t('common:labels.email')}
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    if (formErrors.email || formErrors.general) {
                      setFormErrors({ ...formErrors, email: '', general: '' });
                    }
                  }}
                  placeholder="e.g. alice.smith@example.com"
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-praetor transition-all bg-slate-50/50 outline-none text-sm font-semibold ${formErrors.email ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor/20'}`}
                />
                {formErrors.email && (
                  <p className="text-xs text-red-500 mt-1 ml-1">{formErrors.email}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 ml-1 mb-1">
                  {t('hr:workforce.username')}
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => {
                    usernameManuallyEdited.current = true;
                    setNewUsername(e.target.value);
                    if (formErrors.username || formErrors.general) {
                      setFormErrors({ ...formErrors, username: '', general: '' });
                    }
                  }}
                  placeholder="e.g. alice.smith"
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-praetor transition-all bg-slate-50/50 outline-none text-sm font-semibold ${formErrors.username ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor/20'}`}
                />
                {formErrors.username && (
                  <p className="text-xs text-red-500 mt-1 ml-1">{formErrors.username}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 ml-1 mb-1">
                  {t('hr:workforce.password')}
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (formErrors.password || formErrors.general) {
                      setFormErrors({ ...formErrors, password: '', general: '' });
                    }
                  }}
                  placeholder="Password"
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-praetor transition-all bg-slate-50/50 outline-none text-sm font-semibold ${formErrors.password ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor/20'}`}
                />
                {formErrors.password && (
                  <p className="text-xs text-red-500 mt-1 ml-1">{formErrors.password}</p>
                )}
              </div>
              <div>
                <CustomSelect
                  label={t('hr:workforce.role')}
                  options={roleOptions}
                  value={newRole}
                  onChange={(val) => setNewRole(val as string)}
                  buttonClassName="py-3 text-sm"
                />
              </div>
              {formErrors.general && (
                <p className="text-xs font-bold text-red-500">{formErrors.general}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-praetor text-white rounded-xl font-bold hover:bg-slate-800 transition-colors active:scale-95"
                >
                  {t('common:buttons.add')}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Page header: search + add button */}
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
          <input
            type="text"
            placeholder={t('hr:workforce.searchUsers')}
            value={userSearch}
            onChange={(e) => {
              setUserSearch(e.target.value);
              setUsersCurrentPage(1);
            }}
            className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm"
          />
        </div>
        {canCreateUsers && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('hr:workforce.addUser')}
          </button>
        )}
      </div>

      <StandardTable
        title={t('hr:workforce.title')}
        totalCount={usersFiltered.length}
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common:labels.rowsPerPage')}:
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={usersRowsPerPage.toString()}
                onChange={(val) => handleUsersRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: paginatedUsers.length > 0 ? usersStartIndex + 1 : 0,
                  end: Math.min(usersStartIndex + usersRowsPerPage, usersFiltered.length),
                  total: usersFiltered.length,
                })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setUsersCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={usersCurrentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: usersTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setUsersCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      usersCurrentPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setUsersCurrentPage((prev) => Math.min(usersTotalPages, prev + 1))}
                disabled={usersCurrentPage === usersTotalPages || usersTotalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-right text-xs"></i>
              </button>
            </div>
          </>
        }
      >
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('hr:workforce.user')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('hr:workforce.username')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('common:labels.email')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('hr:workforce.role')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('common:labels.status')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                {t('hr:workforce.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedUsers.map((user) => {
              const canEdit = canUpdateUsers;
              const { roleBadgeClass, roleIcon, roleName } = getRolePresentation(user);

              return (
                <tr
                  key={user.id}
                  onClick={() => canEdit && handleEdit(user)}
                  className={`group hover:bg-slate-50 transition-colors ${
                    user.isDisabled
                      ? 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0'
                      : ''
                  } ${canEdit ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-praetor flex items-center justify-center text-xs font-bold">
                        {user.avatarInitials}
                      </div>
                      <span className="font-bold text-slate-800">{user.name}</span>
                      {user.id === currentUserId && (
                        <span className="text-[10px] bg-praetor px-2 py-0.5 rounded text-white font-bold uppercase">
                          {t('hr:workforce.you')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600 font-mono">{user.username}</span>
                  </td>
                  <td className="px-6 py-4">
                    {user.email ? (
                      <span className="text-sm font-medium text-slate-600 break-all">
                        {user.email}
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-slate-400">{emptyEmailLabel}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${roleBadgeClass}`}
                    >
                      <i className={`fa-solid ${roleIcon}`}></i>
                      {roleName}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge
                      type={user.isDisabled ? 'disabled' : 'active'}
                      label={getUserStatusLabel(user)}
                    />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canManageAssignments && (
                        <Tooltip label={t('hr:workforce.manageAssignments')}>
                          {() => (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openAssignments(user.id);
                              }}
                              className="text-slate-400 hover:text-praetor transition-colors p-2"
                            >
                              <i className="fa-solid fa-link"></i>
                            </button>
                          )}
                        </Tooltip>
                      )}
                      {canUpdateUsers && (
                        <>
                          <Tooltip label={t('hr:workforce.editUser')}>
                            {() => (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEdit(user);
                                }}
                                className="text-slate-400 hover:text-praetor transition-colors p-2"
                              >
                                <i className="fa-solid fa-user-pen"></i>
                              </button>
                            )}
                          </Tooltip>
                          {user.isDisabled ? (
                            <Tooltip label={t('hr:workforce.reEnableUser')}>
                              {() => (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUpdateUser(user.id, { isDisabled: false });
                                  }}
                                  className="text-slate-400 hover:text-praetor transition-colors p-2 rounded-lg"
                                >
                                  <i className="fa-solid fa-rotate-left"></i>
                                </button>
                              )}
                            </Tooltip>
                          ) : (
                            <Tooltip label={t('hr:workforce.disableUser')}>
                              {() => (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUpdateUser(user.id, { isDisabled: true });
                                  }}
                                  disabled={user.id === currentUserId}
                                  className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-0 transition-colors p-2 rounded-lg"
                                >
                                  <i className="fa-solid fa-ban"></i>
                                </button>
                              )}
                            </Tooltip>
                          )}
                        </>
                      )}
                      {canDeleteUsers && (
                        <Tooltip label={t('hr:workforce.deleteUser')}>
                          {() => (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDelete(user);
                              }}
                              disabled={user.id === currentUserId}
                              className="text-slate-400 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          )}
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {paginatedUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm font-bold text-slate-400">
                  {noUsersFoundLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>

      {/* Assignment Modal */}
      <Modal
        isOpen={!!managingUserId}
        onClose={closeAssignments}
        zIndex={50}
        backdropClass="bg-slate-900/50 backdrop-blur-sm"
      >
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <h3 className="font-bold text-lg text-slate-800">
              {t('hr:workforce.manageAccess', { name: managingUser?.name })}
            </h3>
            <button
              onClick={closeAssignments}
              className="text-slate-400 hover:text-slate-600 transition-colors"
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
                  <CustomSelect
                    options={clientFilterOptions}
                    value={filterClientId}
                    onChange={(val) => setFilterClientId(val as string)}
                    placeholder={t('hr:workforce.filterByClient')}
                    searchable={true}
                    buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm"
                  />
                  <CustomSelect
                    options={projectFilterOptions}
                    value={filterProjectId}
                    onChange={(val) => setFilterProjectId(val as string)}
                    placeholder={t('hr:workforce.filterByProject')}
                    searchable={true}
                    buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm"
                    disabled={projectFilterOptions.length === 1}
                  />
                </div>

                <div
                  className={`grid grid-cols-1 ${canManageAssignments ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}
                >
                  {/* Clients Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">
                          {t('hr:workforce.clients')}
                        </h4>
                        <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          {assignments.clientIds.length}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder={t('hr:workforce.searchClients')}
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleClients.map((client) => (
                        <label
                          key={client.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.clientIds.includes(client.id)
                              ? 'bg-slate-50 border-slate-300 shadow-sm'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="relative flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              checked={assignments.clientIds.includes(client.id)}
                              onChange={() => toggleAssignment('client', client.id)}
                              className="sr-only peer"
                            />
                            <div className="w-5 h-5 rounded-full border-2 border-slate-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                              <div
                                className={`w-2 h-2 rounded-full transition-all duration-200 ${assignments.clientIds.includes(client.id) ? 'bg-white scale-100 opacity-100' : 'bg-slate-200 scale-0 opacity-0'}`}
                              ></div>
                            </div>
                          </div>
                          <span
                            className={`text-sm font-semibold ${assignments.clientIds.includes(client.id) ? 'text-slate-900' : 'text-slate-600'}`}
                          >
                            {client.name}
                          </span>
                        </label>
                      ))}
                      {clients.length === 0 && (
                        <p className="text-xs text-slate-400 italic">
                          {t('hr:workforce.noClientsFound')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Projects Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">
                          Projects
                        </h4>
                        <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          {assignments.projectIds.length}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="Search projects..."
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleProjects.map((project) => (
                        <label
                          key={project.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.projectIds.includes(project.id)
                              ? 'bg-slate-50 border-slate-300 shadow-sm'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="relative flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              checked={assignments.projectIds.includes(project.id)}
                              onChange={() => toggleAssignment('project', project.id)}
                              className="sr-only peer"
                            />
                            <div className="w-5 h-5 rounded-full border-2 border-slate-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                              <div
                                className={`w-2 h-2 rounded-full transition-all duration-200 ${assignments.projectIds.includes(project.id) ? 'bg-white scale-100 opacity-100' : 'bg-slate-200 scale-0 opacity-0'}`}
                              ></div>
                            </div>
                          </div>
                          <div className="flex flex-col">
                            <span
                              className={`text-sm font-semibold ${assignments.projectIds.includes(project.id) ? 'text-slate-900' : 'text-slate-600'}`}
                            >
                              {project.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {clients.find((c) => c.id === project.clientId)?.name ||
                                t('hr:workforce.unknownClient')}
                            </span>
                          </div>
                        </label>
                      ))}
                      {projects.length === 0 && (
                        <p className="text-xs text-slate-400 italic">
                          {t('hr:workforce.noProjectsFound')}
                        </p>
                      )}
                    </div>
                  </div>

                  {canManageAssignments && (
                    <div className="space-y-3">
                      <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                        <div className="flex items-center justify-between py-2">
                          <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">
                            Tasks
                          </h4>
                          <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                            {assignments.taskIds.length}
                          </span>
                        </div>
                        <input
                          type="text"
                          placeholder="Search tasks..."
                          value={taskSearch}
                          onChange={(e) => setTaskSearch(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
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
                                  ? 'bg-slate-50 border-slate-300 shadow-sm'
                                  : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="relative flex items-center justify-center shrink-0">
                                <input
                                  type="checkbox"
                                  checked={assignments.taskIds.includes(task.id)}
                                  onChange={() => toggleAssignment('task', task.id)}
                                  className="sr-only peer"
                                />
                                <div className="w-5 h-5 rounded-full border-2 border-slate-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                                  <div
                                    className={`w-2 h-2 rounded-full transition-all duration-200 ${assignments.taskIds.includes(task.id) ? 'bg-white scale-100 opacity-100' : 'bg-slate-200 scale-0 opacity-0'}`}
                                  ></div>
                                </div>
                              </div>
                              <div className="flex flex-col">
                                <span
                                  className={`text-sm font-semibold ${assignments.taskIds.includes(task.id) ? 'text-slate-900' : 'text-slate-600'}`}
                                >
                                  {task.name}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {project?.name || t('hr:workforce.unknownProject')}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                        {tasks.length === 0 && (
                          <p className="text-xs text-slate-400 italic">
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

          <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
            <button
              onClick={closeAssignments}
              className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors text-sm"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={saveAssignments}
              disabled={JSON.stringify(assignments) === JSON.stringify(initialAssignments)}
              className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm active:scale-95 text-sm ${JSON.stringify(assignments) === JSON.stringify(initialAssignments) ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' : 'bg-praetor text-white hover:bg-slate-800'}`}
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
