import type React from 'react';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usersApi } from '../../services/api';
import type { Client, Project, ProjectTask, User } from '../../types';
import { toastError } from '../../utils/toast';
import Modal from '../shared/Modal';
import SelectControl from '../shared/SelectControl';

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

type AssignmentKind = 'client' | 'project' | 'task';

type EmployeeAssignmentsState = {
  assignments: AssignmentsState;
  initialAssignments: AssignmentsState;
  clientSearch: string;
  projectSearch: string;
  taskSearch: string;
  filterClientId: string;
  filterProjectId: string;
  isLoadingAssignments: boolean;
  loadFailed: boolean;
};

type EmployeeAssignmentsAction =
  | { type: 'resetSession'; isLoadingAssignments: boolean }
  | { type: 'loadSuccess'; assignments: AssignmentsState }
  | { type: 'loadFailed' }
  | { type: 'setClientSearch'; value: string }
  | { type: 'setProjectSearch'; value: string }
  | { type: 'setTaskSearch'; value: string }
  | { type: 'setFilterClient'; value: string }
  | { type: 'setFilterProject'; value: string }
  | {
      type: 'toggleAssignment';
      assignmentType: AssignmentKind;
      id: string;
      clients: Client[];
      projects: Project[];
      tasks: ProjectTask[];
    };

const createEmployeeAssignmentsState = (
  isLoadingAssignments = false,
): EmployeeAssignmentsState => ({
  assignments: EMPTY_ASSIGNMENTS,
  initialAssignments: EMPTY_ASSIGNMENTS,
  clientSearch: '',
  projectSearch: '',
  taskSearch: '',
  filterClientId: 'all',
  filterProjectId: 'all',
  isLoadingAssignments,
  loadFailed: false,
});

const toggleAssignments = (
  prev: AssignmentsState,
  type: AssignmentKind,
  id: string,
  clients: Client[],
  projects: Project[],
  tasks: ProjectTask[],
): AssignmentsState => {
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
};

const employeeAssignmentsReducer = (
  state: EmployeeAssignmentsState,
  action: EmployeeAssignmentsAction,
): EmployeeAssignmentsState => {
  switch (action.type) {
    case 'resetSession':
      return createEmployeeAssignmentsState(action.isLoadingAssignments);
    case 'loadSuccess':
      return {
        ...state,
        assignments: action.assignments,
        initialAssignments: action.assignments,
        isLoadingAssignments: false,
        loadFailed: false,
      };
    case 'loadFailed':
      return { ...state, isLoadingAssignments: false, loadFailed: true };
    case 'setClientSearch':
      return { ...state, clientSearch: action.value };
    case 'setProjectSearch':
      return { ...state, projectSearch: action.value };
    case 'setTaskSearch':
      return { ...state, taskSearch: action.value };
    case 'setFilterClient':
      return { ...state, filterClientId: action.value };
    case 'setFilterProject':
      return { ...state, filterProjectId: action.value };
    case 'toggleAssignment':
      return {
        ...state,
        assignments: toggleAssignments(
          state.assignments,
          action.assignmentType,
          action.id,
          action.clients,
          action.projects,
          action.tasks,
        ),
      };
    default:
      return state;
  }
};

type AssignmentColumnItem = {
  id: string;
  name: string;
  subtitle?: string;
};

const AssignmentColumn: React.FC<{
  title: string;
  count: number;
  searchLabel: string;
  searchValue: string;
  items: AssignmentColumnItem[];
  selectedIds: string[];
  emptyMessage: string;
  onSearchChange: (value: string) => void;
  onToggle: (id: string) => void;
}> = ({
  title,
  count,
  searchLabel,
  searchValue,
  items,
  selectedIds,
  emptyMessage,
  onSearchChange,
  onToggle,
}) => (
  <div className="space-y-3">
    <div className="sticky top-0 bg-card z-10 pb-2 border-b border-border mb-2">
      <div className="flex items-center justify-between py-2">
        <h4 className="font-semibold text-foreground text-sm uppercase tracking-wider">{title}</h4>
        <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      <input
        type="text"
        placeholder={searchLabel}
        aria-label={searchLabel}
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        className="w-full px-3 py-1.5 text-sm border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-praetor outline-none placeholder:text-muted-foreground"
      />
    </div>
    <div className="space-y-2">
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        return (
          <label
            key={item.id}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              selected ? 'bg-accent border-border shadow-sm' : 'bg-card border-border hover:border-input'
            }`}
          >
            <div className="relative flex items-center justify-center shrink-0">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(item.id)}
                aria-label={item.name}
                className="sr-only peer"
              />
              <div className="size-5 rounded-full border-2 border-border relative transition-all peer-checked:bg-praetor peer-checked:border-praetor bg-background shadow-sm flex items-center justify-center">
                <div
                  className={`size-2 rounded-full transition-all duration-200 ${
                    selected ? 'bg-white scale-100 opacity-100' : 'bg-zinc-200 scale-0 opacity-0'
                  }`}
                ></div>
              </div>
            </div>
            <span
              className={`text-sm font-semibold ${
                selected ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {item.name}
              {item.subtitle && (
                <span className="block text-[10px] font-normal text-muted-foreground">
                  {item.subtitle}
                </span>
              )}
            </span>
          </label>
        );
      })}
      {items.length === 0 && <p className="text-xs text-muted-foreground italic">{emptyMessage}</p>}
    </div>
  </div>
);

const EmployeeAssignmentsHeader: React.FC<{
  title: string;
  closeLabel: string;
  onClose: () => void;
}> = ({ title, closeLabel, onClose }) => (
  <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/50">
    <h3 className="font-semibold text-lg text-foreground">{title}</h3>
    <button
      type="button"
      onClick={onClose}
      aria-label={closeLabel}
      className="text-muted-foreground hover:text-foreground transition-colors"
    >
      <i className="fa-solid fa-xmark text-xl"></i>
    </button>
  </div>
);

const EmployeeAssignmentsFooter: React.FC<{
  cancelLabel: string;
  saveLabel: string;
  isDirty: boolean;
  loadFailed: boolean;
  onClose: () => void;
  onSave: () => void;
}> = ({ cancelLabel, saveLabel, isDirty, loadFailed, onClose, onSave }) => (
  <div className="p-6 border-t border-border bg-muted/50 flex justify-end gap-3">
    <button
      type="button"
      onClick={onClose}
      className="px-4 py-2 text-muted-foreground font-bold hover:bg-muted rounded-lg transition-colors text-sm"
    >
      {cancelLabel}
    </button>
    <button
      type="button"
      onClick={onSave}
      disabled={!isDirty || loadFailed}
      className={`px-6 py-2 font-bold rounded-lg transition-all shadow-sm active:scale-95 text-sm ${
        !isDirty || loadFailed
          ? 'bg-muted text-muted-foreground cursor-not-allowed border border-border'
          : 'bg-praetor text-white hover:bg-praetor/90'
      }`}
    >
      {saveLabel}
    </button>
  </div>
);

const AssignmentsLoadingState: React.FC = () => (
  <div className="flex items-center justify-center py-12">
    <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
  </div>
);

const AssignmentsLoadError: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
    <i className="fa-solid fa-triangle-exclamation text-3xl text-red-500 mb-3"></i>
    <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
  </div>
);

const AssignmentFilters: React.FC<{
  clientOptions: { id: string; name: string }[];
  projectOptions: { id: string; name: string }[];
  filterClientId: string;
  filterProjectId: string;
  clientPlaceholder: string;
  projectPlaceholder: string;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
}> = ({
  clientOptions,
  projectOptions,
  filterClientId,
  filterProjectId,
  clientPlaceholder,
  projectPlaceholder,
  onClientChange,
  onProjectChange,
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <SelectControl
      options={clientOptions}
      value={filterClientId}
      onChange={(value) => onClientChange(value as string)}
      placeholder={clientPlaceholder}
      searchable={true}
      buttonClassName="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-semibold text-foreground shadow-sm"
    />
    <SelectControl
      options={projectOptions}
      value={filterProjectId}
      onChange={(value) => onProjectChange(value as string)}
      placeholder={projectPlaceholder}
      searchable={true}
      buttonClassName="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-semibold text-foreground shadow-sm"
      disabled={projectOptions.length === 1}
    />
  </div>
);

type EmployeeAssignmentOptionsInput = {
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  clientSearch: string;
  projectSearch: string;
  taskSearch: string;
  filterClientId: string;
  filterProjectId: string;
};

const useEmployeeAssignmentOptions = ({
  clients,
  projects,
  tasks,
  clientSearch,
  projectSearch,
  taskSearch,
  filterClientId,
  filterProjectId,
}: EmployeeAssignmentOptionsInput) => {
  const { t } = useTranslation(['hr']);
  const filteredProjectsForFilter = useMemo(
    () =>
      filterClientId === 'all'
        ? projects
        : projects.filter((project) => project.clientId === filterClientId),
    [filterClientId, projects],
  );

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

  const visibleClientItems = useMemo(
    () => visibleClients.map((client) => ({ id: client.id, name: client.name })),
    [visibleClients],
  );
  const visibleProjectItems = useMemo(
    () =>
      visibleProjects.map((project) => ({
        id: project.id,
        name: project.name,
        subtitle:
          clients.find((client) => client.id === project.clientId)?.name ||
          t('hr:workforce.unknownClient'),
      })),
    [clients, visibleProjects, t],
  );
  const visibleTaskItems = useMemo(
    () =>
      visibleTasks.map((task) => ({
        id: task.id,
        name: task.name,
        subtitle:
          projects.find((project) => project.id === task.projectId)?.name ||
          t('hr:workforce.unknownProject'),
      })),
    [projects, visibleTasks, t],
  );

  return {
    clientFilterOptions,
    projectFilterOptions,
    visibleClientItems,
    visibleProjectItems,
    visibleTaskItems,
  };
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
  const [state, dispatch] = useReducer(
    employeeAssignmentsReducer,
    undefined,
    createEmployeeAssignmentsState,
  );
  const {
    assignments,
    initialAssignments,
    clientSearch,
    projectSearch,
    taskSearch,
    filterClientId,
    filterProjectId,
    isLoadingAssignments,
    loadFailed,
  } = state;
  const modalSessionKey = isOpen && user ? user.id : 'closed';
  const activeModalSessionKeyRef = useRef(modalSessionKey);

  if (activeModalSessionKeyRef.current !== modalSessionKey) {
    activeModalSessionKeyRef.current = modalSessionKey;
    dispatch({ type: 'resetSession', isLoadingAssignments: modalSessionKey !== 'closed' });
  }

  useEffect(() => {
    if (!isOpen || !user) return;

    let isCancelled = false;

    const loadAssignments = async () => {
      try {
        const data = await usersApi.getAssignments(user.id);
        if (isCancelled) return;
        dispatch({ type: 'loadSuccess', assignments: data });
      } catch (err) {
        if (isCancelled) return;
        console.error('Failed to load assignments', err);
        dispatch({ type: 'loadFailed' });
        toastError(t('hr:workforce.failedToLoadAssignments'));
      }
    };

    loadAssignments();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, user, t]);

  const {
    clientFilterOptions,
    projectFilterOptions,
    visibleClientItems,
    visibleProjectItems,
    visibleTaskItems,
  } = useEmployeeAssignmentOptions({
    clientSearch,
    clients,
    filterClientId,
    filterProjectId,
    projectSearch,
    projects,
    taskSearch,
    tasks,
  });

  const toggleAssignment = (assignmentType: AssignmentKind, id: string) => {
    dispatch({ type: 'toggleAssignment', assignmentType, id, clients, projects, tasks });
  };

  const handleClientFilterChange = (value: string) => {
    dispatch({ type: 'setFilterClient', value });
    if (value === 'all' || filterProjectId === 'all') return;

    const selectedProject = projects.find((project) => project.id === filterProjectId);
    if (!selectedProject || selectedProject.clientId !== value) {
      dispatch({ type: 'setFilterProject', value: 'all' });
    }
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
      toastError((err as Error).message || t('hr:competenceCenters.failedToSaveAssignments'));
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
      backdropClass="bg-zinc-900/50 backdrop-blur-sm"
    >
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <EmployeeAssignmentsHeader
          title={t('hr:workforce.manageAccess', { name: user.name })}
          closeLabel={t('common:buttons.close')}
          onClose={onClose}
        />

        <div className="p-6 overflow-y-auto flex-1">
          {isLoadingAssignments ? (
            <AssignmentsLoadingState />
          ) : loadFailed ? (
            <AssignmentsLoadError message={t('hr:workforce.failedToLoadAssignments')} />
          ) : (
            <>
              <AssignmentFilters
                clientOptions={clientFilterOptions}
                projectOptions={projectFilterOptions}
                filterClientId={filterClientId}
                filterProjectId={filterProjectId}
                clientPlaceholder={t('hr:workforce.filterByClient')}
                projectPlaceholder={t('hr:workforce.filterByProject')}
                onClientChange={handleClientFilterChange}
                onProjectChange={(value) => dispatch({ type: 'setFilterProject', value })}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <AssignmentColumn
                  title={t('hr:workforce.clients')}
                  count={assignments.clientIds.length}
                  searchLabel={t('hr:workforce.searchClients')}
                  searchValue={clientSearch}
                  items={visibleClientItems}
                  selectedIds={assignments.clientIds}
                  emptyMessage={t('hr:workforce.noClientsFound')}
                  onSearchChange={(value) => dispatch({ type: 'setClientSearch', value })}
                  onToggle={(id) => toggleAssignment('client', id)}
                />
                <AssignmentColumn
                  title={t('hr:workforce.projects')}
                  count={assignments.projectIds.length}
                  searchLabel={t('hr:workforce.searchProjects')}
                  searchValue={projectSearch}
                  items={visibleProjectItems}
                  selectedIds={assignments.projectIds}
                  emptyMessage={t('hr:workforce.noProjectsFound')}
                  onSearchChange={(value) => dispatch({ type: 'setProjectSearch', value })}
                  onToggle={(id) => toggleAssignment('project', id)}
                />
                <AssignmentColumn
                  title={t('hr:workforce.tasks')}
                  count={assignments.taskIds.length}
                  searchLabel={t('hr:workforce.searchTasks')}
                  searchValue={taskSearch}
                  items={visibleTaskItems}
                  selectedIds={assignments.taskIds}
                  emptyMessage={t('hr:workforce.noTasksFound')}
                  onSearchChange={(value) => dispatch({ type: 'setTaskSearch', value })}
                  onToggle={(id) => toggleAssignment('task', id)}
                />
              </div>
            </>
          )}
        </div>

        <EmployeeAssignmentsFooter
          cancelLabel={t('common:buttons.cancel')}
          saveLabel={t('hr:workforce.saveAssignments')}
          isDirty={isDirty}
          loadFailed={loadFailed}
          onClose={onClose}
          onSave={saveAssignments}
        />
      </div>
    </Modal>
  );
};

export default EmployeeAssignmentsModal;
