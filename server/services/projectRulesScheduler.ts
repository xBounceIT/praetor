import type { Logger } from 'pino';
import { serializeError } from '../utils/logger.ts';
import { evaluateProjectRulesOnce } from './projectRulesEvaluator.ts';

export const PROJECT_RULES_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

export interface ProjectRulesSchedulerOptions {
  logger: Logger;
  intervalMs?: number;
  // Injectable for testing; defaults to the real evaluator.
  evaluate?: typeof evaluateProjectRulesOnce;
}

export interface ProjectRulesSchedulerHandle {
  stop(): void;
}

export const startProjectRulesScheduler = ({
  logger,
  intervalMs = PROJECT_RULES_SCHEDULER_INTERVAL_MS,
  evaluate = evaluateProjectRulesOnce,
}: ProjectRulesSchedulerOptions): ProjectRulesSchedulerHandle => {
  let stopped = false;
  let inFlight = false;

  const handle = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await evaluate({ logger });
    } catch (err) {
      if (!stopped) {
        logger.error({ err: serializeError(err) }, 'Project rules scheduler error');
      }
    } finally {
      inFlight = false;
    }
  }, intervalMs);

  handle.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
};
