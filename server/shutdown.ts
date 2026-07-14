import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { serializeError } from './utils/logger.ts';

export const performShutdown = async (
  fastify: FastifyInstance,
  signal: string,
  log: Logger,
  afterClose?: () => Promise<void>,
): Promise<number> => {
  try {
    log.info({ signal }, 'Shutting down');
    let shutdownError: unknown;
    try {
      await fastify.close();
    } catch (error) {
      shutdownError = error;
    }
    try {
      await afterClose?.();
    } catch (error) {
      shutdownError ??= error;
    }
    if (shutdownError) throw shutdownError;
    return 0;
  } catch (err) {
    log.error({ signal, err: serializeError(err) }, 'Shutdown error');
    return 1;
  }
};
