
import React, { useState } from 'react';
import { User, UserRole } from '../types';
import CustomSelect from './CustomSelect';

interface UserManagementProps {
  users: User[];
  onAddUser: (name: string, role: UserRole) => void;
  onDeleteUser: (id: string) => void;
  currentUserId: string;
}

const ROLE_OPTIONS = [
  { id: 'user', name: 'User' },
  { id: 'manager', name: 'Manager' },
  { id: 'admin', name: 'Admin' },
];

const UserManagement: React.FC<UserManagementProps> = ({ users, onAddUser, onDeleteUser, currentUserId }) => {
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName) {
      onAddUser(newName, newRole);
      setNewName('');
      setNewRole('user');
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i className="fa-solid fa-user-plus text-indigo-500"></i>
          Create New User
        </h3>
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Name</label>
            <input 
              type="text" 
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Alice Smith"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
            />
          </div>
          <div className="w-48">
            <CustomSelect 
              label="Role"
              options={ROLE_OPTIONS}
              value={newRole}
              onChange={val => setNewRole(val as UserRole)}
            />
          </div>
          <button 
            type="submit"
            className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all h-[38px] shadow-sm active:scale-95"
          >
            Add
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-bold text-slate-800">Team Members ({users.length})</h3>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">User</th>
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
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                    user.role === 'admin' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                    user.role === 'manager' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                    'bg-slate-50 text-slate-600 border-slate-100'
                  }`}>
                   {user.role === 'admin' && <i className="fa-solid fa-shield-halved"></i>}
                   {user.role === 'manager' && <i className="fa-solid fa-briefcase"></i>}
                   {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => onDeleteUser(user.id)}
                    disabled={user.id === currentUserId}
                    className="text-slate-200 hover:text-red-500 disabled:opacity-0 transition-colors p-2"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserManagement;
