import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requireScopedPermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as timeReportsRepo from '../repositories/timeReportsRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import {
  generateCompleteTimeReport,
  generateTimeReport,
  TimeReportExportLimitError,
  type TimeReportResult,
} from '../services/timeReports.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { requestHasPermission } from '../utils/permissions.ts';

const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'custom',
] as const;
const REPORT_FIELDS = ['user', 'client', 'project', 'task', 'duration', 'note', 'cost'] as const;
const REPORT_GROUPS = ['date', 'user', 'client', 'project', 'task'] as const;

type PeriodPreset = (typeof PERIOD_PRESETS)[number];
type ReportField = (typeof REPORT_FIELDS)[number];
type ReportGroup = (typeof REPORT_GROUPS)[number];

type ValidatedDefinition = timeReportsRepo.TimeReportDefinition & {
  periodPreset: PeriodPreset;
  userIds: string[];
};

const responseObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const definitionBodySchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const uniqueStrings = (value: unknown, maximum: number): string[] | null => {
  if (!Array.isArray(value) || value.length > maximum) return null;
  if (!value.every((item) => typeof item === 'string' && item.trim().length > 0)) return null;
  return Array.from(new Set(value));
};

const validateDefinition = (
  raw: unknown,
): { ok: true; value: ValidatedDefinition } | { ok: false; message: string } => {
  if (!isObject(raw)) return { ok: false, message: 'Report definition must be an object' };
  const periodPreset = raw.periodPreset;
  if (!PERIOD_PRESETS.includes(periodPreset as PeriodPreset)) {
    return { ok: false, message: 'Invalid periodPreset' };
  }
  if (!isDateOnly(raw.fromDate) || !isDateOnly(raw.toDate) || raw.fromDate > raw.toDate) {
    return { ok: false, message: 'Invalid inclusive date range' };
  }
  const userIds = uniqueStrings(raw.userIds, 1_000);
  const projectIds = uniqueStrings(raw.projectIds, 1_000);
  const fields = uniqueStrings(raw.fields, REPORT_FIELDS.length);
  const groupBy = uniqueStrings(raw.groupBy, 3);
  if (!userIds || !projectIds || !fields || !groupBy) {
    return { ok: false, message: 'Invalid report array value' };
  }
  if (
    !Array.isArray(raw.fields) ||
    fields.length !== raw.fields.length ||
    !Array.isArray(raw.groupBy) ||
    groupBy.length !== raw.groupBy.length
  ) {
    return { ok: false, message: 'Report fields and groupings must be distinct' };
  }
  if (typeof raw.totalsOnly !== 'boolean') return { ok: false, message: 'Invalid totalsOnly' };
  if (
    !fields.every((field): field is ReportField => REPORT_FIELDS.includes(field as ReportField))
  ) {
    return { ok: false, message: 'Invalid report field' };
  }
  if (
    !groupBy.every((group): group is ReportGroup => REPORT_GROUPS.includes(group as ReportGroup))
  ) {
    return { ok: false, message: 'Invalid groupBy value' };
  }
  if (raw.totalsOnly === true && groupBy.length === 0) {
    return { ok: false, message: 'totalsOnly requires at least one grouping' };
  }
  if (raw.clientId !== null && (typeof raw.clientId !== 'string' || raw.clientId.trim() === '')) {
    return { ok: false, message: 'Invalid clientId' };
  }
  let task: timeReportsRepo.TimeReportTaskFilter | null = null;
  if (raw.task !== null) {
    if (
      !isObject(raw.task) ||
      typeof raw.task.projectId !== 'string' ||
      raw.task.projectId.trim() === '' ||
      (raw.task.taskId !== null &&
        (typeof raw.task.taskId !== 'string' || raw.task.taskId.trim() === '')) ||
      typeof raw.task.name !== 'string' ||
      raw.task.name.trim() === ''
    ) {
      return { ok: false, message: 'Invalid task filter' };
    }
    task = {
      projectId: raw.task.projectId,
      taskId: raw.task.taskId as string | null,
      name: raw.task.name,
    };
  }
  if (typeof raw.noteContains !== 'string' || raw.noteContains.length > 2_000) {
    return { ok: false, message: 'Invalid noteContains value' };
  }
  return {
    ok: true,
    value: {
      periodPreset: periodPreset as PeriodPreset,
      fromDate: raw.fromDate,
      toDate: raw.toDate,
      userIds,
      clientId: raw.clientId as string | null,
      projectIds,
      task,
      noteContains: raw.noteContains,
      fields,
      groupBy,
      totalsOnly: raw.totalsOnly === true,
    },
  };
};

const resolveAllowedUserIds = async (request: FastifyRequest): Promise<string[]> => {
  if (!request.user) return [];
  if (!requestHasPermission(request, 'reports.time_report_all.view')) {
    return [request.user.id];
  }
  if (requestHasPermission(request, 'timesheets.tracker_all.view')) {
    return timeReportsRepo.listAllNonAdminUserIds();
  }
  const managed = await workUnitsRepo.listManagedUserIds(request.user.id);
  const candidates = Array.from(new Set([request.user.id, ...managed]));
  return timeReportsRepo.filterNonAdminUserIds(candidates);
};

const assertNotAdmin = (request: FastifyRequest, reply: FastifyReply): boolean => {
  if (request.user?.role !== 'admin') return true;
  reply.code(403).send({ error: 'Administrators cannot generate time reports' });
  return false;
};

const scopedDefinition = async (
  request: FastifyRequest,
  reply: FastifyReply,
  raw: unknown,
): Promise<{ definition: ValidatedDefinition; userIds: string[]; includeCost: boolean } | null> => {
  const validation = validateDefinition(raw);
  if (!validation.ok) {
    reply.code(400).send({ error: validation.message });
    return null;
  }
  const definition = validation.value;
  const allowed = await resolveAllowedUserIds(request);
  const allowedSet = new Set(allowed);
  const canSelectUsers = requestHasPermission(request, 'reports.time_report_all.view');
  const requested = canSelectUsers
    ? definition.userIds.length > 0
      ? definition.userIds
      : [request.user?.id ?? '']
    : [request.user?.id ?? ''];
  const outsideScope = requested.filter((id) => !allowedSet.has(id));
  if (outsideScope.length > 0) {
    reply.code(403).send({ error: 'One or more selected users are outside the accessible scope' });
    return null;
  }
  const requestedCost = definition.fields.includes('cost');
  const includeCost = requestedCost && requestHasPermission(request, 'reports.cost.view');
  if (requestedCost && !includeCost) {
    reply.code(403).send({ error: 'Cost reporting permission is required' });
    return null;
  }
  return { definition, userIds: requested, includeCost };
};

const formatDuration = (hours: number): string => {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(Math.abs(minutes % 60)).padStart(2, '0')}`;
};

const csvSafe = (value: unknown): string => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^(?:\s*[=+\-@]|[\t\r\n])/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const buildCsv = (
  result: TimeReportResult,
  definition: ValidatedDefinition,
  language: 'it' | 'en',
  currency: string,
): string => {
  const it = language === 'it';
  const labels: Record<'date' | ReportField, string> = it
    ? {
        date: 'Data',
        user: 'Utente',
        client: 'Cliente',
        project: 'Progetto',
        task: 'Attività',
        duration: 'Durata',
        note: 'Nota',
        cost: 'Costo',
      }
    : {
        date: 'Date',
        user: 'User',
        client: 'Client',
        project: 'Project',
        task: 'Task',
        duration: 'Duration',
        note: 'Note',
        cost: 'Cost',
      };
  const columns: Array<'date' | ReportField> = ['date', ...definition.fields];
  const valueFor = (row: TimeReportResult['rows'][number], column: 'date' | ReportField) => {
    if (column === 'date') return row.kind === 'subtotal' ? row.label : row.date;
    if (column === 'user') return row.userName;
    if (column === 'client') return row.clientName;
    if (column === 'project') return row.projectName;
    if (column === 'task') return row.taskName;
    if (column === 'duration') return formatDuration(row.duration);
    if (column === 'note') return row.notes;
    return row.cost === null ? '' : `${row.cost.toFixed(2)} ${currency}`;
  };
  const lines = [
    columns.map((column) => csvSafe(labels[column])).join(','),
    ...result.rows.map((row) => columns.map((column) => csvSafe(valueFor(row, column))).join(',')),
  ];
  const totalValues = columns.map((column, index) => {
    if (index === 0) return csvSafe(it ? 'Totale' : 'Total');
    if (column === 'duration') return csvSafe(formatDuration(result.totals.duration));
    if (column === 'cost' && result.totals.cost !== null) {
      return csvSafe(`${result.totals.cost.toFixed(2)} ${currency}`);
    }
    return csvSafe('');
  });
  lines.push(totalValues.join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
};

export default async function timeReportRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireScopedPermission('reports.time_report', 'view'));

  fastify.get(
    '/options',
    {
      schema: {
        tags: ['reports'],
        summary: 'List time report filter options in the caller scope',
        response: { 200: responseObjectSchema },
      },
    },
    async (request, reply) => {
      if (!assertAuthenticated(request, reply) || !assertNotAdmin(request, reply)) return;
      const allowedUserIds = await resolveAllowedUserIds(request);
      return timeReportsRepo.listOptions(allowedUserIds);
    },
  );

  fastify.post(
    '/generate',
    {
      schema: {
        tags: ['reports'],
        summary: 'Generate a grouped time entry report',
        body: definitionBodySchema,
        response: { 200: responseObjectSchema },
      },
    },
    async (request, reply) => {
      if (!assertAuthenticated(request, reply) || !assertNotAdmin(request, reply)) return;
      const scoped = await scopedDefinition(request, reply, request.body);
      if (!scoped) return;
      return generateTimeReport(scoped.definition, scoped.userIds, scoped.includeCost);
    },
  );

  fastify.post(
    '/export.csv',
    {
      schema: {
        tags: ['reports'],
        summary: 'Export a complete grouped time entry report as CSV',
        body: responseObjectSchema,
      },
    },
    async (request, reply) => {
      if (!assertAuthenticated(request, reply) || !assertNotAdmin(request, reply)) return;
      const body = isObject(request.body) ? request.body : {};
      const scoped = await scopedDefinition(request, reply, body.definition);
      if (!scoped) return;
      try {
        const result = await generateCompleteTimeReport(
          scoped.definition,
          scoped.userIds,
          scoped.includeCost,
        );
        const settings = await generalSettingsRepo.get();
        const language = body.language === 'en' ? 'en' : 'it';
        const csv = buildCsv(result, scoped.definition, language, settings?.currency ?? '€');
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="time-report.csv"')
          .send(csv);
      } catch (error) {
        if (error instanceof TimeReportExportLimitError) {
          return reply.code(413).send({ error: error.message, count: error.count });
        }
        throw error;
      }
    },
  );
}
