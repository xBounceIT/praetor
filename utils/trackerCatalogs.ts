import type { Client, Project, ProjectTask } from '../types';
import { isDateOnlyBeforeToday } from './date';
import { hasPermission } from './permissions';

export type TrackerCatalogState = {
  userId: string;
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

export const isProjectStatusBlockedForTimeEntries = (project: Pick<Project, 'status'>): boolean =>
  project.status === 'in_pausa' || project.status === 'terminato';

export const filterTrackerEntrySelectableCatalogs = ({
  clients,
  projects,
  projectTasks,
  permissions,
}: TrackerCatalogs & { permissions: string[] }): TrackerCatalogs => {
  const canUseExpiredProjects = hasPermission(permissions, EXPIRED_PROJECT_TIME_ENTRY_PERMISSION);
  const selectableProjects = projects.filter((project) => {
    if (isProjectStatusBlockedForTimeEntries(project)) return false;
    return canUseExpiredProjects || !isProjectExpiredForTimeEntries(project);
  });
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
  catalogState,
}: TrackerCatalogs & {
  currentUserId: string;
  viewingUserId: string;
  catalogState: TrackerCatalogState;
}): TrackerCatalogs => {
  if (viewingUserId === currentUserId) {
    return activeOnly({ clients, projects, projectTasks });
  }

  const isCurrentTarget = catalogState.userId === viewingUserId && !catalogState.isLoading;
  const targetCatalogs = isCurrentTarget ? catalogState.catalogs : null;

  if (!targetCatalogs) {
    return { clients: [], projects: [], projectTasks: [] };
  }

  return activeOnly(targetCatalogs);
};
