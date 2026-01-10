
import React, { useState } from 'react';
import { Client } from '../types';

interface ClientsViewProps {
  clients: Client[];
  onAddClient: (name: string) => void;
}

const ClientsView: React.FC<ClientsViewProps> = ({ clients, onAddClient }) => {
  const [newClientName, setNewClientName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newClientName.trim()) {
      onAddClient(newClientName);
      setNewClientName('');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i className="fa-solid fa-building text-indigo-500"></i> Add New Client
        </h3>
        <form onSubmit={handleSubmit} className="flex gap-4">
          <input 
            type="text" 
            value={newClientName} 
            onChange={(e) => setNewClientName(e.target.value)}
            placeholder="Client Name..." 
            className="flex-1 text-sm px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" 
          />
          <button className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold shadow-md shadow-indigo-100 transition-all active:scale-95">
            Add Client
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <h4 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Active Clients</h4>
          <span className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded text-[10px] font-black">{clients.length} TOTAL</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {clients.map(c => (
            <div key={c.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col justify-center transition-all hover:shadow-md group">
               <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-black text-indigo-400 font-mono tracking-tighter">ID: {c.id.slice(-4)}</span>
                  <i className="fa-solid fa-building text-slate-200 group-hover:text-indigo-200 transition-colors"></i>
               </div>
               <span className="text-sm font-bold text-slate-800">{c.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ClientsView;
