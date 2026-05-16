import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { serializeError } from './utils/logger.ts';

export const performShutdown = async (
  fastify: FastifyInstance,
  signal: string,
  log: Logger,
): Promise<number> => {
  try {
    log.info({ signal }, 'Shutting down');
    await fastify.close();
    return 0;
  } catch (err) {
    log.error({ signal, err: serializeError(err) }, 'Shutdown error');
    return 1;
  }
};
