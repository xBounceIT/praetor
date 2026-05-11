import { describe, expect, test } from 'bun:test';
import type { Client, Project, ProjectTask } from '../../types';
import { filterTrackerCatalogs, type TrackerAssignmentState } from '../../utils/trackerCatalogs';

const clients: Client[] = [
  { id: 'client-a', name: 'Client A' },
  { id: 'client-b', name: 'Client B' },
  { id: 'client-disabled', name: 'Disabled Client', isDisabled: true },
];

const projects: Project[] = [
  { id: 'project-a', name: 'Project A', clientId: 'client-a', color: '#111111' },
  { id: 'project-b', name: 'Project B', clientId: 'client-b', color: '#222222' },
  {
    id: 'project-disabled',
    name: 'Disabled Project',
    clientId: 'client-a',
    color: '#333333',
    isDisabled: true,
  },
  {
    id: 'project-disabled-client',
    name: 'Project Disabled Client',
    clientId: 'client-disabled',
    color: '#444444',
  },
];

const projectTasks: ProjectTask[] = [
  { id: 'task-a', name: 'Task A', projectId: 'project-a' },
  { id: 'task-b', name: 'Task B', projectId: 'project-b' },
  { id: 'task-disabled', name: 'Disabled Task', projectId: 'project-a', isDisabled: true },
  { id: 'task-disabled-project', name: 'Task Disabled Project', projectId: 'project-disabled' },
];

const loadingState: TrackerAssignmentState = {
  userId: 'user-b',
  assignments: null,
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
      assignmentState: loadingState,
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
      assignmentState: {
        userId: 'user-b',
        assignments: {
          clientIds: ['client-b', 'client-disabled'],
          projectIds: ['project-b', 'project-disabled-client'],
          taskIds: ['task-b', 'task-disabled'],
        },
        catalogs: {
          clients,
          projects,
          projectTasks,
        },
        isLoading: false,
      },
    });

    expect(result.clients.map((client) => client.id)).toEqual(['client-b']);
    expect(result.projects.map((project) => project.id)).toEqual(['project-b']);
    expect(result.projectTasks.map((task) => task.id)).toEqual(['task-b']);
  });

  test('viewing another user while assignments load returns empty catalogs', () => {
    const result = filterTrackerCatalogs({
      clients,
      projects,
      projectTasks,
      currentUserId: 'user-a',
      viewingUserId: 'user-b',
      assignmentState: loadingState,
    });

    expect(result).toEqual({ clients: [], projects: [], projectTasks: [] });
  });

  test('ignores stale assignment state for a previously selected user', () => {
    const result = filterTrackerCatalogs({
      clients,
      projects,
      projectTasks,
      currentUserId: 'user-a',
      viewingUserId: 'user-c',
      assignmentState: {
        userId: 'user-b',
        assignments: {
          clientIds: ['client-b'],
          projectIds: ['project-b'],
          taskIds: ['task-b'],
        },
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
      assignmentState: {
        userId: 'test-user',
        assignments: {
          clientIds: ['client-b'],
          projectIds: ['project-b'],
          taskIds: ['task-b'],
        },
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
