import { withDbTransaction } from '../db/drizzle.ts';
import type { TimeEntry } from '../repositories/entriesRepo.ts';
import * as entriesRepo from '../repositories/entriesRepo.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import { formatLocalDateOnly, parseLocalDateOnly, todayLocalDateOnly } from '../utils/date.ts';
import { isItalianHoliday } from '../utils/holidays.ts';
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

// Mirrors the DB check constraint on time_entries.location. Also reused by
// `PUT /api/general-settings` to validate the `defaultLocation` field.
export const VALID_LOCATIONS = ['remote', 'office', 'customer_premise', 'transfer'] as const;
type ValidLocation = (typeof VALID_LOCATIONS)[number];

const parseOptionalLocation = (
  value: unknown,
  fail: (status: number, message: string) => never,
): ValidLocation | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (!(VALID_LOCATIONS as readonly string[]).includes(value)) {
    fail(400, `Invalid location: ${value}`);
  }
  return value as ValidLocation;
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

  const location = parseOptionalLocation(input.location, fail) ?? 'remote';

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
    location: parseOptionalLocation(input.location, fail),
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

// Recurring time-entry generation. Supported patterns:
//   - 'daily'                : every weekday in the window
//   - 'weekly'               : same weekday as `recurrence_start`
//   - 'monthly'              : same day-of-month as `recurrence_start`
//   - 'monthly:<nth>:<dow>'  : Nth (first/second/third/fourth/last) weekday of the month;
//                              `dow` is 0=Sun..6=Sat (matches JS `Date.getDay()`)
//
// Sundays, configured Saturdays, Italian holidays, and days outside the template's
// `[recurrence_start, recurrence_end]` window are skipped. Existing entries (date +
// projectId + task name) are skipped, so re-running is idempotent.

const recurrenceMatches = (day: Date, pattern: string, start: Date): boolean => {
  if (pattern === 'daily') return true;
  if (pattern === 'weekly') return day.getDay() === start.getDay();
  if (pattern === 'monthly') return day.getDate() === start.getDate();
  if (pattern.startsWith('monthly:')) {
    const parts = pattern.split(':');
    if (parts.length !== 3) return false;
    const occurrence = parts[1];
    const targetDow = Number.parseInt(parts[2], 10);
    if (!Number.isInteger(targetDow) || day.getDay() !== targetDow) return false;
    const dom = day.getDate();
    switch (occurrence) {
      case 'first':
        return dom <= 7;
      case 'second':
        return dom > 7 && dom <= 14;
      case 'third':
        return dom > 14 && dom <= 21;
      case 'fourth':
        return dom > 21 && dom <= 28;
      case 'last': {
        const nextWeek = new Date(day);
        nextWeek.setDate(day.getDate() + 7);
        return nextWeek.getMonth() !== day.getMonth();
      }
      default:
        return false;
    }
  }
  return false;
};

export type GenerateRecurringInput = {
  fromDate?: unknown;
  toDate?: unknown;
  userId?: unknown;
};

export type GenerateRecurringResult = {
  generated: TimeEntry[];
  generatedCount: number;
  skippedExistingCount: number;
  range: { fromDate: string; toDate: string };
};

const MAX_RECURRING_DAYS = 366;

export const generateRecurringEntries = async (
  actor: AuthenticatedActor,
  input: GenerateRecurringInput,
): Promise<GenerateRecurringResult> => {
  if (!hasPermission(actor, 'timesheets.recurring.create')) {
    fail(403, 'Insufficient permissions');
  }

  const fromDate = requireValid(parseDateString(input.fromDate, 'fromDate'));
  const toDate = requireValid(parseDateString(input.toDate, 'toDate'));
  if (fromDate > toDate) badRequest('fromDate must be on or before toDate');

  const fromLocal = parseLocalDateOnly(fromDate);
  const toLocal = parseLocalDateOnly(toDate);
  const windowDays =
    Math.round((toLocal.getTime() - fromLocal.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (windowDays > MAX_RECURRING_DAYS) {
    badRequest(`Date range too large (max ${MAX_RECURRING_DAYS} days)`);
  }

  const providedUserId = requireValid(optionalNonEmptyString(input.userId, 'userId'));
  let targetUserId = actor.id;
  if (providedUserId) {
    targetUserId = providedUserId;
    if (targetUserId !== actor.id && !hasPermission(actor, 'timesheets.tracker_all.create')) {
      const allowed = await workUnitsRepo.isUserManagedBy(actor.id, targetUserId);
      if (!allowed) fail(403, 'Not authorized to generate entries for this user');
    }
  }

  const [recurringTasks, settings, hourlyCost, existingKeys] = await Promise.all([
    tasksRepo.listRecurringForUser(targetUserId),
    generalSettingsRepo.get(),
    usersRepo.findCostPerHour(targetUserId),
    entriesRepo.findExistingRecurringKeys(targetUserId, fromDate, toDate),
  ]);
  if (recurringTasks.length === 0) {
    return {
      generated: [],
      generatedCount: 0,
      skippedExistingCount: 0,
      range: { fromDate, toDate },
    };
  }

  const treatSaturdayAsHoliday = settings?.treatSaturdayAsHoliday ?? true;

  const uniqueProjectIds = Array.from(new Set(recurringTasks.map((t) => t.projectId)));
  const projectsByProjectId = await projectsRepo.listNamesByIds(uniqueProjectIds);

  // `listRecurringForUser` already gates on `user_tasks`, but a stale `user_tasks` row can
  // outlive a revoked client/project assignment. Re-apply the same per-row checks
  // `createTimeEntry` runs so the recurring path can't escape an assignment downgrade.
  let allowedTasks = recurringTasks;
  if (!hasPermission(actor, 'timesheets.tracker_all.create')) {
    const uniqueClientIds = Array.from(
      new Set(
        recurringTasks
          .map((t) => projectsByProjectId.get(t.projectId)?.clientId)
          .filter((id): id is string => id !== undefined),
      ),
    );
    const [assignedClients, assignedProjects, assignedTasks] = await Promise.all([
      userAssignmentsRepo.filterAssignedClientIds(targetUserId, uniqueClientIds),
      userAssignmentsRepo.filterAssignedProjectIds(targetUserId, uniqueProjectIds),
      userAssignmentsRepo.filterAssignedTaskIds(
        targetUserId,
        recurringTasks.map((t) => t.id),
      ),
    ]);
    allowedTasks = recurringTasks.filter((t) => {
      const clientId = projectsByProjectId.get(t.projectId)?.clientId;
      return (
        clientId !== undefined &&
        assignedClients.has(clientId) &&
        assignedProjects.has(t.projectId) &&
        assignedTasks.has(t.id)
      );
    });
  }
  if (allowedTasks.length === 0) {
    return {
      generated: [],
      generatedCount: 0,
      skippedExistingCount: 0,
      range: { fromDate, toDate },
    };
  }

  type PendingEntry = ReturnType<typeof buildPendingEntry>;
  const buildPendingEntry = (
    task: (typeof allowedTasks)[number],
    project: NonNullable<ReturnType<typeof projectsByProjectId.get>>,
    dateStr: string,
  ) => ({
    id: generatePrefixedId('te'),
    userId: targetUserId,
    date: dateStr,
    clientId: project.clientId,
    clientName: project.clientName,
    projectId: task.projectId,
    projectName: project.projectName,
    task: task.name,
    taskId: task.id,
    notes: null,
    duration: task.recurrenceDuration ?? 0,
    hourlyCost,
    isPlaceholder: true,
    location: settings?.defaultLocation ?? 'remote',
  });

  const pending: PendingEntry[] = [];
  let skippedExistingCount = 0;
  // Track keys staged in this run so two recurring templates with the same (date, projectId,
  // task) tuple don't insert duplicate rows in a single generation pass.
  const stagedKeys = new Set<string>();

  for (const task of allowedTasks) {
    if (!task.recurrencePattern) continue;
    const project = projectsByProjectId.get(task.projectId);
    if (!project) continue;

    const templateStart = task.recurrenceStart
      ? parseLocalDateOnly(task.recurrenceStart)
      : fromLocal;
    const templateEnd = task.recurrenceEnd ? parseLocalDateOnly(task.recurrenceEnd) : null;

    const iterStart = templateStart > fromLocal ? templateStart : fromLocal;
    const iterEnd = templateEnd && templateEnd < toLocal ? templateEnd : toLocal;
    if (iterStart > iterEnd) continue;

    for (
      let cursor = new Date(iterStart);
      cursor <= iterEnd;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const dow = cursor.getDay();
      if (dow === 0) continue;
      if (dow === 6 && treatSaturdayAsHoliday) continue;
      if (isItalianHoliday(cursor)) continue;
      if (!recurrenceMatches(cursor, task.recurrencePattern, templateStart)) continue;

      const dateStr = formatLocalDateOnly(cursor);
      const key = `${dateStr}|${task.projectId}|${task.name}`;
      if (existingKeys.has(key)) {
        skippedExistingCount += 1;
        continue;
      }
      if (stagedKeys.has(key)) continue;
      stagedKeys.add(key);
      pending.push(buildPendingEntry(task, project, dateStr));
    }
  }

  if (pending.length === 0) {
    return {
      generated: [],
      generatedCount: 0,
      skippedExistingCount,
      range: { fromDate, toDate },
    };
  }

  const inserted = await withDbTransaction((tx) => entriesRepo.createMany(pending, tx));
  return {
    generated: inserted,
    generatedCount: inserted.length,
    skippedExistingCount,
    range: { fromDate, toDate },
  };
};

export const bulkDeleteTimeEntries = async (
  actor: AuthenticatedActor,
  input: { projectId?: unknown; task?: unknown; futureOnly?: unknown; placeholderOnly?: unknown },
): Promise<{ message: string }> => {
  const canDeleteTrackerEntries = hasTrackerPermission(actor, 'delete');
  const canDeleteRecurringEntries = hasPermission(actor, 'timesheets.recurring.delete');

  if (!canDeleteTrackerEntries && !canDeleteRecurringEntries) {
    fail(403, 'Insufficient permissions');
  }

  const projectId = requireValid(requireNonEmptyString(input.projectId, 'projectId'));
  const task = requireValid(requireNonEmptyString(input.task, 'task'));

  const futureOnlyValue = parseQueryBoolean(input.futureOnly) ?? false;
  const requestedPlaceholderOnly = parseQueryBoolean(input.placeholderOnly) ?? false;
  const placeholderOnlyValue = canDeleteTrackerEntries ? requestedPlaceholderOnly : true;
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
