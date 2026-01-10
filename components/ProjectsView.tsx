
import React, { useState } from 'react';
import { Project, Client, UserRole } from '../types';
import CustomSelect from './CustomSelect';

interface ProjectsViewProps {
  projects: Project[];
  clients: Client[];
  role: UserRole;
  onAddProject: (name: string, clientId: string, description?: string) => void;
}

const ProjectsView: React.FC<ProjectsViewProps> = ({ projects, clients, role, onAddProject }) => {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [description, setDescription] = useState('');

  const isManagement = role === 'admin' || role === 'manager';

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && clientId) {
      onAddProject(name, clientId, description);
      setName('');
      setClientId('');
      setDescription('');
    }
  };

  const clientOptions = clients.map(c => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isManagement && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-briefcase text-emerald-500"></i> Create New Project
          </h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <CustomSelect
                label="Client"
                options={clientOptions}
                value={clientId}
                onChange={setClientId}
                placeholder="Select Client..."
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Project Name</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Website Redesign" 
                className="w-full text-sm px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Description</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={description} 
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is this project about?" 
                  className="flex-1 text-sm px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
                />
                <button className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold shadow-md shadow-emerald-100 transition-all active:scale-95">
                  Create
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
              <i className="fa-solid fa-briefcase text-indigo-400"></i>
              Projects Directory
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Active and archived projects</p>
          </div>
          <div className="text-right">
            <span className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-xs font-bold border border-indigo-500/30">
              {projects.length} Total
            </span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Client</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Project Name</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-400 italic">No projects found.</td>
                </tr>
              ) : projects.map(project => {
                const client = clients.find(c => c.id === project.clientId);
                return (
                  <tr key={project.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="text-[10px] font-black text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded">
                        {client?.name || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project.color }}></div>
                        <span className="text-sm font-bold text-slate-800">{project.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-slate-500 max-w-md italic">{project.description || 'No description provided.'}</p>
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

export default ProjectsView;
