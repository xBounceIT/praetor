import React, { useState } from 'react';
import { User, UserRole, Client, Project, ProjectTask } from '../types';
import CustomSelect from './CustomSelect';
import { usersApi } from '../services/api';

interface UserManagementProps {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  onAddUser: (name: string, username: string, password: string, role: UserRole) => void;
  onDeleteUser: (id: string) => void;
  currentUserId: string;
  currentUserRole: UserRole;
}

const ROLE_OPTIONS = [
  { id: 'user', name: 'User' },
  { id: 'manager', name: 'Manager' },
  { id: 'admin', name: 'Admin' },
];

const UserManagement: React.FC<UserManagementProps> = ({ users, clients, projects, tasks, onAddUser, onDeleteUser, currentUserId, currentUserRole }) => {
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('password');
  const [newRole, setNewRole] = useState<UserRole>('user');

  const [managingUserId, setManagingUserId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<{ clientIds: string[], projectIds: string[], taskIds: string[] }>({
    clientIds: [], projectIds: [], taskIds: []
  });
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName && newUsername && newPassword) {
      onAddUser(newName, newUsername, newPassword, newRole);
      setNewName('');
      setNewUsername('');
      setNewPassword('password');
      setNewRole('user');
    }
  };

  const openAssignments = async (userId: string) => {
    setManagingUserId(userId);
    setIsLoadingAssignments(true);
    try {
      const data = await usersApi.getAssignments(userId);
      setAssignments(data);
    } catch (err) {
      console.error("Failed to load assignments", err);
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const closeAssignments = () => {
    setManagingUserId(null);
    setAssignments({ clientIds: [], projectIds: [], taskIds: [] });
  };

  const saveAssignments = async () => {
    if (!managingUserId) return;
    try {
      await usersApi.updateAssignments(managingUserId, assignments.clientIds, assignments.projectIds, assignments.taskIds);
      closeAssignments();
    } catch (err) {
      console.error("Failed to save assignments", err);
      alert("Failed to save assignments");
    }
  };

  const toggleAssignment = (type: 'client' | 'project' | 'task', id: string) => {
    setAssignments(prev => {
      const list = type === 'client' ? prev.clientIds : type === 'project' ? prev.projectIds : prev.taskIds;
      const newList = list.includes(id) ? list.filter(item => item !== id) : [...list, id];

      return {
        ...prev,
        [type === 'client' ? 'clientIds' : type === 'project' ? 'projectIds' : 'taskIds']: newList
      };
    });
  };

  const managingUser = users.find(u => u.id === managingUserId);

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {currentUserRole === 'admin' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-user-plus text-indigo-500"></i>
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
                }}
                placeholder="e.g. Alice Smith"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Username</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. alice"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Password</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Password"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
              />
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
                className="w-full px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all h-[38px] shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> Add
              </button>
            </div>
          </form>
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
            {users.map(user => (
              <tr key={user.id} className="group hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                      {user.avatarInitials}
                    </div>
                    <span className="font-bold text-slate-800">{user.name}</span>
                    {user.id === currentUserId && <span className="text-[10px] bg-indigo-600 px-2 py-0.5 rounded text-white font-bold uppercase">You</span>}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-slate-600 font-mono">{user.username}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${user.role === 'admin' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                    user.role === 'manager' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                      'bg-slate-50 text-slate-600 border-slate-100'
                    }`}>
                    {user.role === 'admin' && <i className="fa-solid fa-shield-halved"></i>}
                    {user.role === 'manager' && <i className="fa-solid fa-briefcase"></i>}
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openAssignments(user.id)}
                      className="text-slate-400 hover:text-indigo-600 transition-colors p-2"
                      title="Manage Assignments"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                    {currentUserRole === 'admin' && (
                      <button
                        onClick={() => onDeleteUser(user.id)}
                        disabled={user.id === currentUserId}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assignment Modal */}
      {managingUserId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-lg text-slate-800">
                Manage Access: <span className="text-indigo-600">{managingUser?.name}</span>
              </h3>
              <button onClick={closeAssignments} className="text-slate-400 hover:text-slate-600 transition-colors">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingAssignments ? (
                <div className="flex items-center justify-center py-12">
                  <i className="fa-solid fa-circle-notch fa-spin text-3xl text-indigo-500"></i>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Clients Column */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between sticky top-0 bg-white z-10 py-2 border-b border-slate-100">
                      <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Clients</h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assignments.clientIds.length}</span>
                    </div>
                    <div className="space-y-2">
                      {clients.map(client => (
                        <label key={client.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${assignments.clientIds.includes(client.id)
                          ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-indigo-200'
                          }`}>
                          <input
                            type="checkbox"
                            checked={assignments.clientIds.includes(client.id)}
                            onChange={() => toggleAssignment('client', client.id)}
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                          />
                          <span className={`text-sm font-semibold ${assignments.clientIds.includes(client.id) ? 'text-indigo-900' : 'text-slate-600'}`}>
                            {client.name}
                          </span>
                        </label>
                      ))}
                      {clients.length === 0 && <p className="text-xs text-slate-400 italic">No clients found.</p>}
                    </div>
                  </div>

                  {/* Projects Column */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between sticky top-0 bg-white z-10 py-2 border-b border-slate-100">
                      <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Projects</h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assignments.projectIds.length}</span>
                    </div>
                    <div className="space-y-2">
                      {projects.map(project => (
                        <label key={project.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${assignments.projectIds.includes(project.id)
                          ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-indigo-200'
                          }`}>
                          <input
                            type="checkbox"
                            checked={assignments.projectIds.includes(project.id)}
                            onChange={() => toggleAssignment('project', project.id)}
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                          />
                          <div className="flex flex-col">
                            <span className={`text-sm font-semibold ${assignments.projectIds.includes(project.id) ? 'text-indigo-900' : 'text-slate-600'}`}>
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

                  {/* Tasks Column */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between sticky top-0 bg-white z-10 py-2 border-b border-slate-100">
                      <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Tasks</h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assignments.taskIds.length}</span>
                    </div>
                    <div className="space-y-2">
                      {tasks.map(task => {
                        const project = projects.find(p => p.id === task.projectId);
                        return (
                          <label key={task.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${assignments.taskIds.includes(task.id)
                            ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                            : 'bg-white border-slate-200 hover:border-indigo-200'
                            }`}>
                            <input
                              type="checkbox"
                              checked={assignments.taskIds.includes(task.id)}
                              onChange={() => toggleAssignment('task', task.id)}
                              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                            />
                            <div className="flex flex-col">
                              <span className={`text-sm font-semibold ${assignments.taskIds.includes(task.id) ? 'text-indigo-900' : 'text-slate-600'}`}>
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
                className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm active:scale-95 text-sm"
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
