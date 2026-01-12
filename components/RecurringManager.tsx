
import React, { useState } from 'react';
import { Client, Project, ProjectTask } from '../types';

interface RecurringManagerProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  onAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
}

const RecurringManager: React.FC<RecurringManagerProps> = ({ tasks, projects, clients, onAction }) => {
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);

  // Only show active recurring tasks
  const recurringTasks = tasks.filter(t => t.isRecurring);

  const getContext = (projectId: string) => {
    const proj = projects.find(p => p.id === projectId);
    const client = proj ? clients.find(c => c.id === proj.clientId) : null;
    return { project: proj, client };
  };

  const closeModal = () => setSelectedTask(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Recurring Task Schedule</h3>
            <p className="text-xs text-slate-500">Manage automated tasks and patterns</p>
          </div>
          <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold">
            {recurringTasks.length} Active
          </span>
        </div>

        {recurringTasks.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fa-solid fa-repeat text-slate-300 text-2xl"></i>
            </div>
            <p className="text-slate-500 font-medium">No recurring tasks configured.</p>
            <p className="text-xs text-slate-400 mt-1">Set tasks to repeat from the Time Tracker or Projects view.</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-white border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Task Details</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Pattern</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">End Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recurringTasks.map(task => {
                const { project, client } = getContext(task.projectId);
                return (
                  <tr key={task.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-sm">{task.name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black uppercase text-indigo-500 tracking-wide">{client?.name || 'Unknown'}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project?.color || '#ccc' }}></span>
                            {project?.name || 'Unknown'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-100">
                        <i className="fa-solid fa-repeat text-[10px]"></i>
                        {task.recurrencePattern === 'first_of_month' ? 'Every 1st' : task.recurrencePattern}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {task.recurrenceEnd ? (
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded">
                          {new Date(task.recurrenceEnd).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No expiration</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedTask(task)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Remove Recurrence"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Action Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                Stop Recurring Task?
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                How would you like to handle existing entries for <strong className="text-slate-800">{selectedTask.name}</strong>?
              </p>
            </div>

            <div className="p-4 space-y-3">
              <button
                onClick={() => { onAction(selectedTask.id, 'stop'); closeModal(); }}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 group-hover:text-indigo-700">Only Stop Recurrence</span>
                  <i className="fa-solid fa-pause text-slate-300 group-hover:text-indigo-500"></i>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Keeps all existing history. Just stops the task from repeating in the future.
                </p>
              </button>

              <button
                onClick={() => { onAction(selectedTask.id, 'delete_future'); closeModal(); }}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 group-hover:text-red-700">Delete Today & Future</span>
                  <i className="fa-solid fa-forward text-slate-300 group-hover:text-red-500"></i>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Stops recurrence and removes entries from today onwards. Past history is saved.
                </p>
              </button>

              <button
                onClick={() => { onAction(selectedTask.id, 'delete_all'); closeModal(); }}
                className="w-full text-left p-4 rounded-xl border border-red-100 bg-red-50/50 hover:bg-red-100 hover:border-red-300 transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-red-700">Delete Everything</span>
                  <i className="fa-solid fa-dumpster-fire text-red-400 group-hover:text-red-600"></i>
                </div>
                <p className="text-xs text-red-600/70 leading-relaxed">
                  Completely wipes the task settings and ALL associated time logs forever.
                </p>
              </button>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurringManager;
