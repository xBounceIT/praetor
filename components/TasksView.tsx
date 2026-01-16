
import React, { useState } from 'react';
import { ProjectTask, Project, Client, UserRole, User } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import { tasksApi } from '../services/api';

interface TasksViewProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  role: UserRole;
  users: User[];
  onAddTask: (name: string, projectId: string, recurringConfig?: any, description?: string) => void;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void;
  onDeleteTask: (id: string) => void;
}

const TasksView: React.FC<TasksViewProps> = ({ tasks, projects, clients, role, users, onAddTask, onUpdateTask, onDeleteTask }) => {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Assignment State
  const [managingTaskId, setManagingTaskId] = useState<string | null>(null);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const isManagement = role === 'admin' || role === 'manager';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && projectId) {
      if (editingTask) {
        onUpdateTask(editingTask.id, { name, projectId, description, isDisabled: tempIsDisabled });
      } else {
        onAddTask(name, projectId, undefined, description);
      }
      closeModal();
    }
  };

  const openCreateModal = () => {
    setEditingTask(null);
    setName('');
    setProjectId('');
    setDescription('');
    setIsModalOpen(true);
  };

  const startEditing = (task: ProjectTask) => {
    setEditingTask(task);
    setName(task.name);
    setProjectId(task.projectId);
    setDescription(task.description || '');
    setTempIsDisabled(task.isDisabled || false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsDeleteConfirmOpen(false);
    setEditingTask(null);
    setName('');
    setProjectId('');
    setDescription('');
  };

  const confirmDelete = () => {
    setIsDeleteConfirmOpen(true);
  };

  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
  };

  const handleDelete = () => {
    if (editingTask) {
      onDeleteTask(editingTask.id);
      closeModal();
    }
  };

  // Assignment Handlers
  const openAssignments = async (taskId: string) => {
    setManagingTaskId(taskId);
    setIsLoadingAssignments(true);
    setAssignedUserIds([]);
    try {
      const userIds = await tasksApi.getUsers(taskId);
      setAssignedUserIds(userIds);
    } catch (err) {
      console.error("Failed to load task users", err);
      // Optional: show error notification
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const closeAssignments = () => {
    setManagingTaskId(null);
    setAssignedUserIds([]);
    setUserSearch('');
  };

  const toggleUserAssignment = (userId: string) => {
    setAssignedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const saveAssignments = async () => {
    if (!managingTaskId) return;
    try {
      await tasksApi.updateUsers(managingTaskId, assignedUserIds);
      closeAssignments();
      // Optional: show success notification
    } catch (err) {
      console.error("Failed to save task users", err);
      alert("Failed to save assignments");
    }
  };

  const projectOptions = projects.map(p => ({ id: p.id, name: p.name }));

  const managingTask = tasks.find(t => t.id === managingTaskId);

  // Filter users for assignment modal
  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.username.toLowerCase().includes(userSearch.toLowerCase())
  );

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
                <h3 className="text-lg font-black text-slate-800">Delete Task?</h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  Are you sure you want to delete <span className="font-bold text-slate-800">{editingTask?.name}</span>?
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

      {/* User Assignment Modal */}
      {managingTaskId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-lg text-slate-800 flex flex-col">
                <span>Assign Users</span>
                <span className="text-xs font-normal text-slate-500 mt-0.5">Task: <span className="font-bold text-praetor">{managingTask?.name}</span></span>
              </h3>
              <button onClick={closeAssignments} className="text-slate-400 hover:text-slate-600 transition-colors">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 bg-white">
              <input
                type="text"
                placeholder="Search users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-medium"
                autoFocus
              />
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-50/50">
              {isLoadingAssignments ? (
                <div className="flex items-center justify-center py-12">
                  <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map(user => (
                    <label
                      key={user.id}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${assignedUserIds.includes(user.id)
                          ? 'bg-white border-praetor shadow-sm ring-1 ring-praetor/10'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${assignedUserIds.includes(user.id) ? 'bg-praetor text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                          {user.avatarInitials || user.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className={`text-sm font-bold ${assignedUserIds.includes(user.id) ? 'text-slate-800' : 'text-slate-600'}`}>
                            {user.name}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {user.role}
                          </span>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${assignedUserIds.includes(user.id) ? 'bg-praetor border-praetor' : 'bg-white border-slate-300'
                        }`}>
                        {assignedUserIds.includes(user.id) && <i className="fa-solid fa-check text-white text-[10px]"></i>}
                      </div>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={assignedUserIds.includes(user.id)}
                        onChange={() => toggleUserAssignment(user.id)}
                      />
                    </label>
                  ))}
                  {filteredUsers.length === 0 && (
                    <div className="text-center py-8 text-slate-400 italic text-sm">
                      No users found.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-white flex justify-end gap-3">
              <button
                onClick={closeAssignments}
                className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-50 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveAssignments}
                className="px-6 py-2 bg-praetor text-white font-bold rounded-lg hover:bg-slate-800 transition-all shadow-sm active:scale-95 text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Modal Overlay (For Editing Only Now) */}
      {isModalOpen && editingTask && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-pen-to-square text-praetor"></i>
                Edit Task
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 transition-colors">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="space-y-2">
                <CustomSelect
                  label="Project"
                  options={projectOptions}
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="Select Project..."
                  searchable={true}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Task Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Frontend Implementation"
                  className="w-full text-sm px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-praetor bg-slate-50 focus:bg-white transition-all"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Task context..."
                  rows={3}
                  className="w-full text-sm px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-praetor bg-slate-50 focus:bg-white transition-all resize-none"
                />
              </div>

              {(() => {
                const project = projects.find(p => p.id === projectId);
                const client = clients.find(c => c.id === project?.clientId);
                const isProjectDisabled = project?.isDisabled || false;
                const isClientDisabled = client?.isDisabled || false;
                const isInheritedDisabled = isProjectDisabled || isClientDisabled;
                const isCurrentlyDisabled = tempIsDisabled || isInheritedDisabled;

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <p className={`text-sm font-bold ${isInheritedDisabled ? 'text-slate-400' : 'text-slate-700'}`}>Task is Disabled</p>
                      </div>
                      <button
                        type="button"
                        disabled={isInheritedDisabled}
                        onClick={() => {
                          if (!isInheritedDisabled) {
                            setTempIsDisabled(!tempIsDisabled);
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isCurrentlyDisabled ? 'bg-red-500' : 'bg-slate-300'} ${isInheritedDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isCurrentlyDisabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    {isInheritedDisabled && (
                      <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 px-1">
                        <i className="fa-solid fa-circle-info"></i>
                        {isClientDisabled
                          ? `Inherited from disabled Client: ${client?.name}`
                          : `Inherited from disabled Project: ${project?.name}`}
                      </p>
                    )}
                  </div>
                );
              })()}



              <div className="pt-4 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transform active:scale-95 transition-all bg-red-500 shadow-red-200 hover:bg-red-600"
                >
                  Delete
                </button>

                <div className="flex gap-3 ml-auto">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transform active:scale-95 transition-all bg-praetor shadow-slate-200 hover:bg-slate-700"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Creation Form (Visible to management) */}
      {isManagement && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-list-check text-praetor"></i>
            Create New Task
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div className="lg:col-span-1">
              <CustomSelect
                label="Project"
                options={projectOptions}
                value={projectId}
                onChange={setProjectId}
                placeholder="Select Project..."
                searchable={true}
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Task Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Frontend Implementation"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Task context..."
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <button
                type="submit"
                className="w-full px-6 py-2 bg-praetor text-white font-bold rounded-lg hover:bg-slate-700 transition-all h-[38px] shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> Add Task
              </button>
            </div>
          </form>
        </div>
      )}

      <StandardTable
        title={`Tasks Directory (${tasks.length})`}
        totalCount={undefined}
        containerClassName="rounded-xl overflow-hidden"
      >
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Project</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Task Name</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Status</th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">No tasks found.</td>
              </tr>
            ) : tasks.map(task => {
              const project = projects.find(p => p.id === task.projectId);
              const client = clients.find(c => c.id === project?.clientId);

              const isProjectDisabled = project?.isDisabled || false;
              const isClientDisabled = client?.isDisabled || false;
              const isInheritedDisabled = isProjectDisabled || isClientDisabled;
              const isEffectivelyDisabled = task.isDisabled || isInheritedDisabled;

              return (
                <tr
                  key={task.id}
                  onClick={() => startEditing(task)}
                  className={`group hover:bg-slate-50 transition-colors cursor-pointer ${isEffectivelyDisabled ? 'opacity-60 grayscale bg-slate-50/50' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project?.color || '#ccc' }}></div>
                        <span className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${isProjectDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-praetor'}`}>
                          {project?.name || 'Unknown'}
                          {isProjectDisabled && <span className="ml-1 text-[8px]">(DISABLED)</span>}
                        </span>
                      </div>
                      {client && (
                        <span className={`text-[9px] font-bold ${isClientDisabled ? 'text-amber-500' : 'text-slate-400'}`}>
                          Client: {client.name} {isClientDisabled && '(DISABLED)'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-sm font-bold ${isEffectivelyDisabled ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>{task.name}</span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs text-slate-500 max-w-md italic">{task.description || 'No description provided.'}</p>
                  </td>
                  <td className="px-6 py-4">
                    {task.isDisabled ? (
                      <span className="text-[10px] font-black text-amber-500 uppercase">Disabled</span>
                    ) : isInheritedDisabled ? (
                      <span className="text-[10px] font-black text-amber-400 uppercase">Inherited Disable</span>
                    ) : (
                      <span className="text-[10px] font-black text-emerald-500 uppercase">Active</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {isManagement && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAssignments(task.id);
                          }}
                          className="text-slate-400 hover:text-praetor transition-colors p-2"
                          title="Manage Assigned Users"
                        >
                          <i className="fa-solid fa-users"></i>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditing(task); }}
                          className="text-slate-400 hover:text-praetor transition-colors p-2"
                          title="Edit Task"
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StandardTable>
    </div>
  );
};

export default TasksView;
