import { useMemo, useReducer } from 'react';
import type { Client, Project, ProjectTask, TimeEntryLocation } from '../../types';

export const CUSTOM_TASK_SENTINEL = 'custom';

export interface UseCatalogSelectionOptions {
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  defaultLocation?: TimeEntryLocation;
  /**
   * Seed the initial selection (used by the edit dialog so the form opens on the entry's
   * existing client/project/task instead of the catalog's first row). Only read on mount.
   */
  initialSelection?: {
    clientId?: string;
    projectId?: string;
    taskId?: string;
    taskName?: string;
  };
}

export interface UseCatalogSelectionResult {
  clientId: string;
  projectId: string;
  taskId: string;
  taskName: string;
  location: TimeEntryLocation;
  filteredProjects: Project[];
  filteredTasks: ProjectTask[];
  setClient: (id: string) => void;
  setProject: (id: string) => void;
  setTask: (taskId: string, taskName?: string) => void;
  setLocation: (location: TimeEntryLocation) => void;
  resetLocation: () => void;
}

type CatalogSelectionState = {
  clientId: string;
  projectId: string;
  taskId: string;
  taskName: string;
  location: TimeEntryLocation;
  preserveMissingProject: boolean;
  preserveMissingTask: boolean;
};

type CatalogSelectionAction =
  | { type: 'setClient'; clientId: string }
  | { type: 'setProject'; projectId: string }
  | { type: 'setTask'; taskId: string; taskName: string }
  | { type: 'setLocation'; location: TimeEntryLocation }
  | { type: 'resetLocation'; location: TimeEntryLocation };

const catalogSelectionReducer = (
  state: CatalogSelectionState,
  action: CatalogSelectionAction,
): CatalogSelectionState => {
  switch (action.type) {
    case 'setClient':
      return {
        ...state,
        clientId: action.clientId,
        preserveMissingProject: false,
        preserveMissingTask: false,
      };
    case 'setProject':
      return {
        ...state,
        projectId: action.projectId,
        preserveMissingProject: false,
        preserveMissingTask: false,
      };
    case 'setTask':
      return {
        ...state,
        taskId: action.taskId,
        taskName: action.taskName,
        preserveMissingTask: false,
      };
    case 'setLocation':
    case 'resetLocation':
      return { ...state, location: action.location };
  }
};

const createInitialCatalogSelection = ({
  clients,
  defaultLocation,
  initialSelection,
}: Pick<UseCatalogSelectionOptions, 'clients' | 'defaultLocation' | 'initialSelection'> & {
  defaultLocation: TimeEntryLocation;
}): CatalogSelectionState => ({
  clientId: initialSelection?.clientId ?? clients[0]?.id ?? '',
  projectId: initialSelection?.projectId ?? '',
  taskId: initialSelection?.taskId ?? '',
  taskName: initialSelection?.taskName ?? '',
  location: defaultLocation,
  preserveMissingProject: initialSelection?.projectId !== undefined,
  preserveMissingTask: initialSelection?.taskId !== undefined,
});

export function useCatalogSelection({
  clients,
  projects,
  projectTasks,
  defaultLocation = 'remote',
  initialSelection,
}: UseCatalogSelectionOptions): UseCatalogSelectionResult {
  const [selection, dispatch] = useReducer(
    catalogSelectionReducer,
    { clients, defaultLocation, initialSelection },
    createInitialCatalogSelection,
  );

  const clientId =
    clients.length === 0
      ? ''
      : clients.some((client) => client.id === selection.clientId)
        ? selection.clientId
        : (clients[0]?.id ?? '');

  const filteredProjects = useMemo(
    () => projects.filter((project) => project.clientId === clientId),
    [projects, clientId],
  );
  const firstFilteredProjectId = filteredProjects[0]?.id ?? '';
  const projectId = filteredProjects.some((project) => project.id === selection.projectId)
    ? selection.projectId
    : selection.preserveMissingProject
      ? selection.projectId
      : firstFilteredProjectId;

  const filteredTasks = useMemo(
    () => projectTasks.filter((task) => task.projectId === projectId),
    [projectTasks, projectId],
  );
  const firstFilteredTaskId = filteredTasks[0]?.id ?? '';
  const firstFilteredTaskName = filteredTasks[0]?.name ?? '';
  const selectedTask = filteredTasks.find((task) => task.id === selection.taskId);
  const taskId = selectedTask
    ? selectedTask.id
    : selection.preserveMissingTask
      ? selection.taskId
      : firstFilteredTaskId;
  const taskName = selectedTask
    ? selectedTask.name
    : selection.preserveMissingTask
      ? selection.taskName
      : firstFilteredTaskName;

  const setClient = (id: string) => {
    dispatch({ type: 'setClient', clientId: id });
  };

  const setProject = (id: string) => {
    dispatch({ type: 'setProject', projectId: id });
  };

  // When `nextTaskName` is provided the assignment is direct — used after a
  // task is freshly created via a modal flow where `filteredTasks` may not
  // yet contain it. Otherwise the name is looked up from the scoped catalog.
  const setTask = (nextTaskId: string, nextTaskName?: string) => {
    if (nextTaskName !== undefined) {
      dispatch({ type: 'setTask', taskId: nextTaskId, taskName: nextTaskName });
      return;
    }
    const task = filteredTasks.find((t) => t.id === nextTaskId);
    if (task) {
      dispatch({ type: 'setTask', taskId: task.id, taskName: task.name });
    }
  };

  const resetLocation = () => {
    dispatch({ type: 'resetLocation', location: defaultLocation });
  };

  return {
    clientId,
    projectId,
    taskId,
    taskName,
    location: selection.location,
    filteredProjects,
    filteredTasks,
    setClient,
    setProject,
    setTask,
    setLocation: (location) => dispatch({ type: 'setLocation', location }),
    resetLocation,
  };
}
