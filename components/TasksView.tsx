
import React, { useState } from 'react';
import { ProjectTask, Project, UserRole } from '../types';
import CustomSelect from './CustomSelect';

interface TasksViewProps {
  tasks: ProjectTask[];
  projects: Project[];
  role: UserRole;
  onAddTask: (name: string, projectId: string, recurringConfig?: any, description?: string) => void;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void;
}

const TasksView: React.FC<TasksViewProps> = ({ tasks, projects, role, onAddTask, onUpdateTask }) => {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  const isManagement = role === 'admin' || role === 'manager';

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && projectId) {
      onAddTask(name, projectId, undefined, description);
      setName('');
      setProjectId('');
      setDescription('');
    }
  };

  const startEditing = (task: ProjectTask) => {
    setEditingId(task.id);
    setEditForm({ name: task.name, description: task.description || '' });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEdit = (id: string) => {
    onUpdateTask(id, { name: editForm.name, description: editForm.description });
    setEditingId(null);
  };

  const projectOptions = projects.map(p => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isManagement && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-list-check text-blue-500"></i> Create New Task
          </h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                className="w-full text-sm px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Description</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={description} 
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Task context..." 
                  className="flex-1 text-sm px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                />
                <button className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold shadow-md shadow-blue-100 transition-all active:scale-95">
                  Add
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black italic tracking-tighter uppercase flex items-center gap-3">
              <i className="fa-solid fa-tasks text-indigo-400"></i>
              Tasks Directory
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Full list of project tasks</p>
          </div>
          <div className="text-right">
            <span className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-xs font-bold border border-indigo-500/30">
              {tasks.length} Total
            </span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Project</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Task Name</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</th>
                {isManagement && <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={isManagement ? 4 : 3} className="px-6 py-12 text-center text-slate-400 italic">No tasks found.</td>
                </tr>
              ) : tasks.map(task => {
                const project = projects.find(p => p.id === task.projectId);
                const isEditing = editingId === task.id;
                
                return (
                  <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: project?.color || '#ccc' }}></div>
                        <span className="text-xs font-bold text-slate-600">{project?.name || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={editForm.name}
                          onChange={e => setEditForm({...editForm, name: e.target.value})}
                          className="w-full px-2 py-1 text-sm border rounded bg-white font-bold"
                        />
                      ) : (
                        <span className="text-sm font-bold text-slate-800">{task.name}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={editForm.description}
                          onChange={e => setEditForm({...editForm, description: e.target.value})}
                          className="w-full px-2 py-1 text-xs border rounded bg-white italic"
                        />
                      ) : (
                        <p className="text-xs text-slate-500 max-w-md italic">{task.description || 'No description provided.'}</p>
                      )}
                    </td>
                    {isManagement && (
                      <td className="px-6 py-4 text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => saveEdit(task.id)} className="text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded text-xs font-bold">Save</button>
                            <button onClick={cancelEditing} className="text-slate-400 hover:bg-slate-100 px-2 py-1 rounded text-xs font-bold">Cancel</button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => startEditing(task)}
                            className="text-indigo-600 hover:bg-indigo-50 px-3 py-1 rounded-lg text-xs font-bold transition-all"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    )}
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
