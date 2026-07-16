import { describe, expect, test } from 'bun:test';
import type { Client, Project, ProjectTask } from '../../types';
import {
  EXPIRED_PROJECT_TIME_ENTRY_PERMISSION,
  filterTrackerCatalogs,
  filterTrackerEntrySelectableCatalogs,
  isProjectExpiredForTimeEntries,
  isProjectStatusBlockedForTimeEntries,
  type TrackerCatalogState,
} from '../../utils/trackerCatalogs';

const clients: Client[] = [
  { id: 'client-a', name: 'Client A' },
  { id: 'client-b', name: 'Client B' },
  { id: 'client-disabled', name: 'Disabled Client', isDisabled: true },
];

const projects: Project[] = [
  { id: 'project-a', name: 'Project A', clientId: 'client-a' },
  { id: 'project-b', name: 'Project B', clientId: 'client-b' },
  {
    id: 'project-disabled',
    name: 'Disabled Project',
    clientId: 'client-a',
    isDisabled: true,
  },
  {
    id: 'project-disabled-client',
    name: 'Project Disabled Client',
    clientId: 'client-disabled',
  },
];

const projectTasks: ProjectTask[] = [
  { id: 'task-a', name: 'Task A', projectId: 'project-a' },
  { id: 'task-b', name: 'Task B', projectId: 'project-b' },
  { id: 'task-disabled', name: 'Disabled Task', projectId: 'project-a', isDisabled: true },
  { id: 'task-disabled-project', name: 'Task Disabled Project', projectId: 'project-disabled' },
];

const expiredProject: Project = {
  id: 'project-expired',
  name: 'Expired Project',
  clientId: 'client-a',
  endDate: '2000-01-01',
};

const expiredProjectTask: ProjectTask = {
  id: 'task-expired',
  name: 'Expired Task',
  projectId: 'project-expired',
};

const pausedProject: Project = {
  id: 'project-paused',
  name: 'Paused Project',
  clientId: 'client-a',
  status: 'in_pausa',
};

const terminatedProject: Project = {
  id: 'project-terminated',
  name: 'Terminated Project',
  clientId: 'client-b',
  status: 'terminato',
};

const pausedProjectTask: ProjectTask = {
  id: 'task-paused',
  name: 'Paused Task',
  projectId: 'project-paused',
};

const terminatedProjectTask: ProjectTask = {
  id: 'task-terminated',
  name: 'Terminated Task',
  projectId: 'project-terminated',
};
const loadingState: TrackerCatalogState = {
  userId: 'user-b',
  catalogs: null,
  isLoading: true,
};

describe('filterTrackerCatalogs', () => {
  test('viewing self returns active catalogs', () => {
    const result = filterTrackerCatalogs({
      clients,
      projects,
      projectTasks,
      currentUserId: 'user-a',
      viewingUserId: 'user-a',
      catalogState: loadingState,
    });

    expect(result.clients.map((client) => client.id)).toEqual(['client-a', 'client-b']);
    expect(result.projects.map((project) => project.id)).toEqual(['project-a', 'project-b']);
    expect(result.projectTasks.map((task) => task.id)).toEqual(['task-a', 'task-b']);
  });

  test('viewing another user returns only assigned active catalogs', () => {
    const result = filterTrackerCatalogs({
      clients,
      projects,
      projectTasks,
      currentUserId: 'user-a',
      viewingUserId: 'user-b',
      catalogState: {
        userId: 'user-b',
        catalogs: {
          clients: [clients[1], clients[2]],
          projects: [projects[1], projects[3]],
          projectTasks: [projectTasks[1], projectTasks[3]],
        },
        isLoading: false,
      },
    });

    expect(result.clients.map((client) => client.id)).toEqual(['client-b']);
    expect(result.projects.map((project) => project.id)).toEqual(['project-b']);
    expect(result.projectTasks.map((task) => task.id)).toEqual(['task-b']);
  });

  test('viewing another user while catalogs load returns empty catalogs', () => {
    const result = filterTrackerCatalogs({
      clients,
      projects,
      projectTasks,
      currentUserId: 'user-a',
      viewingUserId: 'user-b',
      catalogState: loadingState,
    });

    expect(result).toEqual({ clients: [], projects: [], projectTasks: [] });
  });

  test('ignores stale catalog state for a previously selected user', () => {
    const result = filterTrackerCatalogs({
      clients,
      projects,
      projectTasks,
      currentUserId: 'user-a',
      viewingUserId: 'user-c',
      catalogState: {
        userId: 'user-b',
        catalogs: {
          clients,
          projects,
          projectTasks,
        },
        isLoading: false,
      },
    });

    expect(result).toEqual({ clients: [], projects: [], projectTasks: [] });
  });

  test('viewing another user can show tasks missing from the acting user catalog', () => {
    const result = filterTrackerCatalogs({
      clients: [clients[0]],
      projects: [projects[0]],
      projectTasks: [projectTasks[0]],
      currentUserId: 'manager-user',
      viewingUserId: 'test-user',
      catalogState: {
        userId: 'test-user',
        catalogs: {
          clients: [clients[1]],
          projects: [projects[1]],
          projectTasks: [projectTasks[1]],
        },
        isLoading: false,
      },
    });

    expect(result.clients.map((client) => client.id)).toEqual(['client-b']);
    expect(result.projects.map((project) => project.id)).toEqual(['project-b']);
    expect(result.projectTasks.map((task) => task.id)).toEqual(['task-b']);
  });
});

describe('filterTrackerEntrySelectableCatalogs', () => {
  test('detects project expiry from endDate before today', () => {
    expect(isProjectExpiredForTimeEntries({ endDate: '2000-01-01' })).toBe(true);
    expect(isProjectExpiredForTimeEntries({ endDate: '2999-01-01' })).toBe(false);
    expect(isProjectExpiredForTimeEntries({ endDate: null })).toBe(false);
  });

  test('detects project status blocks for time entries', () => {
    expect(isProjectStatusBlockedForTimeEntries(pausedProject)).toBe(true);
    expect(isProjectStatusBlockedForTimeEntries(terminatedProject)).toBe(true);
    expect(isProjectStatusBlockedForTimeEntries(projects[0])).toBe(false);
  });
  test('removes expired projects and their tasks without the override permission', () => {
    const result = filterTrackerEntrySelectableCatalogs({
      clients,
      projects: [...projects, expiredProject],
      projectTasks: [...projectTasks, expiredProjectTask],
      permissions: [],
    });

    expect(result.projects.map((project) => project.id)).not.toContain('project-expired');
    expect(result.projectTasks.map((task) => task.id)).not.toContain('task-expired');
  });

  test('removes paused and terminated projects even with the expired override permission', () => {
    const result = filterTrackerEntrySelectableCatalogs({
      clients,
      projects: [...projects, expiredProject, pausedProject, terminatedProject],
      projectTasks: [...projectTasks, expiredProjectTask, pausedProjectTask, terminatedProjectTask],
      permissions: [EXPIRED_PROJECT_TIME_ENTRY_PERMISSION],
    });

    expect(result.projects.map((project) => project.id)).toContain('project-expired');
    expect(result.projects.map((project) => project.id)).not.toContain('project-paused');
    expect(result.projects.map((project) => project.id)).not.toContain('project-terminated');
    expect(result.projectTasks.map((task) => task.id)).toContain('task-expired');
    expect(result.projectTasks.map((task) => task.id)).not.toContain('task-paused');
    expect(result.projectTasks.map((task) => task.id)).not.toContain('task-terminated');
  });
  test('keeps expired projects with the override permission', () => {
    const result = filterTrackerEntrySelectableCatalogs({
      clients,
      projects: [...projects, expiredProject],
      projectTasks: [...projectTasks, expiredProjectTask],
      permissions: [EXPIRED_PROJECT_TIME_ENTRY_PERMISSION],
    });

    expect(result.projects.map((project) => project.id)).toContain('project-expired');
    expect(result.projectTasks.map((task) => task.id)).toContain('task-expired');
  });
});
