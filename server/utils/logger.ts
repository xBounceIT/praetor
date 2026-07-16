import { Writable } from 'node:stream';
import dotenv from 'dotenv';
import pino, { type Bindings, type Logger, type LoggerOptions } from 'pino';

dotenv.config({ quiet: true });

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const isCi = parseBooleanEnv(process.env.CI, false);
const shouldUsePrettyLogs = parseBooleanEnv(process.env.LOG_PRETTY, !isProduction && !isCi);

const baseLoggerOptions: LoggerOptions = {
  level: logLevel,
  base: {
    service: 'praetor-api',
    env: NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    remove: true,
  },
};

const prettyTransport: LoggerOptions['transport'] = shouldUsePrettyLogs
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const loggerOptions: LoggerOptions = {
  ...baseLoggerOptions,
  ...(prettyTransport ? { transport: prettyTransport } : {}),
};

export type SiemLogSink = (record: Record<string, unknown>) => void;

let siemLogSink: SiemLogSink | null = null;

export const registerSiemLogSink = (sink: SiemLogSink | null): void => {
  siemLogSink = sink;
};

const siemCaptureStream = new Writable({
  write(chunk, _encoding, callback) {
    try {
      if (siemLogSink) {
        const record = JSON.parse(chunk.toString()) as Record<string, unknown>;
        if (record.siemInternal !== true) siemLogSink(record);
      }
    } catch {
      // Logging must always remain fail-open. Malformed capture records still reached stdout.
    }
    callback();
  },
});

const stdoutStream = shouldUsePrettyLogs
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
  : process.stdout;

// The root accepts every Pino level so the SIEM threshold is independent from LOG_LEVEL.
// The stdout stream still enforces LOG_LEVEL and keeps the existing JSON/pretty behavior.
export const logger: Logger = pino(
  { ...baseLoggerOptions, level: 'trace' },
  pino.multistream([
    { level: logLevel, stream: stdoutStream },
    { level: 'trace', stream: siemCaptureStream },
  ]),
);

export const createChildLogger = (bindings: Bindings): Logger => logger.child(bindings);

export const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    error,
  };
};
