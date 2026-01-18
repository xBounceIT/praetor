import React, { useState } from 'react';
import { User, UserRole, Client, Project, ProjectTask } from '../types';
import CustomSelect from './CustomSelect';
import { usersApi } from '../services/api';

interface UserManagementProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  onAddUser: (name: string, username: string, password: string, role: UserRole) => Promise<{ success: boolean; error?: string }>;
  onDeleteUser: (id: string) => void;
  onUpdateUser: (id: string, updates: Partial<User>) => void;
  currentUserId: string;
  currentUserRole: UserRole;
  currency: string;
}

const ROLE_OPTIONS = [
  { id: 'user', name: 'User' },
  { id: 'manager', name: 'Manager' },
  { id: 'admin', name: 'Admin' },
];

const UserManagement: React.FC<UserManagementProps> = ({ users, clients, projects, tasks, onAddUser, onDeleteUser, onUpdateUser, currentUserId, currentUserRole, currency }) => {
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('password');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [managingUserId, setManagingUserId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<{ clientIds: string[], projectIds: string[], taskIds: string[] }>({
    clientIds: [], projectIds: [], taskIds: []
  });
  const [initialAssignments, setInitialAssignments] = useState<{ clientIds: string[], projectIds: string[], taskIds: string[] }>({
    clientIds: [], projectIds: [], taskIds: []
  });
  const [clientSearch, setClientSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');

  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editCostPerHour, setEditCostPerHour] = useState<string>('0');
  const [editIsDisabled, setEditIsDisabled] = useState(false);

  const canManageAssignments = currentUserRole === 'manager';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    const newErrors: Record<string, string> = {};
    if (!newName?.trim()) newErrors.name = 'Name is required';
    if (!newUsername?.trim()) newErrors.username = 'Username is required';
    if (!newPassword?.trim()) newErrors.password = 'Password is required';

    if (Object.keys(newErrors).length > 0) {
      setFormErrors(newErrors);
      return;
    }

    const result = await onAddUser(newName, newUsername, newPassword, newRole);
    if (!result.success) {
      if (result.error?.includes('Username already exists')) {
        setFormErrors({ username: 'Username already exists' });
      } else {
        setFormErrors({ general: result.error || 'Failed to add user' });
      }
      return;
    }

    setNewName('');
    setNewUsername('');
    setNewPassword('password');
    setNewRole('user');
  };

  const openAssignments = async (userId: string) => {
    if (!canManageAssignments) return;
    setManagingUserId(userId);
    setIsLoadingAssignments(true);
    try {
      const data = await usersApi.getAssignments(userId);
      setAssignments(data);
      setInitialAssignments(JSON.parse(JSON.stringify(data))); // Deep clone for comparison
    } catch (err) {
      console.error("Failed to load assignments", err);
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
  };

  const saveAssignments = async () => {
    if (!managingUserId || !canManageAssignments) return;
    try {
      await usersApi.updateAssignments(
        managingUserId,
        assignments.clientIds,
        assignments.projectIds,
        assignments.taskIds
      );
      closeAssignments();
    } catch (err) {
      console.error("Failed to save assignments", err);
      alert("Failed to save assignments");
    }
  };

  const toggleAssignment = (type: 'client' | 'project' | 'task', id: string) => {
    if (!canManageAssignments) return;
    setAssignments(prev => {
      const list = type === 'client' ? prev.clientIds : type === 'project' ? prev.projectIds : prev.taskIds;
      const isAdding = !list.includes(id);
      const newList = isAdding ? [...list, id] : list.filter(item => item !== id);

      let newClientIds = prev.clientIds;
      let newProjectIds = prev.projectIds;
      let newTaskIds = prev.taskIds;

      if (type === 'task') {
        newTaskIds = newList;
        if (isAdding) {
          const task = tasks.find(t => t.id === id);
          if (task) {
            const project = projects.find(p => p.id === task.projectId);
            if (project && !newProjectIds.includes(project.id)) {
              newProjectIds = [...newProjectIds, project.id];
            }
            if (project) {
              const client = clients.find(c => c.id === project.clientId);
              if (client && !newClientIds.includes(client.id)) {
                newClientIds = [...newClientIds, client.id];
              }
            }
          }
        } else {
          const task = tasks.find(t => t.id === id);
          if (newTaskIds.length === 0) {
            newProjectIds = [];
            newClientIds = [];
          } else if (task) {
            const project = projects.find(p => p.id === task.projectId);
            if (project) {
              const hasTaskForProject = newTaskIds.some(taskId => {
                const remainingTask = tasks.find(t => t.id === taskId);
                return remainingTask?.projectId === project.id;
              });

              if (!hasTaskForProject) {
                newProjectIds = newProjectIds.filter(projectId => projectId !== project.id);
              }

              const client = clients.find(c => c.id === project.clientId);
              if (client) {
                const hasProjectForClient = newProjectIds.some(projectId => {
                  const remainingProject = projects.find(p => p.id === projectId);
                  return remainingProject?.clientId === client.id;
                });

                if (!hasProjectForClient) {
                  newClientIds = newClientIds.filter(clientId => clientId !== client.id);
                }
              }
            }
          }
        }
      } else if (type === 'project') {
        newProjectIds = newList;
      } else {
        newClientIds = newList;
      }

      return {
        clientIds: newClientIds,
        projectIds: newProjectIds,
        taskIds: newTaskIds
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
    setEditCostPerHour(user.costPerHour?.toString() || '0');
    setEditIsDisabled(!!user.isDisabled);
  };

  const saveEdit = () => {
    if (editingUser) {
      onUpdateUser(editingUser.id, {
        name: editName,
        isDisabled: editIsDisabled,
        costPerHour: parseFloat(editCostPerHour) || 0
      });
      setEditingUser(null);
    }
  };

  const managingUser = users.find(u => u.id === managingUserId);

  // Synchronized Filtering Logic
  const getFilteredData = () => {
    const searchClient = clientSearch.toLowerCase();
    const searchProject = projectSearch.toLowerCase();
    const searchTask = taskSearch.toLowerCase();

    // 1. Visible Tasks
    const visibleTasks = tasks.filter(t => {
      // Must match task search
      if (searchTask && !t.name.toLowerCase().includes(searchTask)) return false;

      const project = projects.find(p => p.id === t.projectId);
      if (!project) return false;

      // Must match project search (via parent project)
      if (searchProject && !project.name.toLowerCase().includes(searchProject)) return false;

      const client = clients.find(c => c.id === project.clientId);
      if (!client) return false;

      // Must match client search (via grandparent client)
      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;

      return true;
    });

    // 2. Visible Projects
    const visibleProjects = projects.filter(p => {
      // Must match project search
      if (searchProject && !p.name.toLowerCase().includes(searchProject)) return false;

      const client = clients.find(c => c.id === p.clientId);
      if (!client) return false;

      // Must match client search (via parent client)
      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;

      // If task search is active, project must contain at least one matching task
      if (searchTask) {
        const hasMatchingTask = tasks.some(t =>
          t.projectId === p.id && t.name.toLowerCase().includes(searchTask)
        );
        if (!hasMatchingTask) return false;
      }

      return true;
    });

    // 3. Visible Clients
    const visibleClients = clients.filter(c => {
      // Must match client search
      if (searchClient && !c.name.toLowerCase().includes(searchClient)) return false;

      // If project or task search is active, client must have at least one valid descendant path
      if (searchProject || searchTask) {
        const hasMatchingPath = projects.some(p => {
          if (p.clientId !== c.id) return false;

          if (searchProject && !p.name.toLowerCase().includes(searchProject)) return false;

          if (searchTask) {
            return tasks.some(t => t.projectId === p.id && t.name.toLowerCase().includes(searchTask));
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

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">Delete User?</h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  Are you sure you want to delete <span className="font-bold text-slate-800">{userToDelete?.name}</span>?
                  This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={cancelDelete}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                  <i className="fa-solid fa-user-pen text-praetor"></i>
                </div>
                <h3 className="text-lg font-black text-slate-800">Edit User</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Full Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold"
                  />
                </div>

                {currentUserRole !== 'admin' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Cost per Hour</label>
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-praetor transition-all overflow-hidden">
                      <div className="w-16 flex items-center justify-center text-slate-400 text-sm font-bold border-r border-slate-200 py-2 bg-slate-100/30">
                        {currency}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={editCostPerHour}
                        onChange={(e) => setEditCostPerHour(e.target.value)}
                        className="flex-1 px-4 py-2 bg-transparent outline-none text-sm font-semibold"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                )}

                {editingUser.id !== currentUserId && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-sm font-bold text-slate-700">Disabled</p>
                    </div>
                    <button
                      onClick={() => setEditIsDisabled(!editIsDisabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editIsDisabled ? 'bg-red-500' : 'bg-slate-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editIsDisabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editName || (
                    editName === editingUser.name &&
                    parseFloat(editCostPerHour) === (editingUser.costPerHour || 0) &&
                    editIsDisabled === !!editingUser.isDisabled
                  )}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 text-white ${(!editName || (
                    editName === editingUser.name &&
                    parseFloat(editCostPerHour) === (editingUser.costPerHour || 0) &&
                    editIsDisabled === !!editingUser.isDisabled
                  )) ? 'bg-slate-300 shadow-none cursor-not-allowed' : 'bg-praetor shadow-slate-200 hover:bg-slate-800'}`}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {currentUserRole === 'admin' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-user-plus text-praetor"></i>
            Create New User
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Name</label>
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
              <p className="text-red-500 text-[10px] font-bold mt-1 min-h-[12px]">{formErrors.name || ''}</p>
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Username</label>
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
              <p className="text-red-500 text-[10px] font-bold mt-1 min-h-[12px]">{formErrors.username || ''}</p>
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Password</label>
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
              <p className="text-red-500 text-[10px] font-bold mt-1 min-h-[12px]">{formErrors.password || ''}</p>
            </div>
            <div className="lg:col-span-1">
              <CustomSelect
                label="Role"
                options={ROLE_OPTIONS}
                value={newRole}
                onChange={val => setNewRole(val as UserRole)}
              />
            </div>
            <div className="lg:col-span-1">
              <button
                type="submit"
                className="w-full px-6 py-2 bg-praetor text-white font-bold rounded-lg hover:bg-slate-800 transition-all h-[38px] shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> Add
              </button>
            </div>
          </form>
          {formErrors.general && (
            <p className="mt-3 text-xs font-bold text-red-500">{formErrors.general}</p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-bold text-slate-800">Team Members ({users.length})</h3>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">User</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Username</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Role</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(user => {
              const canEdit = currentUserRole === 'admin' || (currentUserRole === 'manager' && (user.role === 'user' || user.id === currentUserId));
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
                          Disabled
                        </span>
                      )}
                      {user.id === currentUserId && <span className="text-[10px] bg-praetor px-2 py-0.5 rounded text-white font-bold uppercase">You</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600 font-mono">{user.username}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${user.role === 'admin' ? 'bg-slate-800 text-white border-slate-700' :
                      user.role === 'manager' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
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
                          title="Manage Assignments"
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
                            title="Edit User"
                          >
                            <i className="fa-solid fa-user-pen"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDelete(user);
                            }}
                            disabled={user.id === currentUserId}
                            className="text-slate-400 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                            title="Delete User"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </>
                      )}
                      {currentUserRole === 'manager' && (user.role === 'user' || user.id === currentUserId) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(user);
                          }}
                          className="text-slate-400 hover:text-praetor transition-colors p-2"
                          title="Edit User"
                        >
                          <i className="fa-solid fa-user-pen"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Assignment Modal */}
      {managingUserId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-lg text-slate-800">
                Manage Access: <span className="text-praetor">{managingUser?.name}</span>
              </h3>
              <button onClick={closeAssignments} className="text-slate-400 hover:text-slate-600 transition-colors">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingAssignments ? (
                <div className="flex items-center justify-center py-12">
                  <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
                </div>
              ) : (
                <div className={`grid grid-cols-1 ${canManageAssignments ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}>
                  {/* Clients Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Clients</h4>
                        <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assignments.clientIds.length}</span>
                      </div>
                      <input
                        type="text"
                        placeholder="Search clients..."
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      {visibleClients.map(client => (
                        <label key={client.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${assignments.clientIds.includes(client.id)
                          ? 'bg-slate-50 border-slate-300 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}>
                          <input
                            type="checkbox"
                            checked={assignments.clientIds.includes(client.id)}
                            onChange={() => toggleAssignment('client', client.id)}
                            className="w-4 h-4 text-praetor rounded focus:ring-praetor border-gray-300"
                          />
                          <span className={`text-sm font-semibold ${assignments.clientIds.includes(client.id) ? 'text-slate-900' : 'text-slate-600'}`}>
                            {client.name}
                          </span>
                        </label>
                      ))}
                      {clients.length === 0 && <p className="text-xs text-slate-400 italic">No clients found.</p>}
                    </div>
                  </div>

                  {/* Projects Column */}
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                      <div className="flex items-center justify-between py-2">
                        <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Projects</h4>
                        <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assignments.projectIds.length}</span>
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
                      {visibleProjects.map(project => (
                        <label key={project.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${assignments.projectIds.includes(project.id)
                          ? 'bg-slate-50 border-slate-300 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}>
                          <input
                            type="checkbox"
                            checked={assignments.projectIds.includes(project.id)}
                            onChange={() => toggleAssignment('project', project.id)}
                            className="w-4 h-4 text-praetor rounded focus:ring-praetor border-gray-300"
                          />
                          <div className="flex flex-col">
                            <span className={`text-sm font-semibold ${assignments.projectIds.includes(project.id) ? 'text-slate-900' : 'text-slate-600'}`}>
                              {project.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {clients.find(c => c.id === project.clientId)?.name || 'Unknown Client'}
                            </span>
                          </div>
                        </label>
                      ))}
                      {projects.length === 0 && <p className="text-xs text-slate-400 italic">No projects found.</p>}
                    </div>
                  </div>

                  {canManageAssignments && (
                    <div className="space-y-3">
                      <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                        <div className="flex items-center justify-between py-2">
                          <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Tasks</h4>
                          <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assignments.taskIds.length}</span>
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
                        {visibleTasks.map(task => {
                          const project = projects.find(p => p.id === task.projectId);
                          return (
                            <label key={task.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${assignments.taskIds.includes(task.id)
                              ? 'bg-slate-50 border-slate-300 shadow-sm'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}>
                              <input
                                type="checkbox"
                                checked={assignments.taskIds.includes(task.id)}
                                onChange={() => toggleAssignment('task', task.id)}
                                className="w-4 h-4 text-praetor rounded focus:ring-praetor border-gray-300"
                              />
                              <div className="flex flex-col">
                                <span className={`text-sm font-semibold ${assignments.taskIds.includes(task.id) ? 'text-slate-900' : 'text-slate-600'}`}>
                                  {task.name}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {project?.name || 'Unknown Project'}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                        {tasks.length === 0 && <p className="text-xs text-slate-400 italic">No tasks found.</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={closeAssignments}
                className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveAssignments}
                disabled={JSON.stringify(assignments) === JSON.stringify(initialAssignments)}
                className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm active:scale-95 text-sm ${JSON.stringify(assignments) === JSON.stringify(initialAssignments) ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' : 'bg-praetor text-white hover:bg-slate-800'}`}
              >
                Save Assignments
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
