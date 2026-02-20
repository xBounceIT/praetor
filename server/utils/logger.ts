import pino, { type Bindings, type Logger, type LoggerOptions } from 'pino';

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const shouldUsePrettyLogs = parseBooleanEnv(process.env.LOG_PRETTY, !isProduction);

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

export const logger: Logger = pino(loggerOptions);

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
