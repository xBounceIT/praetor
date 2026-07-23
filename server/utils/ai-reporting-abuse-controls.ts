import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const AI_REPORTING_GENERATION_RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute',
} as const;

export const AI_REPORTING_MAX_CONCURRENT_GENERATIONS_PER_USER = 2;
export const AI_REPORTING_MAX_OUTPUT_TOKENS = 4096;

const generationKey = (request: FastifyRequest): string =>
  request.user?.id ? `user:${request.user.id}` : `ip:${request.ip}`;

const logThrottle = (request: FastifyRequest, reason: 'concurrency_limit' | 'rate_limit'): void => {
  request.log.warn(
    {
      action: 'reports_ai_generation.throttled',
      reason,
      userId: request.user?.id,
      authSource: request.auth?.source,
      route: request.routeOptions.url,
    },
    'AI reporting generation request throttled',
  );
};

export const createAiReportingAbuseControls = (fastify: FastifyInstance) => {
  const activeGenerations = new Map<string, number>();
  const rateLimit = fastify.rateLimit({
    ...AI_REPORTING_GENERATION_RATE_LIMIT,
    keyGenerator: generationKey,
    onExceeded: (request) => logThrottle(request, 'rate_limit'),
  });

  const concurrencyLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = generationKey(request);
    const active = activeGenerations.get(key) ?? 0;
    if (active >= AI_REPORTING_MAX_CONCURRENT_GENERATIONS_PER_USER) {
      logThrottle(request, 'concurrency_limit');
      const response = reply
        .code(429)
        .header('retry-after', '1')
        .send({ error: 'Too many concurrent AI reporting requests' });
      if (reply.raw.headersSent && !reply.sent) reply.hijack();
      return response;
    }

    activeGenerations.set(key, active + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reply.raw.off('finish', release);
      reply.raw.off('close', release);
      const remaining = (activeGenerations.get(key) ?? 1) - 1;
      if (remaining > 0) activeGenerations.set(key, remaining);
      else activeGenerations.delete(key);
    };

    reply.raw.once('finish', release);
    reply.raw.once('close', release);
  };

  return { concurrencyLimit, rateLimit };
};
