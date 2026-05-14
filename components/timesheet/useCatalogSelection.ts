import { useEffect, useMemo, useRef, useState } from 'react';
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

export function useCatalogSelection({
  clients,
  projects,
  projectTasks,
  defaultLocation = 'remote',
  initialSelection,
}: UseCatalogSelectionOptions): UseCatalogSelectionResult {
  const [clientId, setClientId] = useState(initialSelection?.clientId ?? clients[0]?.id ?? '');
  const [projectId, setProjectId] = useState(initialSelection?.projectId ?? '');
  const [taskId, setTaskId] = useState(initialSelection?.taskId ?? '');
  const [taskName, setTaskName] = useState(initialSelection?.taskName ?? '');
  const [location, setLocation] = useState<TimeEntryLocation>(defaultLocation);

  // When seeded (edit dialog), the seed must survive the first snap-to-first pass —
  // otherwise an entry whose task/project is no longer in the scoped catalog (orphan,
  // archived) would silently jump to the catalog's first row. One ref per field so
  // they consume independently.
  const skipProjectSnapRef = useRef(initialSelection?.projectId !== undefined);
  const skipTaskSnapRef = useRef(initialSelection?.taskId !== undefined);

  useEffect(() => {
    if (clients.length === 0) {
      if (clientId !== '') setClientId('');
      return;
    }
    if (!clients.some((client) => client.id === clientId)) {
      setClientId(clients[0].id);
    }
  }, [clients, clientId]);

  const filteredProjects = useMemo(
    () => projects.filter((project) => project.clientId === clientId),
    [projects, clientId],
  );
  const firstFilteredProjectId = filteredProjects[0]?.id ?? '';

  const filteredTasks = useMemo(
    () => projectTasks.filter((task) => task.projectId === projectId),
    [projectTasks, projectId],
  );
  const firstFilteredTaskId = filteredTasks[0]?.id ?? '';
  const firstFilteredTaskName = filteredTasks[0]?.name ?? '';

  useEffect(() => {
    const skipOnce = skipProjectSnapRef.current;
    skipProjectSnapRef.current = false;
    if (filteredProjects.length === 0) {
      if (skipOnce) return;
      if (projectId !== '') setProjectId('');
      return;
    }
    if (!filteredProjects.some((project) => project.id === projectId)) {
      if (skipOnce) return;
      setProjectId(firstFilteredProjectId);
    }
  }, [filteredProjects, firstFilteredProjectId, projectId]);

  useEffect(() => {
    const skipOnce = skipTaskSnapRef.current;
    skipTaskSnapRef.current = false;
    if (filteredTasks.length === 0) {
      if (skipOnce) return;
      setTaskId('');
      setTaskName('');
      return;
    }

    if (!filteredTasks.some((task) => task.id === taskId)) {
      if (skipOnce) return;
      setTaskName(firstFilteredTaskName);
      setTaskId(firstFilteredTaskId);
    }
  }, [filteredTasks, firstFilteredTaskId, firstFilteredTaskName, taskId]);

  useEffect(() => {
    if (clientId === '') {
      setProjectId('');
    }
  }, [clientId]);

  const setClient = (id: string) => {
    setClientId(id);
  };

  const setProject = (id: string) => {
    setProjectId(id);
  };

  // When `nextTaskName` is provided the assignment is direct — used after a
  // task is freshly created via a modal flow where `filteredTasks` may not
  // yet contain it. Otherwise the name is looked up from the scoped catalog.
  const setTask = (nextTaskId: string, nextTaskName?: string) => {
    if (nextTaskName !== undefined) {
      setTaskId(nextTaskId);
      setTaskName(nextTaskName);
      return;
    }
    const task = filteredTasks.find((t) => t.id === nextTaskId);
    if (task) {
      setTaskName(task.name);
      setTaskId(task.id);
    }
  };

  const resetLocation = () => {
    setLocation(defaultLocation);
  };

  return {
    clientId,
    projectId,
    taskId,
    taskName,
    location,
    filteredProjects,
    filteredTasks,
    setClient,
    setProject,
    setTask,
    setLocation,
    resetLocation,
  };
}
