
import React from 'react';
import StandardTable from './StandardTable';
import { Project, Client } from '../types';

interface ProjectsReadOnlyProps {
    projects: Project[];
    clients: Client[];
}

const ProjectsReadOnly: React.FC<ProjectsReadOnlyProps> = ({ projects, clients }) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
            <StandardTable
                title={`Projects Directory (${projects.length})`}
                totalCount={undefined}
                containerClassName="rounded-xl overflow-hidden"
            >
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Client</th>
                            <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Project Name</th>
                            <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</th>
                            <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {projects.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">No projects found.</td>
                            </tr>
                        ) : projects.map(project => {
                            const client = clients.find(c => c.id === project.clientId);
                            const isClientDisabled = client?.isDisabled || false;
                            const isEffectivelyDisabled = project.isDisabled || isClientDisabled;

                            return (
                                <tr key={project.id} className={`group hover:bg-slate-50 transition-colors ${isEffectivelyDisabled ? 'opacity-60 grayscale bg-slate-50/50' : ''}`}>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${isClientDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-praetor'}`}>
                                            {client?.name || 'Unknown'}
                                            {isClientDisabled && <span className="ml-1 text-[8px]">(DISABLED)</span>}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project.color }}></div>
                                            <span className={`text-sm font-bold ${isEffectivelyDisabled ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>{project.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <p className="text-xs text-slate-500 max-w-md italic">{project.description || 'No description provided.'}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                        {project.isDisabled ? (
                                            <span className="text-[10px] font-black text-amber-500 uppercase">Disabled</span>
                                        ) : isClientDisabled ? (
                                            <span className="text-[10px] font-black text-amber-400 uppercase">Inherited Disable</span>
                                        ) : (
                                            <span className="text-[10px] font-black text-emerald-500 uppercase">Active</span>
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

export default ProjectsReadOnly;
