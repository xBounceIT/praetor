import { describe, expect, test } from 'bun:test';
import {
  createChildLogger,
  logger,
  loggerOptions,
  registerSiemLogSink,
  serializeError,
} from '../../utils/logger.ts';

// Note on env-branch coverage:
//   logger.ts reads NODE_ENV / LOG_LEVEL / LOG_PRETTY at module top-level. Once Bun loads
//   the module, those are baked in. Bun's coverage tool aggregates by source-mapped path,
//   so re-importing the module with a cache-bust query string evaluates a SECOND copy
//   under a different specifier - that copy is treated as a separate file by the coverage
//   collector and so does NOT add to utils/logger.ts coverage. We therefore exercise the
//   public surface of the *cached* module here, and validate the env-dependent shape of
//   `loggerOptions` against whatever NODE_ENV happened to be active during import.

const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';
const isCi = ['1', 'true', 'yes', 'on'].includes((process.env.CI ?? '').trim().toLowerCase());

describe('loggerOptions (snapshot of module-load env)', () => {
  test('level falls back to "info" when LOG_LEVEL is unset, otherwise reflects the env', () => {
    expect(loggerOptions.level).toBe(process.env.LOG_LEVEL ?? 'info');
  });

  test('base.service is the constant praetor-api tag', () => {
    expect((loggerOptions.base as { service: string }).service).toBe('praetor-api');
  });

  test('base.env reflects NODE_ENV (with the documented "development" fallback)', () => {
    expect((loggerOptions.base as { env: string }).env).toBe(process.env.NODE_ENV ?? 'development');
  });

  test('uses isoTime timestamp', () => {
    // pino exports stdTimeFunctions.isoTime; ensure the option is wired to a function.
    expect(typeof loggerOptions.timestamp).toBe('function');
  });

  test('redact configuration covers sensitive fields and removes them', () => {
    const redact = loggerOptions.redact as { paths: string[]; remove: boolean };
    expect(redact.remove).toBe(true);
    expect(redact.paths).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ]);
  });

  test('transport presence matches the LOG_PRETTY/NODE_ENV rules', () => {
    // Mirror parseBooleanEnv from logger.ts: any defined value (even whitespace)
    // is treated as explicit and only the truthy strings flip pretty on.
    const raw = process.env.LOG_PRETTY;
    let shouldBePretty: boolean;
    if (raw === undefined) {
      shouldBePretty = !isProduction && !isCi;
    } else {
      const normalized = raw.trim().toLowerCase();
      shouldBePretty =
        normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }

    if (shouldBePretty) {
      expect(loggerOptions.transport).toBeDefined();
      const transport = loggerOptions.transport as {
        target: string;
        options: Record<string, unknown>;
      };
      expect(transport.target).toBe('pino-pretty');
      expect(transport.options).toEqual({
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      });
    } else {
      expect(loggerOptions.transport).toBeUndefined();
    }
  });
});

describe('logger instance', () => {
  test('exposes the standard pino log methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  test('root accepts trace so the SIEM threshold remains independent from stdout', () => {
    expect(logger.level).toBe('trace');
  });
});

describe('createChildLogger', () => {
  test('returns a child logger with the given bindings', () => {
    const child = createChildLogger({ requestId: 'abc-123' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
  });

  test('child loggers can themselves spawn grandchildren', () => {
    const child = createChildLogger({ component: 'parent' });
    const grandchild = child.child({ component: 'grandchild' });
    expect(typeof grandchild.info).toBe('function');
  });

  test('root and child loggers write to the registered SIEM capture sink', () => {
    const records: Record<string, unknown>[] = [];
    registerSiemLogSink((record) => records.push(record));
    logger.info({ eventId: 'root.event' }, 'root');
    createChildLogger({ module: 'child-test' }).warn('child');
    registerSiemLogSink(null);

    expect(records.some((record) => record.eventId === 'root.event')).toBe(true);
    expect(records.some((record) => record.module === 'child-test')).toBe(true);
  });

  test('worker-internal records never reach the SIEM capture sink', () => {
    const records: Record<string, unknown>[] = [];
    registerSiemLogSink((record) => records.push(record));
    createChildLogger({ module: 'siem-worker', siemInternal: true }).error('internal');
    registerSiemLogSink(null);
    expect(records).toHaveLength(0);
  });
});

describe('serializeError', () => {
  test('serializes Error instances with name, message, and stack', () => {
    const err = new Error('boom');
    const out = serializeError(err);
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
  });

  test('serializes Error subclasses preserving the subclass name', () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'CustomError';
      }
    }
    const out = serializeError(new CustomError('nope'));
    expect(out.name).toBe('CustomError');
    expect(out.message).toBe('nope');
  });

  test('serializes a TypeError', () => {
    const out = serializeError(new TypeError('bad type'));
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('bad type');
  });

  test('wraps non-Error string values under an "error" key', () => {
    expect(serializeError('string-error')).toEqual({ error: 'string-error' });
  });

  test('wraps non-Error number values under an "error" key', () => {
    expect(serializeError(42)).toEqual({ error: 42 });
  });

  test('wraps non-Error object values under an "error" key', () => {
    expect(serializeError({ code: 'EFAIL' })).toEqual({ error: { code: 'EFAIL' } });
  });

  test('wraps null and undefined under an "error" key', () => {
    expect(serializeError(null)).toEqual({ error: null });
    expect(serializeError(undefined)).toEqual({ error: undefined });
  });
});
