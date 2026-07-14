import { describe, expect, test } from 'bun:test';
import type { SiemCanonicalEvent } from '../../db/schema/siem.ts';
import {
  formatLeefEvent,
  normalizeRuntimeRecord,
  pinoLevelToName,
  removeUrlQuery,
} from '../../utils/leef.ts';

const event = (overrides: Partial<SiemCanonicalEvent> = {}): SiemCanonicalEvent => ({
  eventId: 'runtime.http.info',
  occurredAt: '2026-07-14T10:00:00.000Z',
  level: 'info',
  category: 'runtime',
  resource: 'http',
  message: 'request completed',
  attributes: { method: 'GET', status: 200 },
  ...overrides,
});

describe('LEEF formatter', () => {
  test('emits an RFC 5424 header followed by the fixed LEEF 2.0 header', () => {
    const output = formatLeefEvent(event(), {
      sourceIdentifier: 'praetor-01',
      facility: 16,
      maxBytes: 65_536,
    });

    expect(output).toStartWith(
      '<134>1 2026-07-14T10:00:00.000Z praetor-01 Praetor - runtime.http.info - LEEF:2.0|Praetor|Praetor ERP|',
    );
    expect(output).toContain('|runtime.http.info|^|devTime=1784023200000');
    expect(output).toContain('^sev=5^cat=runtime^resource=http^msg=request completed');
  });

  test('maps Pino numeric levels to canonical level names', () => {
    expect(pinoLevelToName(10)).toBe('trace');
    expect(pinoLevelToName(20)).toBe('debug');
    expect(pinoLevelToName(30)).toBe('info');
    expect(pinoLevelToName(40)).toBe('warn');
    expect(pinoLevelToName(50)).toBe('error');
    expect(pinoLevelToName(60)).toBe('fatal');
  });

  test('maps canonical levels to the increasing LEEF severity scale', () => {
    const severities = {
      trace: 1,
      debug: 2,
      info: 5,
      warn: 7,
      error: 9,
      fatal: 10,
    } as const;

    for (const [level, severity] of Object.entries(severities)) {
      const output = formatLeefEvent(event({ level: level as SiemCanonicalEvent['level'] }), {
        sourceIdentifier: 'praetor',
        facility: 16,
        maxBytes: 65_536,
      });
      expect(output).toContain(`^sev=${severity}^`);
    }
  });

  test('sanitizes header pipes, delimiters, and control characters', () => {
    const output = formatLeefEvent(event({ eventId: 'bad|id^x\n', message: 'hello^world\nnext' }), {
      sourceIdentifier: 'host|one',
      facility: 1,
      maxBytes: 65_536,
    });

    expect(output).toContain('host_one Praetor - bad_id_x -');
    expect(output).toContain('|bad id x|^|');
    expect(output).toContain('msg=hello world next');
  });

  test('bounds RFC 5424 identity fields to printable ASCII while preserving the LEEF event ID', () => {
    const eventId = `é${'x'.repeat(64)}`;
    const output = formatLeefEvent(event({ eventId }), {
      sourceIdentifier: `hôte ${'y'.repeat(300)}`,
      facility: 16,
      maxBytes: 65_536,
    });
    const header = output.match(/^<\d+>1 \S+ (\S+) Praetor - (\S+) - /);
    if (!header) throw new Error('Expected an RFC 5424 header');

    const hostname = header[1] ?? '';
    const messageId = header[2] ?? '';
    expect(hostname.length).toBeLessThanOrEqual(255);
    expect(messageId.length).toBeLessThanOrEqual(32);
    expect(
      [...hostname, ...messageId].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 33 && code <= 126;
      }),
    ).toBe(true);
    expect(output).toContain(`|${eventId}|^|`);
  });

  test('enforces the byte limit without splitting multibyte UTF-8 and marks truncation', () => {
    const output = formatLeefEvent(event({ message: '🙂'.repeat(10_000) }), {
      sourceIdentifier: 'praetor',
      facility: 16,
      maxBytes: 512,
    });

    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(512);
    expect(output).toEndWith('^truncated=true');
    expect(Buffer.from(output, 'utf8').toString('utf8')).toBe(output);
  });

  test('caps oversized event IDs without corrupting the LEEF envelope', () => {
    const output = formatLeefEvent(event({ eventId: 'x'.repeat(5000) }), {
      sourceIdentifier: 'praetor',
      facility: 16,
      maxBytes: 512,
    });

    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(512);
    const leefEventId = output.match(/LEEF:2\.0\|Praetor\|Praetor ERP\|[^|]*\|([^|]*)\|\^\|/)?.[1];
    expect(leefEventId).toHaveLength(255);
    expect(output).toContain('LEEF:2.0|Praetor|Praetor ERP|');
    expect(output).toContain('|^|');
    expect(output).toEndWith('^truncated=true');
  });

  test('reserves the truncation marker without cutting a previous key-value pair', () => {
    const boundaryEvent = event({
      attributes: { abcdefghijklmnopqrst: '', z: 'later' },
    });
    const options = { sourceIdentifier: 'praetor', facility: 16, maxBytes: 65_536 };
    const complete = formatLeefEvent(boundaryEvent, options);
    const nextPair = complete.indexOf('^z=');
    expect(nextPair).toBeGreaterThan(0);
    const maxBytes = Buffer.byteLength(complete.slice(0, nextPair), 'utf8');

    const output = formatLeefEvent(boundaryEvent, { ...options, maxBytes });
    const attributes = output.split('|^|')[1]?.split('^') ?? [];

    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(maxBytes);
    expect(attributes.every((pair) => pair.includes('='))).toBe(true);
    expect(output).toEndWith('^truncated=true');
  });
});

describe('runtime normalization allowlist', () => {
  test('keeps approved fields, strips URL query strings, and drops arbitrary properties', () => {
    const normalized = normalizeRuntimeRecord({
      level: 30,
      time: '2026-07-14T10:00:00.000Z',
      module: 'http',
      msg: 'done',
      req: { method: 'GET', url: '/api/users?token=secret', headers: { authorization: 'secret' } },
      res: { statusCode: 200 },
      body: { password: 'secret' },
      arbitrary: 'not-allowed',
    });

    expect(normalized?.attributes).toEqual({
      module: 'http',
      method: 'GET',
      url: '/api/users',
      status: 200,
    });
    expect(normalized?.attributes).not.toHaveProperty('body');
    expect(normalized?.attributes).not.toHaveProperty('arbitrary');
  });

  test('excludes worker-internal records and handles query stripping directly', () => {
    expect(normalizeRuntimeRecord({ siemInternal: true, level: 50 })).toBeNull();
    expect(removeUrlQuery('/path?a=1')).toBe('/path');
    expect(removeUrlQuery('/path')).toBe('/path');
  });

  test('falls back to a valid current timestamp for malformed runtime and canonical dates', () => {
    const normalized = normalizeRuntimeRecord({ level: 30, time: 'not-a-date', msg: 'bad clock' });
    expect(Number.isNaN(Date.parse(normalized?.occurredAt ?? ''))).toBe(false);

    const output = formatLeefEvent(event({ occurredAt: 'not-a-date' }), {
      sourceIdentifier: 'praetor',
      facility: 16,
      maxBytes: 65_536,
    });
    expect(output).toMatch(/^<134>1 \d{4}-\d{2}-\d{2}T/);
  });
});
