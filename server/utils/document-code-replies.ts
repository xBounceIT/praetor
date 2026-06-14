import type { FastifyReply, FastifyRequest } from 'fastify';
import { DocumentCodeCollisionError } from '../services/documentCodes.ts';
import { replyError } from './replyError.ts';

export const replyDocumentCodeCollision = (
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  action: string,
  entityType: string,
): Promise<FastifyReply> | null => {
  if (!(error instanceof DocumentCodeCollisionError)) return null;
  return replyError(request, reply, {
    statusCode: 409,
    message: error.message,
    action,
    entityType,
    errorCode: 'document_code_collision',
    details: { secondaryLabel: `auto_code_collision:${error.moduleId}` },
  });
};
