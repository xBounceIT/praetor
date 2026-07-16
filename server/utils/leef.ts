import type { SiemCanonicalEvent, SiemLogLevel } from '../db/schema/siem.ts';
import { APP_VERSION } from './app-version.ts';

export const UDP_MAX_BYTES = 8 * 1024;
export const STREAM_MAX_BYTES = 64 * 1024;
const EVENT_ID_MAX_BYTES = 255;

const LEVEL_TO_SYSLOG_SEVERITY: Record<SiemLogLevel, number> = {
  trace: 7,
  debug: 7,
  info: 6,
  warn: 4,
  error: 3,
  fatal: 2,
};

const LEVEL_TO_LEEF_SEVERITY: Record<SiemLogLevel, number> = {
  trace: 1,
  debug: 2,
  info: 5,
  warn: 7,
  error: 9,
  fatal: 10,
};

const sanitize = (value: unknown): string => {
  const text = String(value ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: LEEF must strip the complete ASCII control range.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.replace(/[|^]/g, ' ');
};

const utf8Length = (value: string): number => Buffer.byteLength(value, 'utf8');

const truncateUtf8 = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) return '';
  if (utf8Length(value) <= maxBytes) return value;

  let result = '';
  let used = 0;
  for (const character of value) {
    const bytes = utf8Length(character);
    if (used + bytes > maxBytes) break;
    result += character;
    used += bytes;
  }
  return result;
};

const toIsoTimestamp = (value: unknown): string => {
  const date = new Date(
    typeof value === 'string' || typeof value === 'number' ? value : Date.now(),
  );
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const sanitizeSyslogField = (value: unknown, maxLength: number, fallback: string): string => {
  const ascii = [...sanitize(value)]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 33 && code <= 126 ? character : '_';
    })
    .join('');
  return (ascii || fallback).slice(0, maxLength);
};

export const pinoLevelToName = (level: unknown): SiemLogLevel => {
  if (typeof level === 'string' && level in LEVEL_TO_SYSLOG_SEVERITY) return level as SiemLogLevel;
  if (typeof level !== 'number') return 'info';
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
};

export const removeUrlQuery = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value) return undefined;
  const queryIndex = value.indexOf('?');
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
};

export const normalizeRuntimeRecord = (
  record: Record<string, unknown>,
): SiemCanonicalEvent | null => {
  if (record.siemInternal === true) return null;
  const level = pinoLevelToName(record.level);
  const moduleName = sanitize(record.module || record.service || 'application');
  const request =
    record.req && typeof record.req === 'object' ? (record.req as Record<string, unknown>) : {};
  const response =
    record.res && typeof record.res === 'object' ? (record.res as Record<string, unknown>) : {};
  const error =
    record.err && typeof record.err === 'object' ? (record.err as Record<string, unknown>) : {};

  const candidates: Record<string, unknown> = {
    service: record.service,
    module: record.module,
    requestId: record.reqId ?? record.requestId,
    method: record.method ?? request.method,
    url: removeUrlQuery(record.url ?? request.url),
    status: record.status ?? record.statusCode ?? response.statusCode,
    duration: record.duration ?? record.responseTime,
    ip: record.ip ?? request.remoteAddress,
    user: record.user ?? record.userId ?? record.username,
    action: record.action,
    entity: record.entity ?? record.entityType,
    entityId: record.entityId,
    errorName: error.name,
    errorMessage: error.message,
    errorCode: error.code,
  };

  const attributes = Object.fromEntries(
    Object.entries(candidates).flatMap(([key, value]) => {
      if (value === undefined || value === null || value === '') return [];
      if (!['string', 'number', 'boolean'].includes(typeof value)) return [];
      return [[key, value as string | number | boolean]];
    }),
  );

  return {
    eventId: sanitize(record.eventId || `runtime.${moduleName}.${level}`),
    occurredAt: toIsoTimestamp(record.time),
    level,
    category: 'runtime',
    resource: moduleName,
    message: sanitize(record.msg || 'Runtime event'),
    attributes,
  };
};

export type LeefFormatOptions = {
  sourceIdentifier: string;
  facility: number;
  maxBytes: number;
};

export const formatLeefEvent = (event: SiemCanonicalEvent, options: LeefFormatOptions): string => {
  const syslogSeverity = LEVEL_TO_SYSLOG_SEVERITY[event.level];
  const leefSeverity = LEVEL_TO_LEEF_SEVERITY[event.level];
  const priority = options.facility * 8 + syslogSeverity;
  const rawEventId = sanitize(event.eventId) || 'unknown';
  const eventId = truncateUtf8(rawEventId, EVENT_ID_MAX_BYTES);
  const occurredAt = toIsoTimestamp(event.occurredAt);
  const syslogEventId = sanitizeSyslogField(eventId, 32, 'unknown');
  const sourceIdentifier = sanitizeSyslogField(options.sourceIdentifier, 255, 'praetor');
  const leefHeader = `LEEF:2.0|Praetor|Praetor ERP|${sanitize(APP_VERSION)}|${eventId}|^|`;
  const syslogHeader = `<${priority}>1 ${occurredAt} ${sourceIdentifier} Praetor - ${syslogEventId} - `;
  const prefix = `${syslogHeader}${leefHeader}`;
  const truncatedPair = '^truncated=true';

  const rawAttributes: Array<[string, unknown]> = [
    ['devTime', Date.parse(occurredAt)],
    ['sev', leefSeverity],
    ['cat', event.category],
    ['resource', event.resource],
    ['msg', event.message],
    ...Object.entries(event.attributes).toSorted(([left], [right]) => left.localeCompare(right)),
  ];

  let output = prefix;
  let truncated = eventId !== rawEventId;
  for (const [index, [rawKey, rawValue]] of rawAttributes.entries()) {
    const key = sanitize(rawKey).replace(/[^A-Za-z0-9_.-]/g, '_') || 'field';
    const value = sanitize(rawValue);
    const pairPrefix = `${output === prefix ? '' : '^'}${key}=`;
    const fullPair = `${pairPrefix}${value}`;
    const reserve = utf8Length(truncatedPair);
    const markerRequired = truncated || index < rawAttributes.length - 1;

    if (utf8Length(output + fullPair) + (markerRequired ? reserve : 0) <= options.maxBytes) {
      output += fullPair;
      continue;
    }

    const available = options.maxBytes - utf8Length(output + pairPrefix) - reserve;
    const shortened = truncateUtf8(value, available);
    if (shortened) output += pairPrefix + shortened;
    truncated = true;
    break;
  }

  if (truncated) output += truncatedPair;

  return output;
};
