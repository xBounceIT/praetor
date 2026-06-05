import type { Client, Project, ProjectTask } from '../types';
import { isDateOnlyBeforeToday } from './date';
import { hasPermission } from './permissions';

export type TrackerAssignments = {
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
};

export type TrackerAssignmentState = {
  userId: string;
  assignments: TrackerAssignments | null;
  catalogs: TrackerCatalogs | null;
  isLoading: boolean;
};

export type TrackerCatalogs = {
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
};

export const EXPIRED_PROJECT_TIME_ENTRY_PERMISSION = 'timesheets.expired_projects.create';

export const isProjectExpiredForTimeEntries = (project: Pick<Project, 'endDate'>): boolean =>
  !!project.endDate && isDateOnlyBeforeToday(project.endDate);

export const filterTrackerEntrySelectableCatalogs = ({
  clients,
  projects,
  projectTasks,
  permissions,
}: TrackerCatalogs & { permissions: string[] }): TrackerCatalogs => {
  if (hasPermission(permissions, EXPIRED_PROJECT_TIME_ENTRY_PERMISSION)) {
    return { clients, projects, projectTasks };
  }

  const selectableProjects = projects.filter((project) => !isProjectExpiredForTimeEntries(project));
  const selectableProjectIds = new Set(selectableProjects.map((project) => project.id));
  const selectableClientIds = new Set(selectableProjects.map((project) => project.clientId));

  return {
    clients: clients.filter((client) => selectableClientIds.has(client.id)),
    projects: selectableProjects,
    projectTasks: projectTasks.filter((task) => selectableProjectIds.has(task.projectId)),
  };
};

const activeOnly = ({ clients, projects, projectTasks }: TrackerCatalogs): TrackerCatalogs => {
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

  return {
    clients: activeClients,
    projects: activeProjects,
    projectTasks: activeTasks,
  };
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
  if (viewingUserId === currentUserId) {
    return activeOnly({ clients, projects, projectTasks });
  }

  const isCurrentTarget = assignmentState.userId === viewingUserId && !assignmentState.isLoading;
  const assignments = isCurrentTarget ? assignmentState.assignments : null;
  const targetCatalogs = isCurrentTarget ? assignmentState.catalogs : null;

  if (!assignments || !targetCatalogs) {
    return { clients: [], projects: [], projectTasks: [] };
  }

  const activeTargetCatalogs = activeOnly(targetCatalogs);
  const assignedClientIds = new Set(assignments.clientIds);
  const assignedProjectIds = new Set(assignments.projectIds);
  const assignedTaskIds = new Set(assignments.taskIds);

  return {
    clients: activeTargetCatalogs.clients.filter((client) => assignedClientIds.has(client.id)),
    projects: activeTargetCatalogs.projects.filter((project) => assignedProjectIds.has(project.id)),
    projectTasks: activeTargetCatalogs.projectTasks.filter((task) => assignedTaskIds.has(task.id)),
  };
};
