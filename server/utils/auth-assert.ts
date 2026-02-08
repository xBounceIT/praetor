import type { FastifyReply, FastifyRequest } from 'fastify';

type AuthenticatedRequest = FastifyRequest & {
  user: NonNullable<FastifyRequest['user']>;
};

export function assertAuthenticated(
  request: FastifyRequest,
  reply: FastifyReply,
): request is AuthenticatedRequest {
  if (request.user) return true;
  reply.code(401).send({ error: 'Authentication required' });
  return false;
}
