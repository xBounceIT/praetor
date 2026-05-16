import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
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
  parseBooleanField,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseQueryBoolean,
  requireNonEmptyString,
} from '../utils/validation.ts';

// Cap matches the UI maxLength on the notes inputs (EntryEditDialog,
// WeeklyEntryForm). Bounded server-side so the API rejects oversize
// payloads even when the schema validator is bypassed (e.g., direct
// service calls from MCP tool handlers).
export const MAX_NOTES_LENGTH = 2000;

// A single tracker entry covers one calendar day, so 24h is the largest
// plausible duration. Anything above is either a typo or hostile input
// that would cascade into cost/billing aggregates.
export const MAX_DURATION_HOURS = 24;

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

const enforceDurationMax = (value: number): void => {
  if (value > MAX_DURATION_HOURS) {
    badRequest(`duration must be ${MAX_DURATION_HOURS} hours or fewer`);
  }
};

const parseOptionalNotes = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    return badRequest('notes must be a string');
  }
  if (value.length > MAX_NOTES_LENGTH) {
    return badRequest(`notes must be ${MAX_NOTES_LENGTH} characters or fewer`);
  }
  return value === '' ? null : value;
};

const parseExpectedVersion = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    badRequest('version must be a positive integer');
  }
  return value as number;
};

const SERIALIZATION_FAILURE_SQLSTATE = '40001';
const MAX_SERIALIZABLE_WRITE_ATTEMPTS = 3;

const getDbErrorCode = (err: unknown, depth = 0): string | undefined => {
  if (depth > 3) return undefined;
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return getDbErrorCode((err as { cause?: unknown }).cause, depth + 1);
};

const withSerializableWriteTransaction = async <T>(
  callback: (tx: DbExecutor) => Promise<T>,
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withDbTransaction(callback, {
        isolationLevel: 'serializable',
        accessMode: 'read write',
      });
    } catch (err) {
      if (
        getDbErrorCode(err) !== SERIALIZATION_FAILURE_SQLSTATE ||
        attempt >= MAX_SERIALIZABLE_WRITE_ATTEMPTS
      ) {
        throw err;
      }
    }
  }
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
  if (duration !== null) enforceDurationMax(duration);

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
  const parsedIsPlaceholder = requireValid(parseBooleanField(input, 'isPlaceholder'));

  return withSerializableWriteTransaction(async (tx) => {
    const duplicateExists = await entriesRepo.existsForEntryKey(
      { userId: targetUserId, date, projectId, task },
      tx,
    );
    if (duplicateExists) {
      fail(409, 'A time entry already exists for this date, project, and task');
    }

    return entriesRepo.create(
      {
        id: generatePrefixedId('te'),
        userId: targetUserId,
        date,
        clientId,
        clientName,
        projectId,
        projectName,
        task,
        taskId: resolvedTaskId,
        notes: parseOptionalNotes(input.notes),
        duration: duration ?? 0,
        hourlyCost,
        isPlaceholder: parsedIsPlaceholder ?? false,
        location,
      },
      tx,
    );
  });
};

export const updateTimeEntry = async (
  actor: AuthenticatedActor,
  id: unknown,
  input: {
    date?: unknown;
    clientId?: unknown;
    projectId?: unknown;
    task?: unknown;
    duration?: unknown;
    notes?: unknown;
    isPlaceholder?: unknown;
    location?: unknown;
    version?: unknown;
  },
): Promise<TimeEntry> => {
  if (!hasTrackerPermission(actor, 'update')) fail(403, 'Insufficient permissions');
  const entryId = requireValid(requireNonEmptyString(id, 'id'));
  const version = parseExpectedVersion(input.version);

  let parsedDuration: number | undefined;
  if (input.duration !== undefined) {
    parsedDuration = requireValid(parseLocalizedNonNegativeNumber(input.duration, 'duration'));
    enforceDurationMax(parsedDuration);
  }

  let validatedNotes: string | null | undefined;
  if (input.notes !== undefined) {
    validatedNotes = parseOptionalNotes(input.notes);
  }

  const context = await entriesRepo.findContext(entryId);
  if (context === null) return fail(404, 'Entry not found');

  if (context.userId !== actor.id && !hasPermission(actor, 'timesheets.tracker_all.update')) {
    const allowed = await workUnitsRepo.isUserManagedBy(actor.id, context.userId);
    if (!allowed) fail(403, 'Not authorized to update this entry');
  }

  const date =
    input.date !== undefined ? requireValid(parseDateString(input.date, 'date')) : undefined;
  const clientId =
    input.clientId !== undefined
      ? requireValid(requireNonEmptyString(input.clientId, 'clientId'))
      : undefined;
  const projectId =
    input.projectId !== undefined
      ? requireValid(requireNonEmptyString(input.projectId, 'projectId'))
      : undefined;
  const task =
    input.task !== undefined ? requireValid(requireNonEmptyString(input.task, 'task')) : undefined;

  // (clientId, projectId, task) is a tuple — partial patches risk silently orphaning taskId
  // or 403-ing on assignment checks against a stale field. Require all three together.
  const catalogFieldsSet = [clientId, projectId, task].filter((v) => v !== undefined).length;
  if (catalogFieldsSet !== 0 && catalogFieldsSet !== 3) {
    badRequest('clientId, projectId, and task must be updated together');
  }
  const catalogChanging = catalogFieldsSet === 3;

  if (date !== undefined && isWeekendDate(date)) {
    const settings = await generalSettingsRepo.get();
    if (!(settings?.allowWeekendSelection ?? true)) {
      badRequest('Time entries on weekends are not allowed');
    }
  }

  let resolvedTaskId: string | null | undefined;
  // Names are derived server-side from the IDs to keep the denormalized display fields
  // consistent with the FK targets — any clientName/projectName the caller sent is ignored.
  let resolvedClientName: string | undefined;
  let resolvedProjectName: string | undefined;
  if (catalogChanging) {
    // Non-null because catalogFieldsSet === 3 above.
    const effectiveClientId = clientId as string;
    const effectiveProjectId = projectId as string;
    const effectiveTask = task as string;

    const [projectHeader, taskFkLookup, clientNameLookup] = await Promise.all([
      projectsRepo.findClientIdAndName(effectiveProjectId),
      tasksRepo.findIdByProjectAndName(effectiveProjectId, effectiveTask),
      clientsRepo.findName(effectiveClientId),
    ]);
    if (projectHeader === null) return fail(400, 'Project not found');
    if (clientNameLookup === null) return fail(400, 'Client not found');
    if (projectHeader.clientId !== effectiveClientId) {
      badRequest('Project does not belong to the selected client');
    }

    resolvedTaskId = taskFkLookup ?? null;
    resolvedProjectName = projectHeader.name;
    resolvedClientName = clientNameLookup;

    if (!hasPermission(actor, 'timesheets.tracker_all.update')) {
      const [clientAllowed, projectAllowed, taskAllowed] = await Promise.all([
        userAssignmentsRepo.isClientAssignedToUser(context.userId, effectiveClientId),
        userAssignmentsRepo.isProjectAssignedToUser(context.userId, effectiveProjectId),
        resolvedTaskId
          ? userAssignmentsRepo.isTaskAssignedToUser(context.userId, resolvedTaskId)
          : Promise.resolve(true),
      ]);
      if (!clientAllowed || !projectAllowed || !taskAllowed) {
        fail(403, 'Not authorized to assign this entry to that client, project, or task');
      }
    }
  } else if (context.taskId === null) {
    const backfill = await tasksRepo.findIdByProjectAndName(context.projectId, context.task);
    if (backfill) resolvedTaskId = backfill;
  }

  const parsedIsPlaceholder = requireValid(parseBooleanField(input, 'isPlaceholder'));

  const updated = await entriesRepo.update(entryId, {
    version,
    date,
    clientId,
    clientName: resolvedClientName,
    projectId,
    projectName: resolvedProjectName,
    task,
    duration: parsedDuration,
    notes: validatedNotes,
    isPlaceholder: parsedIsPlaceholder,
    location: parseOptionalLocation(input.location, fail),
    taskId: resolvedTaskId,
  });

  if (updated === null) {
    return fail(409, 'Entry has changed since it was loaded; reload and retry');
  }
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
//   - 'monthly'              : same day-of-month as `recurrence_start`, clamped to month end
//   - 'monthly:<nth>:<dow>'  : Nth (first/second/third/fourth/last) weekday of the month;
//                              `dow` is 0=Sun..6=Sat (matches JS `Date.getDay()`)
//
// Sundays, configured Saturdays, Italian holidays, and days outside the template's
// `[recurrence_start, recurrence_end]` window are skipped. Existing entries (date +
// projectId + task name) are skipped, so re-running is idempotent.

const recurrenceMatches = (day: Date, pattern: string, start: Date): boolean => {
  if (pattern === 'daily') return true;
  if (pattern === 'weekly') return day.getDay() === start.getDay();
  if (pattern === 'monthly') {
    const lastDayOfMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    return day.getDate() === Math.min(start.getDate(), lastDayOfMonth);
  }
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

  const [recurringTasks, settings, hourlyCost] = await Promise.all([
    tasksRepo.listRecurringForUser(targetUserId),
    generalSettingsRepo.get(),
    usersRepo.findCostPerHour(targetUserId),
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

  type CandidateEntry = { key: string; entry: PendingEntry };
  const candidates: CandidateEntry[] = [];
  // Track keys staged in this run so two recurring templates with the same (date, projectId,
  // task) tuple don't become duplicate insert candidates in a single generation pass.
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
      if (stagedKeys.has(key)) continue;
      stagedKeys.add(key);
      candidates.push({ key, entry: buildPendingEntry(task, project, dateStr) });
    }
  }

  if (candidates.length === 0) {
    return {
      generated: [],
      generatedCount: 0,
      skippedExistingCount: 0,
      range: { fromDate, toDate },
    };
  }

  const { inserted, skippedExistingCount } = await withSerializableWriteTransaction(async (tx) => {
    const existingKeys = await entriesRepo.findExistingRecurringKeys(
      targetUserId,
      fromDate,
      toDate,
      tx,
    );
    const pending = candidates
      .filter((candidate) => !existingKeys.has(candidate.key))
      .map((candidate) => candidate.entry);

    if (pending.length === 0) {
      return {
        inserted: [],
        skippedExistingCount: candidates.length,
      };
    }

    return {
      inserted: await entriesRepo.createMany(pending, tx),
      skippedExistingCount: candidates.length - pending.length,
    };
  });
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
