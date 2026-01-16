
import React from 'react';
import StandardTable from './StandardTable';
import { ProjectTask, Project, Client } from '../types';

interface TasksReadOnlyProps {
    tasks: ProjectTask[];
    projects: Project[];
    clients: Client[];
}

const TasksReadOnly: React.FC<TasksReadOnlyProps> = ({ tasks, projects, clients }) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
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
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {tasks.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">No tasks found.</td>
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
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </StandardTable>
        </div>
    );
};

export default TasksReadOnly;
