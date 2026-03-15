import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usersApi } from '../../services/api';
import type { Client, Project, ProjectTask, User } from '../../types';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';

interface EmployeeAssignmentsModalProps {
  user: User | null;
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  isOpen: boolean;
  onClose: () => void;
}

type AssignmentsState = {
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
};

const EMPTY_ASSIGNMENTS: AssignmentsState = {
  clientIds: [],
  projectIds: [],
  taskIds: [],
};

const EmployeeAssignmentsModal: React.FC<EmployeeAssignmentsModalProps> = ({
  user,
  clients,
  projects,
  tasks,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const [assignments, setAssignments] = useState<AssignmentsState>(EMPTY_ASSIGNMENTS);
  const [initialAssignments, setInitialAssignments] = useState<AssignmentsState>(EMPTY_ASSIGNMENTS);
  const [clientSearch, setClientSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');
  const [filterProjectId, setFilterProjectId] = useState('all');
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;

    let isCancelled = false;

    const loadAssignments = async () => {
      setIsLoadingAssignments(true);
      try {
        const data = await usersApi.getAssignments(user.id);
        if (isCancelled) return;
        setAssignments(data);
        setInitialAssignments(data);
      } catch (err) {
        console.error('Failed to load assignments', err);
      } finally {
        if (!isCancelled) {
          setIsLoadingAssignments(false);
        }
      }
    };

    loadAssignments();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, user]);

  useEffect(() => {
    if (isOpen) return;

    setAssignments(EMPTY_ASSIGNMENTS);
    setInitialAssignments(EMPTY_ASSIGNMENTS);
    setClientSearch('');
    setProjectSearch('');
    setTaskSearch('');
    setFilterClientId('all');
    setFilterProjectId('all');
    setIsLoadingAssignments(false);
  }, [isOpen]);

  useEffect(() => {
    if (filterClientId === 'all' || filterProjectId === 'all') return;
    const selectedProject = projects.find((project) => project.id === filterProjectId);
    if (!selectedProject || selectedProject.clientId !== filterClientId) {
      setFilterProjectId('all');
    }
  }, [filterClientId, filterProjectId, projects]);

  const filteredProjectsForFilter =
    filterClientId === 'all'
      ? projects
      : projects.filter((project) => project.clientId === filterClientId);

  const clientFilterOptions = useMemo(
    () => [
      { id: 'all', name: t('hr:workforce.allClients') },
      ...clients.map((client) => ({ id: client.id, name: client.name })),
    ],
    [clients, t],
  );

  const projectFilterOptions = useMemo(
    () => [
      { id: 'all', name: t('hr:workforce.allProjects') },
      ...filteredProjectsForFilter.map((project) => ({ id: project.id, name: project.name })),
    ],
    [filteredProjectsForFilter, t],
  );

  const { visibleClients, visibleProjects, visibleTasks } = useMemo(() => {
    const searchClient = clientSearch.toLowerCase();
    const searchProject = projectSearch.toLowerCase();
    const searchTask = taskSearch.toLowerCase();
    const selectedClientFilter = filterClientId !== 'all' ? filterClientId : null;
    const selectedProjectFilter = filterProjectId !== 'all' ? filterProjectId : null;

    const nextVisibleTasks = tasks.filter((task) => {
      if (selectedProjectFilter && task.projectId !== selectedProjectFilter) return false;
      if (searchTask && !task.name.toLowerCase().includes(searchTask)) return false;

      const project = projects.find((item) => item.id === task.projectId);
      if (!project) return false;

      if (selectedClientFilter && project.clientId !== selectedClientFilter) return false;
      if (searchProject && !project.name.toLowerCase().includes(searchProject)) return false;

      const client = clients.find((item) => item.id === project.clientId);
      if (!client) return false;

      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;
      return true;
    });

    const nextVisibleProjects = projects.filter((project) => {
      if (selectedProjectFilter && project.id !== selectedProjectFilter) return false;
      if (selectedClientFilter && project.clientId !== selectedClientFilter) return false;
      if (searchProject && !project.name.toLowerCase().includes(searchProject)) return false;

      const client = clients.find((item) => item.id === project.clientId);
      if (!client) return false;

      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;

      if (searchTask) {
        const hasMatchingTask = tasks.some(
          (task) => task.projectId === project.id && task.name.toLowerCase().includes(searchTask),
        );
        if (!hasMatchingTask) return false;
      }

      return true;
    });

    const nextVisibleClients = clients.filter((client) => {
      if (selectedClientFilter && client.id !== selectedClientFilter) return false;

      if (selectedProjectFilter) {
        const selectedProject = projects.find((project) => project.id === selectedProjectFilter);
        if (!selectedProject || selectedProject.clientId !== client.id) return false;
      }

      if (searchClient && !client.name.toLowerCase().includes(searchClient)) return false;

      if (searchProject || searchTask) {
        const hasMatchingPath = projects.some((project) => {
          if (project.clientId !== client.id) return false;
          if (selectedProjectFilter && project.id !== selectedProjectFilter) return false;
          if (searchProject && !project.name.toLowerCase().includes(searchProject)) return false;

          if (searchTask) {
            return tasks.some(
              (task) =>
                task.projectId === project.id && task.name.toLowerCase().includes(searchTask),
            );
          }

          return true;
        });

        if (!hasMatchingPath) return false;
      }

      return true;
    });

    return {
      visibleClients: nextVisibleClients,
      visibleProjects: nextVisibleProjects,
      visibleTasks: nextVisibleTasks,
    };
  }, [
    clientSearch,
    clients,
    filterClientId,
    filterProjectId,
    projectSearch,
    projects,
    taskSearch,
    tasks,
  ]);

  const toggleAssignment = (type: 'client' | 'project' | 'task', id: string) => {
    setAssignments((prev) => {
      const list =
        type === 'client' ? prev.clientIds : type === 'project' ? prev.projectIds : prev.taskIds;
      const isAdding = !list.includes(id);
      const newList = isAdding ? [...list, id] : list.filter((item) => item !== id);

      let newClientIds = prev.clientIds;
      let newProjectIds = prev.projectIds;
      let newTaskIds = prev.taskIds;

      if (type === 'task') {
        newTaskIds = newList;
        if (isAdding) {
          const task = tasks.find((item) => item.id === id);
          if (task) {
            const project = projects.find((item) => item.id === task.projectId);
            if (project && !newProjectIds.includes(project.id)) {
              newProjectIds = [...newProjectIds, project.id];
            }
            if (project) {
              const client = clients.find((item) => item.id === project.clientId);
              if (client && !newClientIds.includes(client.id)) {
                newClientIds = [...newClientIds, client.id];
              }
            }
          }
        } else {
          const task = tasks.find((item) => item.id === id);
          if (newTaskIds.length === 0) {
            newProjectIds = [];
            newClientIds = [];
          } else if (task) {
            const project = projects.find((item) => item.id === task.projectId);
            if (project) {
              const hasTaskForProject = newTaskIds.some((taskId) => {
                const remainingTask = tasks.find((item) => item.id === taskId);
                return remainingTask?.projectId === project.id;
              });

              if (!hasTaskForProject) {
                newProjectIds = newProjectIds.filter((projectId) => projectId !== project.id);
              }

              const client = clients.find((item) => item.id === project.clientId);
              if (client) {
                const hasProjectForClient = newProjectIds.some((projectId) => {
                  const remainingProject = projects.find((item) => item.id === projectId);
                  return remainingProject?.clientId === client.id;
                });

                if (!hasProjectForClient) {
                  newClientIds = newClientIds.filter((clientId) => clientId !== client.id);
                }
              }
            }
          }
        }
      } else if (type === 'project') {
        newProjectIds = newList;
        const project = projects.find((item) => item.id === id);
        if (project) {
          if (isAdding) {
            if (!newClientIds.includes(project.clientId)) {
              newClientIds = [...newClientIds, project.clientId];
            }
          } else {
            const hasProjectForClient = newProjectIds.some((projectId) => {
              const remainingProject = projects.find((item) => item.id === projectId);
              return remainingProject?.clientId === project.clientId;
            });

            const hasTaskForClient = newTaskIds.some((taskId) => {
              const remainingTask = tasks.find((item) => item.id === taskId);
              const remainingProject = remainingTask
                ? projects.find((item) => item.id === remainingTask.projectId)
                : null;
              return remainingProject?.clientId === project.clientId;
            });

            if (!hasProjectForClient && !hasTaskForClient) {
              newClientIds = newClientIds.filter((clientId) => clientId !== project.clientId);
            }
          }
        }
      } else {
        newClientIds = newList;
      }

      return {
        clientIds: newClientIds,
        projectIds: newProjectIds,
        taskIds: newTaskIds,
      };
    });
  };

  const saveAssignments = async () => {
    if (!user) return;

    try {
      await usersApi.updateAssignments(
        user.id,
        assignments.clientIds,
        assignments.projectIds,
        assignments.taskIds,
      );
      onClose();
    } catch (err) {
      console.error('Failed to save assignments', err);
      alert((err as Error).message || t('hr:workUnits.failedToSaveAssignments'));
    }
  };

  if (!isOpen || !user) {
    return null;
  }

  const isDirty = JSON.stringify(assignments) !== JSON.stringify(initialAssignments);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={50}
      backdropClass="bg-slate-900/50 backdrop-blur-sm"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h3 className="font-bold text-lg text-slate-800">
            {t('hr:workforce.manageAccess', { name: user.name })}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {isLoadingAssignments ? (
            <div className="flex items-center justify-center py-12">
              <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <CustomSelect
                  options={clientFilterOptions}
                  value={filterClientId}
                  onChange={(value) => setFilterClientId(value as string)}
                  placeholder={t('hr:workforce.filterByClient')}
                  searchable={true}
                  buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm"
                />
                <CustomSelect
                  options={projectFilterOptions}
                  value={filterProjectId}
                  onChange={(value) => setFilterProjectId(value as string)}
                  placeholder={t('hr:workforce.filterByProject')}
                  searchable={true}
                  buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm"
                  disabled={projectFilterOptions.length === 1}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                    <div className="flex items-center justify-between py-2">
                      <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">
                        {t('hr:workforce.clients')}
                      </h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                        {assignments.clientIds.length}
                      </span>
                    </div>
                    <input
                      type="text"
                      placeholder={t('hr:workforce.searchClients')}
                      value={clientSearch}
                      onChange={(event) => setClientSearch(event.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    {visibleClients.map((client) => (
                      <label
                        key={client.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          assignments.clientIds.includes(client.id)
                            ? 'bg-slate-50 border-slate-300 shadow-sm'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="relative flex items-center justify-center shrink-0">
                          <input
                            type="checkbox"
                            checked={assignments.clientIds.includes(client.id)}
                            onChange={() => toggleAssignment('client', client.id)}
                            className="sr-only peer"
                          />
                          <div className="w-5 h-5 rounded-full border-2 border-slate-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                            <div
                              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                                assignments.clientIds.includes(client.id)
                                  ? 'bg-white scale-100 opacity-100'
                                  : 'bg-slate-200 scale-0 opacity-0'
                              }`}
                            ></div>
                          </div>
                        </div>
                        <span
                          className={`text-sm font-semibold ${
                            assignments.clientIds.includes(client.id)
                              ? 'text-slate-900'
                              : 'text-slate-600'
                          }`}
                        >
                          {client.name}
                        </span>
                      </label>
                    ))}
                    {clients.length === 0 && (
                      <p className="text-xs text-slate-400 italic">
                        {t('hr:workforce.noClientsFound')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                    <div className="flex items-center justify-between py-2">
                      <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">
                        {t('hr:workforce.projects')}
                      </h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                        {assignments.projectIds.length}
                      </span>
                    </div>
                    <input
                      type="text"
                      placeholder={t('hr:workforce.searchProjects')}
                      value={projectSearch}
                      onChange={(event) => setProjectSearch(event.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    {visibleProjects.map((project) => (
                      <label
                        key={project.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          assignments.projectIds.includes(project.id)
                            ? 'bg-slate-50 border-slate-300 shadow-sm'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="relative flex items-center justify-center shrink-0">
                          <input
                            type="checkbox"
                            checked={assignments.projectIds.includes(project.id)}
                            onChange={() => toggleAssignment('project', project.id)}
                            className="sr-only peer"
                          />
                          <div className="w-5 h-5 rounded-full border-2 border-slate-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                            <div
                              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                                assignments.projectIds.includes(project.id)
                                  ? 'bg-white scale-100 opacity-100'
                                  : 'bg-slate-200 scale-0 opacity-0'
                              }`}
                            ></div>
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <span
                            className={`text-sm font-semibold ${
                              assignments.projectIds.includes(project.id)
                                ? 'text-slate-900'
                                : 'text-slate-600'
                            }`}
                          >
                            {project.name}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {clients.find((client) => client.id === project.clientId)?.name ||
                              t('hr:workforce.unknownClient')}
                          </span>
                        </div>
                      </label>
                    ))}
                    {projects.length === 0 && (
                      <p className="text-xs text-slate-400 italic">
                        {t('hr:workforce.noProjectsFound')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="sticky top-0 bg-white z-10 pb-2 border-b border-slate-100 mb-2">
                    <div className="flex items-center justify-between py-2">
                      <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">
                        {t('hr:workforce.tasks')}
                      </h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                        {assignments.taskIds.length}
                      </span>
                    </div>
                    <input
                      type="text"
                      placeholder={t('hr:workforce.searchTasks')}
                      value={taskSearch}
                      onChange={(event) => setTaskSearch(event.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    {visibleTasks.map((task) => {
                      const project = projects.find((item) => item.id === task.projectId);
                      return (
                        <label
                          key={task.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            assignments.taskIds.includes(task.id)
                              ? 'bg-slate-50 border-slate-300 shadow-sm'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="relative flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              checked={assignments.taskIds.includes(task.id)}
                              onChange={() => toggleAssignment('task', task.id)}
                              className="sr-only peer"
                            />
                            <div className="w-5 h-5 rounded-full border-2 border-slate-200 relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-white shadow-sm flex items-center justify-center">
                              <div
                                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                                  assignments.taskIds.includes(task.id)
                                    ? 'bg-white scale-100 opacity-100'
                                    : 'bg-slate-200 scale-0 opacity-0'
                                }`}
                              ></div>
                            </div>
                          </div>
                          <div className="flex flex-col">
                            <span
                              className={`text-sm font-semibold ${
                                assignments.taskIds.includes(task.id)
                                  ? 'text-slate-900'
                                  : 'text-slate-600'
                              }`}
                            >
                              {task.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {project?.name || t('hr:workforce.unknownProject')}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                    {tasks.length === 0 && (
                      <p className="text-xs text-slate-400 italic">
                        {t('hr:workforce.noTasksFound')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors text-sm"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            onClick={saveAssignments}
            disabled={!isDirty}
            className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm active:scale-95 text-sm ${
              !isDirty
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                : 'bg-praetor text-white hover:bg-slate-800'
            }`}
          >
            {t('hr:workforce.saveAssignments')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default EmployeeAssignmentsModal;
