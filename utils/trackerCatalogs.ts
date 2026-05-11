import type { Client, Project, ProjectTask } from '../types';

export type TrackerAssignments = {
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
};

export type TrackerAssignmentState = {
  userId: string;
  assignments: TrackerAssignments | null;
  isLoading: boolean;
};

export type TrackerCatalogs = {
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
};

export const filterTrackerCatalogs = ({
  clients,
  projects,
  projectTasks,
  currentUserId,
  viewingUserId,
  assignmentState,
}: TrackerCatalogs & {
  currentUserId: string;
  viewingUserId: string;
  assignmentState: TrackerAssignmentState;
}): TrackerCatalogs => {
  const activeClients = clients.filter((client) => !client.isDisabled);
  const activeClientIds = new Set(activeClients.map((client) => client.id));

  const activeProjects = projects.filter((project) => {
    if (project.isDisabled) return false;
    return activeClientIds.has(project.clientId);
  });
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));

  const activeTasks = projectTasks.filter((task) => {
    if (task.isDisabled) return false;
    return activeProjectIds.has(task.projectId);
  });

  if (viewingUserId === currentUserId) {
    return {
      clients: activeClients,
      projects: activeProjects,
      projectTasks: activeTasks,
    };
  }

  const assignments =
    assignmentState.userId === viewingUserId && !assignmentState.isLoading
      ? assignmentState.assignments
      : null;

  if (!assignments) {
    return { clients: [], projects: [], projectTasks: [] };
  }

  const assignedClientIds = new Set(assignments.clientIds);
  const assignedProjectIds = new Set(assignments.projectIds);
  const assignedTaskIds = new Set(assignments.taskIds);

  return {
    clients: activeClients.filter((client) => assignedClientIds.has(client.id)),
    projects: activeProjects.filter((project) => assignedProjectIds.has(project.id)),
    projectTasks: activeTasks.filter((task) => assignedTaskIds.has(task.id)),
  };
};
