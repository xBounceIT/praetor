
import React, { useState } from 'react';
import { ProjectTask, Project, Client, UserRole } from '../types';
import CustomSelect from './CustomSelect';

interface TasksViewProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  role: UserRole;
  onAddTask: (name: string, projectId: string, recurringConfig?: any, description?: string) => void;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void;
  onDeleteTask: (id: string) => void;
}

const TasksView: React.FC<TasksViewProps> = ({ tasks, projects, clients, role, onAddTask, onUpdateTask, onDeleteTask }) => {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const isManagement = role === 'admin' || role === 'manager';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && projectId) {
      if (editingTask) {
        onUpdateTask(editingTask.id, { name, projectId, description });
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

  const projectOptions = projects.map(p => ({ id: p.id, name: p.name }));

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

      {/* Main Modal Overlay (For Editing Only Now) */}
      {isModalOpen && editingTask && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-pen-to-square text-indigo-500"></i>
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
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Task Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Frontend Implementation"
                  className="w-full text-sm px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-all"
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
                  className="w-full text-sm px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-all resize-none"
                />
              </div>

              {(() => {
                const project = projects.find(p => p.id === projectId);
                const client = clients.find(c => c.id === project?.clientId);
                const isProjectDisabled = project?.isDisabled || false;
                const isClientDisabled = client?.isDisabled || false;
                const isInheritedDisabled = isProjectDisabled || isClientDisabled;
                const isCurrentlyDisabled = editingTask?.isDisabled || isInheritedDisabled;

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
                          if (editingTask && !isInheritedDisabled) {
                            const newValue = !editingTask.isDisabled;
                            onUpdateTask(editingTask.id, { isDisabled: newValue });
                            setEditingTask({ ...editingTask, isDisabled: newValue });
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
                    className="px-6 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transform active:scale-95 transition-all bg-indigo-600 shadow-indigo-200 hover:bg-indigo-700"
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
            <i className="fa-solid fa-list-check text-indigo-500"></i>
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
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Task Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Frontend Implementation"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Task context..."
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <button
                type="submit"
                className="w-full px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all h-[38px] shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> Add Task
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-slate-800">Tasks Directory ({tasks.length})</h3>
        </div>

        <div className="overflow-x-auto">
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
                  <tr key={task.id} className={`group hover:bg-slate-50 transition-colors ${isEffectivelyDisabled ? 'opacity-60 grayscale bg-slate-50/50' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project?.color || '#ccc' }}></div>
                          <span className={`text-[10px] font-black uppercase bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 ${isProjectDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-indigo-600'}`}>
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
                        <button
                          onClick={() => startEditing(task)}
                          className="text-slate-400 hover:text-indigo-600 transition-colors p-2"
                          title="Edit Task"
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TasksView;
