
import React, { useState } from 'react';
import { User } from '../types';
import CustomSelect from './CustomSelect';

interface LoginProps {
  users: User[];
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ users, onLogin }) => {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.id || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.id === selectedUserId);
    if (user) onLogin(user);
  };

  const userOptions = users.map(u => ({
    id: u.id,
    name: `${u.name} — ${u.role.toUpperCase()}`
  }));

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
            <i className="fa-solid fa-clock text-2xl text-white"></i>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Tempo</h1>
          <p className="text-slate-500 text-sm">Sign in to your workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <CustomSelect 
              label="Select User (Simulation)"
              options={userOptions}
              value={selectedUserId}
              onChange={setSelectedUserId}
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            Enter Workspace <i className="fa-solid fa-arrow-right"></i>
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-400">
            <strong>Tip:</strong> Select "Admin" to manage users, "Manager" to edit projects, or "User" to log time.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
