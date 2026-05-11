import type { TimeEntry } from '../repositories/entriesRepo.ts';
import * as entriesRepo from '../repositories/entriesRepo.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import { todayLocalDateOnly } from '../utils/date.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { hasScopedActionPermission } from '../utils/permissions.ts';
import {
  isWeekendDate,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseBoolean,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseQueryBoolean,
  requireNonEmptyString,
} from '../utils/validation.ts';

export type AuthenticatedActor = {
  id: string;
  permissions: string[];
};

export class TimeEntryServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'TimeEntryServiceError';
  }
}

const hasPermission = (actor: AuthenticatedActor, permission: string) =>
  actor.permissions.includes(permission);

const hasTrackerPermission = (
  actor: AuthenticatedActor,
  action: 'view' | 'create' | 'update' | 'delete',
) => hasScopedActionPermission(actor.permissions, 'timesheets.tracker', action);

const fail = (statusCode: number, message: string): never => {
  throw new TimeEntryServiceError(statusCode, message);
};

const badRequest = (message: string): never => fail(400, message);

const requireValid = <T>(result: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (result.ok) return result.value;
  return badRequest(result.message);
};

export const listTimeEntries = async (
  actor: AuthenticatedActor,
  input: { userId?: unknown; limit?: unknown; cursor?: unknown },
): Promise<{ entries: TimeEntry[]; nextCursor: string | null }> => {
  if (!hasTrackerPermission(actor, 'view')) fail(403, 'Insufficient permissions');

  const userId = typeof input.userId === 'string' ? input.userId : undefined;
  const limit =
    input.limit === undefined || typeof input.limit === 'number'
      ? input.limit
      : Number.parseInt(String(input.limit), 10);
  const cursor = typeof input.cursor === 'string' ? input.cursor : undefined;

  const canViewAll = hasPermission(actor, 'timesheets.tracker_all.view');
  if (!canViewAll && userId && userId !== actor.id) {
    const allowed = await workUnitsRepo.isUserManagedBy(actor.id, userId);
    if (!allowed) fail(403, 'Not authorized to view entries for this user');
  }

  const decodedCursor = cursor ? entriesRepo.decodeCursor(cursor) : undefined;
  if (cursor && !decodedCursor) badRequest('cursor is invalid');

  const options = { limit, cursor: decodedCursor ?? undefined };
  const result = userId
    ? await entriesRepo.listForUser(userId, options)
    : canViewAll
      ? await entriesRepo.listAll(options)
      : await entriesRepo.listForManagerView(actor.id, options);

  return {
    entries: result.entries,
    nextCursor: result.nextCursor ? entriesRepo.encodeCursor(result.nextCursor) : null,
  };
};

export const createTimeEntry = async (
  actor: AuthenticatedActor,
  input: {
    date?: unknown;
    clientId?: unknown;
    clientName?: unknown;
    projectId?: unknown;
    projectName?: unknown;
    task?: unknown;
    notes?: unknown;
    duration?: unknown;
    isPlaceholder?: unknown;
    userId?: unknown;
    location?: unknown;
  },
): Promise<TimeEntry> => {
  if (!hasTrackerPermission(actor, 'create')) fail(403, 'Insufficient permissions');

  const date = requireValid(parseDateString(input.date, 'date'));

  if (isWeekendDate(date)) {
    const settings = await generalSettingsRepo.get();
    if (!(settings?.allowWeekendSelection ?? true)) {
      badRequest('Time entries on weekends are not allowed');
    }
  }

  const clientId = requireValid(requireNonEmptyString(input.clientId, 'clientId'));
  const clientName = requireValid(requireNonEmptyString(input.clientName, 'clientName'));
  const projectId = requireValid(requireNonEmptyString(input.projectId, 'projectId'));
  const projectName = requireValid(requireNonEmptyString(input.projectName, 'projectName'));
  const task = requireValid(requireNonEmptyString(input.task, 'task'));
  const duration = requireValid(optionalLocalizedNonNegativeNumber(input.duration, 'duration'));

  let targetUserId = actor.id;
  if (input.userId) {
    targetUserId = requireValid(requireNonEmptyString(input.userId, 'userId'));

    if (targetUserId !== actor.id && !hasPermission(actor, 'timesheets.tracker_all.create')) {
      const allowed = await workUnitsRepo.isUserManagedBy(actor.id, targetUserId);
      if (!allowed) fail(403, 'Not authorized to create entries for this user');
    }
  }

  const hourlyCost = await usersRepo.findCostPerHour(targetUserId);
  const resolvedTaskId = await tasksRepo.findIdByProjectAndName(projectId, task);
  const projectClientId = await projectsRepo.findClientId(projectId);
  if (projectClientId === null) badRequest('Project not found');
  if (projectClientId !== clientId) {
    badRequest('Project does not belong to the selected client');
  }

  if (!hasPermission(actor, 'timesheets.tracker_all.create')) {
    const [clientAllowed, projectAllowed, taskAllowed] = await Promise.all([
      userAssignmentsRepo.isClientAssignedToUser(targetUserId, clientId),
      userAssignmentsRepo.isProjectAssignedToUser(targetUserId, projectId),
      resolvedTaskId
        ? userAssignmentsRepo.isTaskAssignedToUser(targetUserId, resolvedTaskId)
        : Promise.resolve(true),
    ]);
    if (!clientAllowed || !projectAllowed || !taskAllowed) {
      fail(403, 'Not authorized to create entries for this client, project, or task');
    }
  }

  const location =
    typeof input.location === 'string' && input.location.trim() ? input.location : 'remote';

  return entriesRepo.create({
    id: generatePrefixedId('te'),
    userId: targetUserId,
    date,
    clientId,
    clientName,
    projectId,
    projectName,
    task,
    taskId: resolvedTaskId,
    notes: typeof input.notes === 'string' ? input.notes : null,
    duration: duration ?? 0,
    hourlyCost,
    isPlaceholder: parseBoolean(input.isPlaceholder),
    location,
  });
};

export const updateTimeEntry = async (
  actor: AuthenticatedActor,
  id: unknown,
  input: { duration?: unknown; notes?: unknown; isPlaceholder?: unknown; location?: unknown },
): Promise<TimeEntry> => {
  if (!hasTrackerPermission(actor, 'update')) fail(403, 'Insufficient permissions');
  const entryId = requireValid(requireNonEmptyString(id, 'id'));

  let parsedDuration: number | undefined;
  if (input.duration !== undefined) {
    parsedDuration = requireValid(parseLocalizedNonNegativeNumber(input.duration, 'duration'));
  }

  let validatedNotes: string | null | undefined;
  if (input.notes !== undefined) {
    validatedNotes = requireValid(optionalNonEmptyString(input.notes, 'notes'));
  }

  const context = await entriesRepo.findContext(entryId);
  if (context === null) return fail(404, 'Entry not found');

  if (context.userId !== actor.id && !hasPermission(actor, 'timesheets.tracker_all.update')) {
    const allowed = await workUnitsRepo.isUserManagedBy(actor.id, context.userId);
    if (!allowed) fail(403, 'Not authorized to update this entry');
  }

  let backfilledTaskId: string | undefined;
  if (context.taskId === null) {
    backfilledTaskId =
      (await tasksRepo.findIdByProjectAndName(context.projectId, context.task)) ?? undefined;
  }

  const updated = await entriesRepo.update(entryId, {
    duration: parsedDuration,
    notes: validatedNotes,
    isPlaceholder:
      input.isPlaceholder === undefined ? undefined : parseBoolean(input.isPlaceholder),
    location: typeof input.location === 'string' ? input.location : undefined,
    taskId: backfilledTaskId,
  });

  if (updated === null) return fail(404, 'Entry not found');
  return updated;
};

export const deleteTimeEntry = async (
  actor: AuthenticatedActor,
  id: unknown,
): Promise<{ message: string }> => {
  if (!hasTrackerPermission(actor, 'delete')) fail(403, 'Insufficient permissions');
  const entryId = requireValid(requireNonEmptyString(id, 'id'));

  const ownerId = await entriesRepo.findOwner(entryId);
  if (ownerId === null) return fail(404, 'Entry not found');
  if (ownerId !== actor.id && !hasPermission(actor, 'timesheets.tracker_all.delete')) {
    const allowed = await workUnitsRepo.isUserManagedBy(actor.id, ownerId);
    if (!allowed) fail(403, 'Not authorized to delete this entry');
  }

  await entriesRepo.deleteById(entryId);
  return { message: 'Entry deleted' };
};

export const bulkDeleteTimeEntries = async (
  actor: AuthenticatedActor,
  input: { projectId?: unknown; task?: unknown; futureOnly?: unknown; placeholderOnly?: unknown },
): Promise<{ message: string }> => {
  if (
    !hasTrackerPermission(actor, 'delete') &&
    !hasPermission(actor, 'timesheets.recurring.delete')
  ) {
    fail(403, 'Insufficient permissions');
  }

  const projectId = requireValid(requireNonEmptyString(input.projectId, 'projectId'));
  const task = requireValid(requireNonEmptyString(input.task, 'task'));

  const futureOnlyValue = parseQueryBoolean(input.futureOnly) ?? false;
  const placeholderOnlyValue = parseQueryBoolean(input.placeholderOnly) ?? false;
  const restrictToManagerScopeOf = hasPermission(actor, 'timesheets.tracker_all.delete')
    ? undefined
    : actor.id;

  const deleted = await entriesRepo.bulkDelete({
    projectId,
    task,
    restrictToManagerScopeOf,
    fromDate: futureOnlyValue ? todayLocalDateOnly() : undefined,
    placeholderOnly: placeholderOnlyValue,
  });

  return { message: `Deleted ${deleted} entries` };
};
