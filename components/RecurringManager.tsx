import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Client, Project, ProjectTask } from '../types';
import Modal from './Modal';

interface RecurringManagerProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  onAction: (taskId: string, action: 'stop' | 'delete_future' | 'delete_all') => void;
}

const RecurringManager: React.FC<RecurringManagerProps> = ({
  tasks,
  projects,
  clients,
  onAction,
}) => {
  const { t } = useTranslation('timesheets');
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);

  // Only show active recurring tasks
  const recurringTasks = tasks.filter((t) => t.isRecurring);

  const getContext = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    const client = proj ? clients.find((c) => c.id === proj.clientId) : null;
    return { project: proj, client };
  };

  const closeModal = () => setSelectedTask(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              {t('recurring.recurringTaskSchedule')}
            </h3>
            <p className="text-xs text-slate-500">{t('recurring.manageAutomatedTasks')}</p>
          </div>
          <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-xs font-bold">
            {recurringTasks.length} {t('recurring.active')}
          </span>
        </div>

        {recurringTasks.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fa-solid fa-repeat text-slate-300 text-2xl"></i>
            </div>
            <p className="text-slate-500 font-medium">
              {t('recurring.noRecurringTasksConfigured')}
            </p>
            <p className="text-xs text-slate-400 mt-1">{t('recurring.setFromTracker')}</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-white border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('recurring.taskDetails')}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('recurring.pattern')}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('recurring.endDate')}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">
                  {t('recurring.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recurringTasks.map((task) => {
                const { project, client } = getContext(task.projectId);
                return (
                  <tr key={task.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-sm">{task.name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black uppercase text-praetor tracking-wide">
                            {client?.name || t('recurring.unknown')}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: project?.color || '#ccc' }}
                            ></span>
                            {project?.name || t('recurring.unknown')}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide bg-slate-50 text-praetor border border-slate-200">
                        <i className="fa-solid fa-repeat text-[10px]"></i>
                        {task.recurrencePattern}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {task.recurrenceEnd ? (
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded">
                          {new Date(task.recurrenceEnd).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">
                          {t('recurring.noExpiration')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedTask(task)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title={t('recurring.removeRecurrence')}
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
      <Modal
        isOpen={!!selectedTask}
        onClose={closeModal}
        zIndex={50}
        backdropClass="bg-slate-900/50 backdrop-blur-sm"
      >
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
              {t('entry.stopRecurringTask')}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {t('entry.howHandleEntries')}{' '}
              <strong className="text-slate-800">{selectedTask?.name}</strong>?
            </p>
          </div>

          <div className="p-4 space-y-3">
            <button
              onClick={() => {
                onAction(selectedTask.id, 'stop');
                closeModal();
              }}
              className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-slate-800 group-hover:text-praetor">
                  {t('recurring.stopOnly')}
                </span>
                <i className="fa-solid fa-pause text-slate-300 group-hover:text-praetor"></i>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t('recurring.stopOnlyDesc')}
              </p>
            </button>

            <button
              onClick={() => {
                onAction(selectedTask.id, 'delete_future');
                closeModal();
              }}
              className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 transition-all group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-slate-800 group-hover:text-red-700">
                  {t('recurring.deleteFuture')}
                </span>
                <i className="fa-solid fa-forward text-slate-300 group-hover:text-red-500"></i>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t('recurring.deleteFutureDesc')}
              </p>
            </button>

            <button
              onClick={() => {
                onAction(selectedTask.id, 'delete_all');
                closeModal();
              }}
              className="w-full text-left p-4 rounded-xl border border-red-100 bg-red-50/50 hover:bg-red-100 hover:border-red-300 transition-all group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-red-700">{t('recurring.deleteAll')}</span>
                <i className="fa-solid fa-dumpster-fire text-red-400 group-hover:text-red-600"></i>
              </div>
              <p className="text-xs text-red-600/70 leading-relaxed">
                {t('recurring.deleteAllDesc')}
              </p>
            </button>
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
            <button
              onClick={closeModal}
              className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
            >
              {t('recurring.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default RecurringManager;
