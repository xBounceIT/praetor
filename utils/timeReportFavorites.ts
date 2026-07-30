import type { TimeReportDefinition, TimeReportOptions } from '../types';

type DateRange = Pick<TimeReportDefinition, 'fromDate' | 'toDate'>;
type FavoriteVisibility = {
  canSelectUsers: boolean;
  canViewCost: boolean;
  currentUserId: string;
};

const taskIdentity = (task: NonNullable<TimeReportDefinition['task']>) =>
  task.taskId ?? `legacy:${task.projectId}:${task.name.toLowerCase()}`;

export const sanitizeTimeReportFavorite = (
  saved: TimeReportDefinition,
  options: TimeReportOptions,
  visibility: FavoriteVisibility,
): TimeReportDefinition => {
  const visibleUserIds = new Set(options.users.map((item) => item.id));
  const visibleClientIds = new Set(options.clients.map((item) => item.id));
  const clientId = saved.clientId && visibleClientIds.has(saved.clientId) ? saved.clientId : null;
  const eligibleProjectIds = new Set<string>();
  for (const project of options.projects) {
    if (clientId === null || project.clientId === clientId) {
      eligibleProjectIds.add(project.id);
    }
  }
  const projectIds = saved.projectIds.filter((id) => eligibleProjectIds.has(id)).slice(0, 1);
  const selectedProjectIds = new Set(projectIds);
  const visibleTasks = new Set<string>();
  for (const task of options.tasks) {
    if (
      eligibleProjectIds.has(task.projectId) &&
      (selectedProjectIds.size === 0 || selectedProjectIds.has(task.projectId))
    ) {
      visibleTasks.add(taskIdentity(task));
    }
  }
  const selectedUsers = visibility.canSelectUsers
    ? saved.userIds.filter((id) => visibleUserIds.has(id))
    : [visibility.currentUserId];
  const groupBy = saved.groupBy.slice(0, 3);

  return {
    ...saved,
    userIds:
      selectedUsers.length > 0 && selectedUsers.some(Boolean)
        ? selectedUsers
        : [visibility.currentUserId],
    clientId,
    projectIds,
    task: saved.task && visibleTasks.has(taskIdentity(saved.task)) ? saved.task : null,
    fields: saved.fields.filter((field) => field !== 'cost' || visibility.canViewCost),
    groupBy,
    totalsOnly: groupBy.length > 0 && saved.totalsOnly,
  };
};

export const finalizeTimeReportFavorite = (
  saved: TimeReportDefinition,
  sanitized: TimeReportDefinition,
  relativeDateRange: DateRange | null,
): { definition: TimeReportDefinition; wasSanitized: boolean } => ({
  definition: relativeDateRange ? { ...sanitized, ...relativeDateRange } : sanitized,
  // Relative dates are expected to move. Only permission/visibility changes should warn.
  wasSanitized: JSON.stringify(saved) !== JSON.stringify(sanitized),
});
