import React, { useState } from 'react';
import { Client } from '../types';

interface ClientsViewProps {
  clients: Client[];
  onAddClient: (name: string) => void;
  onUpdateClient: (id: string, updates: Partial<Client>) => void;
  onDeleteClient: (id: string) => void;
}

const ClientsView: React.FC<ClientsViewProps> = ({ clients, onAddClient, onUpdateClient, onDeleteClient }) => {
  const [newClientName, setNewClientName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newClientName.trim()) {
      onAddClient(newClientName);
      setNewClientName('');
    }
  };

  const activeClients = clients.filter(c => !c.isDisabled);
  const disabledClients = clients.filter(c => c.isDisabled);

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
            className="flex-1 text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
          />
          <button className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold shadow-md shadow-indigo-100 transition-all active:scale-95">
            Add Client
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <h4 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Active Clients</h4>
          <span className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded text-[10px] font-black">{activeClients.length} ACTIVE</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {activeClients.map(c => (
            <div key={c.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-black text-indigo-400 font-mono tracking-tighter">ID: {c.id.slice(-4)}</span>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onUpdateClient(c.id, { name: c.name, isDisabled: true })}
                    title="Disable Client"
                    className="text-slate-400 hover:text-amber-500 transition-colors"
                  >
                    <i className="fa-solid fa-ban text-xs"></i>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete client "${c.name}"? This will delete all associated projects and tasks.`)) {
                        onDeleteClient(c.id);
                      }
                    }}
                    title="Delete Client"
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <i className="fa-solid fa-trash-can text-xs"></i>
                  </button>
                </div>
              </div>
              <span className="text-sm font-bold text-slate-800">{c.name}</span>
            </div>
          ))}
          {activeClients.length === 0 && (
            <div className="col-span-full py-8 text-center text-slate-400 text-sm italic">
              No active clients found.
            </div>
          )}
        </div>
      </div>

      {disabledClients.length > 0 && (
        <div className="bg-slate-50 rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-dashed">
          <div className="px-6 py-4 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
            <h4 className="font-bold text-slate-400 uppercase text-xs tracking-widest">Disabled Clients</h4>
            <span className="bg-slate-200 text-slate-500 px-2 py-1 rounded text-[10px] font-black">{disabledClients.length} DISABLED</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
            {disabledClients.map(c => (
              <div key={c.id} className="p-4 bg-white/50 border border-slate-200 rounded-xl flex flex-col opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all group">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-black text-slate-400 font-mono tracking-tighter">ID: {c.id.slice(-4)}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onUpdateClient(c.id, { name: c.name, isDisabled: false })}
                      title="Enable Client"
                      className="text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      <i className="fa-solid fa-rotate-left text-xs"></i>
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to delete client "${c.name}"?`)) {
                          onDeleteClient(c.id);
                        }
                      }}
                      title="Delete Client"
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <i className="fa-solid fa-trash-can text-xs"></i>
                    </button>
                  </div>
                </div>
                <span className="text-sm font-bold text-slate-400 line-through decoration-slate-300">{c.name}</span>
                <span className="text-[10px] font-bold text-amber-500 uppercase mt-1">Disabled</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsView;
