import type { FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import * as taskAssignmentEligibilityRepo from '../repositories/taskAssignmentEligibilityRepo.ts';
import { getUserVisibilityScope } from './userVisibility.ts';

export const findIneligibleTaskAssigneeIds = (
  request: FastifyRequest,
  userIds: string[],
  exec: DbExecutor,
): Promise<string[]> =>
  taskAssignmentEligibilityRepo.findIneligibleAssigneeIds(
    userIds,
    {
      viewerId: request.user?.id ?? '',
      ...getUserVisibilityScope(request),
    },
    exec,
  );
