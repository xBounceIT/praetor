import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, UserRole, Client, Project, ProjectTask } from '../types';
import CustomSelect from './shared/CustomSelect';
import StandardTable from './shared/StandardTable';

import ValidatedNumberInput from './ValidatedNumberInput';
import { usersApi } from '../services/api';
import Modal from './Modal';

interface UserManagementProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  onAddUser: (
    name: string,
    username: string,
    password: string,
    role: UserRole,
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteUser: (id: string) => void;
  onUpdateUser: (id: string, updates: Partial<User>) => void;
  currentUserId: string;
  currentUserRole: UserRole;
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
  currentUserId,
  currentUserRole,
  currency,
}) => {
  const { t } = useTranslation(['hr', 'common']);

  const ROLE_OPTIONS = [
    { id: 'user', name: t('hr:roles.user') },
    { id: 'admin', name: t('hr:roles.admin') },
  ];

  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('password');
  const [newRole, setNewRole] = useState<UserRole>('user');
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
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editCostPerHour, setEditCostPerHour] = useState<string>('0');
  const [editIsDisabled, setEditIsDisabled] = useState(false);
  const [activeSearch, setActiveSearch] = useState('');
  const [disabledSearch, setDisabledSearch] = useState('');
  const [activeCurrentPage, setActiveCurrentPage] = useState(1);
  const [activeRowsPerPage, setActiveRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_workforce_active_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [disabledCurrentPage, setDisabledCurrentPage] = useState(1);
  const [disabledRowsPerPage, setDisabledRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_workforce_disabled_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const canManageAssignments = currentUserRole === 'admin';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    const newErrors: Record<string, string> = {};
    if (!newName?.trim()) newErrors.name = t('common:validation.nameRequired');
    if (!newUsername?.trim()) newErrors.username = t('common:validation.usernameRequired');
    if (!newPassword?.trim()) newErrors.password = t('common:validation.passwordRequired');

    if (Object.keys(newErrors).length > 0) {
      setFormErrors(newErrors);
      return;
    }

    const result = await onAddUser(newName, newUsername, newPassword, newRole);
    if (!result.success) {
      if (result.error?.includes('Username already exists')) {
        setFormErrors({ username: t('common:validation.usernameAlreadyExists') || result.error });
      } else {
        setFormErrors({ general: result.error || t('common:messages.errorOccurred') });
      }
      return;
    }

    setNewName('');
    setNewUsername('');
    setNewPassword('password');
    setNewRole('user');
  };

  const handleActiveRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setActiveRowsPerPage(value);
    localStorage.setItem('praetor_workforce_active_rowsPerPage', value.toString());
    setActiveCurrentPage(1);
  };

  const handleDisabledRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setDisabledRowsPerPage(value);
    localStorage.setItem('praetor_workforce_disabled_rowsPerPage', value.toString());
    setDisabledCurrentPage(1);
  };

  React.useEffect(() => {
    setActiveCurrentPage(1);
  }, [activeSearch]);

  React.useEffect(() => {
    setDisabledCurrentPage(1);
  }, [disabledSearch]);

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
    setEditingUser(user);
    setEditName(user.name);
    setEditRole(user.role);
    setEditCostPerHour(user.costPerHour?.toString() || '0');
    setEditIsDisabled(!!user.isDisabled);
  };

  const saveEdit = () => {
    if (editingUser) {
      const updates: Partial<User> = {
        name: editName,
        isDisabled: editIsDisabled,
      };

      if (
        currentUserRole === 'admin' &&
        editingUser?.id !== currentUserId &&
        editRole !== editingUser?.role
      ) {
        updates.role = editRole;
      }

      if (currentUserRole !== 'admin') {
        updates.costPerHour = parseFloat(editCostPerHour) || 0;
      }

      onUpdateUser(editingUser!.id, updates);
      setEditingUser(null);
    }
  };

  const managingUser = users.find((u) => u.id === managingUserId);
  const isEditingSelf = editingUser?.id === currentUserId;
  const canEditRole = currentUserRole === 'admin' && !isEditingSelf;
  const hasEditChanges =
    !!editingUser &&
    (editName !== editingUser.name ||
      editIsDisabled !== !!editingUser.isDisabled ||
      (currentUserRole !== 'admin' &&
        parseFloat(editCostPerHour) !== (editingUser.costPerHour || 0)) ||
      (canEditRole && editRole !== editingUser.role));

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

  const activeUsersTotal = users.filter((user) => !user.isDisabled);
  const disabledUsersTotal = users.filter((user) => user.isDisabled);
  const activeSearchValue = activeSearch.trim().toLowerCase();
  const disabledSearchValue = disabledSearch.trim().toLowerCase();
  const matchesUserSearch = (user: User, term: string) => {
    if (!term) return true;
    return user.name.toLowerCase().includes(term) || user.username.toLowerCase().includes(term);
  };
  const activeUsersFiltered = activeUsersTotal.filter((user) =>
    matchesUserSearch(user, activeSearchValue),
  );
  const disabledUsersFiltered = disabledUsersTotal.filter((user) =>
    matchesUserSearch(user, disabledSearchValue),
  );

  const activeTotalPages = Math.ceil(activeUsersFiltered.length / activeRowsPerPage);
  const activeStartIndex = (activeCurrentPage - 1) * activeRowsPerPage;
  const activeUsers = activeUsersFiltered.slice(
    activeStartIndex,
    activeStartIndex + activeRowsPerPage,
  );

  const disabledTotalPages = Math.ceil(disabledUsersFiltered.length / disabledRowsPerPage);
  const disabledStartIndex = (disabledCurrentPage - 1) * disabledRowsPerPage;
  const disabledUsers = disabledUsersFiltered.slice(
    disabledStartIndex,
    disabledStartIndex + disabledRowsPerPage,
  );

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
      <Modal isOpen={!!editingUser} onClose={() => setEditingUser(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-user-pen text-praetor"></i>
              </div>
              <h3 className="text-lg font-black text-slate-800">{t('hr:workforce.editUser')}</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  {t('hr:workforce.fullName')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold"
                />
              </div>

              {currentUserRole === 'admin' && (
                <div>
                  <CustomSelect
                    label={t('hr:workforce.role')}
                    options={ROLE_OPTIONS}
                    value={editRole}
                    onChange={(val) => setEditRole(val as UserRole)}
                    buttonClassName="py-2 text-sm"
                    disabled={isEditingSelf}
                  />
                  {isEditingSelf && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      {t('hr:workforce.cannotChangeOwnRole')}
                    </p>
                  )}
                </div>
              )}

              {currentUserRole !== 'admin' && (
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
                  <button
                    onClick={() => setEditIsDisabled(!editIsDisabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editIsDisabled ? 'bg-red-500' : 'bg-slate-300'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editIsDisabled ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditingUser(null)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={saveEdit}
                disabled={!editName || !hasEditChanges}
                className={`flex-1 py-3 text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 text-white ${!editName || !hasEditChanges ? 'bg-slate-300 shadow-none cursor-not-allowed' : 'bg-praetor shadow-slate-200 hover:bg-slate-800'}`}
              >
                {t('hr:workforce.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
      {currentUserRole === 'admin' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-user-plus text-praetor"></i>
            {t('hr:workforce.createNewUser')}
          </h3>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
          >
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                {t('hr:workforce.name')}
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (!newUsername) setNewUsername(e.target.value.toLowerCase());
                  if (formErrors.name || formErrors.general) {
                    setFormErrors({ ...formErrors, name: '', general: '' });
                  }
                }}
                placeholder="e.g. Alice Smith"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-semibold ${formErrors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              <p className="text-red-500 text-[10px] font-bold mt-1 h-4 leading-4">
                {formErrors.name || ''}
              </p>
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                {t('hr:workforce.username')}
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => {
                  setNewUsername(e.target.value);
                  if (formErrors.username || formErrors.general) {
                    setFormErrors({ ...formErrors, username: '', general: '' });
                  }
                }}
                placeholder="e.g. alice"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-semibold ${formErrors.username ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              <p className="text-red-500 text-[10px] font-bold mt-1 h-4 leading-4">
                {formErrors.username || ''}
              </p>
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
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
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-semibold ${formErrors.password ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              <p className="text-red-500 text-[10px] font-bold mt-1 h-4 leading-4">
                {formErrors.password || ''}
              </p>
            </div>
            <div className="lg:col-span-1">
              <CustomSelect
                label={t('hr:workforce.role')}
                options={ROLE_OPTIONS}
                value={newRole}
                onChange={(val) => setNewRole(val as UserRole)}
                buttonClassName="py-2 text-sm"
              />
              <p className="text-red-500 text-[10px] font-bold mt-1 h-4 leading-4"></p>
            </div>
            <div className="lg:col-span-1">
              <button
                type="submit"
                className="w-full px-6 py-2 bg-praetor text-white font-bold rounded-lg hover:bg-slate-800 transition-all h-[38px] shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> {t('common:buttons.add')}
              </button>
              <p className="text-red-500 text-[10px] font-bold mt-1 h-4 leading-4"></p>
            </div>
          </form>
          {formErrors.general && (
            <p className="mt-3 text-xs font-bold text-red-500">{formErrors.general}</p>
          )}
        </div>
      )}

      <StandardTable
        title={t('hr:workforce.activeUsers')}
        totalCount={activeUsersFiltered.length}
        headerExtras={
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
            <input
              type="text"
              placeholder={t('hr:workforce.searchActiveUsers')}
              value={activeSearch}
              onChange={(e) => setActiveSearch(e.target.value)}
              className="w-56 pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-praetor outline-none"
            />
          </div>
        }
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
                value={activeRowsPerPage.toString()}
                onChange={(val) => handleActiveRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: activeUsers.length > 0 ? activeStartIndex + 1 : 0,
                  end: Math.min(activeStartIndex + activeRowsPerPage, activeUsersFiltered.length),
                  total: activeUsersFiltered.length,
                })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={activeCurrentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: activeTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setActiveCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      activeCurrentPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setActiveCurrentPage((prev) => Math.min(activeTotalPages, prev + 1))}
                disabled={activeCurrentPage === activeTotalPages || activeTotalPages === 0}
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
                {t('hr:workforce.role')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                {t('hr:workforce.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activeUsers.map((user) => {
              const canEdit = currentUserRole === 'admin';
              return (
                <tr
                  key={user.id}
                  onClick={() => canEdit && handleEdit(user)}
                  className={`group hover:bg-slate-50 transition-colors ${canEdit ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-praetor flex items-center justify-center text-xs font-bold">
                        {user.avatarInitials}
                      </div>
                      <span className="font-bold text-slate-800">{user.name}</span>
                      {user.isDisabled && (
                        <span className="text-[10px] bg-red-100 px-2 py-0.5 rounded text-red-600 font-bold uppercase border border-red-200">
                          {t('hr:workforce.disabled')}
                        </span>
                      )}
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
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                        user.role === 'admin'
                          ? 'bg-slate-800 text-white border-slate-700'
                          : user.role === 'manager'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {user.role === 'admin' && <i className="fa-solid fa-shield-halved"></i>}
                      {user.role === 'manager' && <i className="fa-solid fa-briefcase"></i>}
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canManageAssignments && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAssignments(user.id);
                          }}
                          className="text-slate-400 hover:text-praetor transition-colors p-2"
                          title={t('hr:workforce.manageAssignments')}
                        >
                          <i className="fa-solid fa-link"></i>
                        </button>
                      )}
                      {currentUserRole === 'admin' && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(user);
                            }}
                            className="text-slate-400 hover:text-praetor transition-colors p-2"
                            title={t('hr:workforce.editUser')}
                          >
                            <i className="fa-solid fa-user-pen"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateUser(user.id, { isDisabled: true });
                            }}
                            disabled={user.id === currentUserId}
                            className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-0 transition-colors p-2 rounded-lg"
                            title={t('hr:workforce.disableUser')}
                          >
                            <i className="fa-solid fa-ban"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDelete(user);
                            }}
                            disabled={user.id === currentUserId}
                            className="text-slate-400 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                            title={t('hr:workforce.deleteUser')}
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {activeUsers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-sm font-bold text-slate-400">
                  {t('hr:workforce.noActiveUsers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>

      {disabledUsersTotal.length > 0 && (
        <StandardTable
          title={t('hr:workforce.disabledUsers')}
          totalCount={disabledUsersFiltered.length}
          totalLabel="DISABLED"
          containerClassName="border-dashed bg-slate-50"
          headerExtras={
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
              <input
                type="text"
                placeholder={t('hr:workforce.searchDisabledUsers')}
                value={disabledSearch}
                onChange={(e) => setDisabledSearch(e.target.value)}
                className="w-56 pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-praetor outline-none"
              />
            </div>
          }
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
                  value={disabledRowsPerPage.toString()}
                  onChange={(val) => handleDisabledRowsPerPageChange(val as string)}
                  className="w-20"
                  buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                  searchable={false}
                />
                <span className="text-xs font-bold text-slate-400 ml-2">
                  {t('common:pagination.showing', {
                    start: disabledUsers.length > 0 ? disabledStartIndex + 1 : 0,
                    end: Math.min(
                      disabledStartIndex + disabledRowsPerPage,
                      disabledUsersFiltered.length,
                    ),
                    total: disabledUsersFiltered.length,
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDisabledCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={disabledCurrentPage === 1}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: disabledTotalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setDisabledCurrentPage(page)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                        disabledCurrentPage === page
                          ? 'bg-praetor text-white shadow-md shadow-slate-200'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setDisabledCurrentPage((prev) => Math.min(disabledTotalPages, prev + 1))
                  }
                  disabled={disabledCurrentPage === disabledTotalPages || disabledTotalPages === 0}
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
                  User
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  Username
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  Role
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {disabledUsers.map((user) => {
                const canEdit = currentUserRole === 'admin';
                return (
                  <tr
                    key={user.id}
                    onClick={() => canEdit && handleEdit(user)}
                    className={`group hover:bg-slate-50 transition-colors opacity-60 grayscale hover:opacity-100 hover:grayscale-0 ${canEdit ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-praetor flex items-center justify-center text-xs font-bold">
                          {user.avatarInitials}
                        </div>
                        <span className="font-bold text-slate-800">{user.name}</span>
                        {user.isDisabled && (
                          <span className="text-[10px] bg-red-100 px-2 py-0.5 rounded text-red-600 font-bold uppercase border border-red-200">
                            {t('hr:workforce.disabled')}
                          </span>
                        )}
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
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                          user.role === 'admin'
                            ? 'bg-slate-800 text-white border-slate-700'
                            : user.role === 'manager'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {user.role === 'admin' && <i className="fa-solid fa-shield-halved"></i>}
                        {user.role === 'manager' && <i className="fa-solid fa-briefcase"></i>}
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canManageAssignments && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssignments(user.id);
                            }}
                            className="text-slate-400 hover:text-praetor transition-colors p-2"
                            title={t('hr:workforce.manageAssignments')}
                          >
                            <i className="fa-solid fa-link"></i>
                          </button>
                        )}
                        {currentUserRole === 'admin' && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(user);
                              }}
                              className="text-slate-400 hover:text-praetor transition-colors p-2"
                              title={t('hr:workforce.editUser')}
                            >
                              <i className="fa-solid fa-user-pen"></i>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateUser(user.id, { isDisabled: false });
                              }}
                              className="text-slate-400 hover:text-praetor transition-colors p-2"
                              title={t('hr:workforce.reEnableUser')}
                            >
                              <i className="fa-solid fa-rotate-left"></i>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDelete(user);
                              }}
                              disabled={user.id === currentUserId}
                              className="text-slate-400 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                              title={t('hr:workforce.deleteUser')}
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {disabledUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-10 text-center text-sm font-bold text-slate-400"
                  >
                    {t('hr:workforce.noDisabledUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </StandardTable>
      )}

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
