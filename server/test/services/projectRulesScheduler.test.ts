import { describe, expect, mock, test } from 'bun:test';
import type { Logger } from 'pino';
import type {
  EvaluateProjectRulesOptions,
  ProjectRulesEvaluationResult,
} from '../../services/projectRulesEvaluator.ts';
import { startProjectRulesScheduler } from '../../services/projectRulesScheduler.ts';

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const EMPTY_RESULT: ProjectRulesEvaluationResult = {
  evaluated: 0,
  triggered: 0,
  reset: 0,
  notified: 0,
};

const createLoggerStub = (): Logger => {
  const stub = {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    trace: mock(),
    fatal: mock(),
    child: () => stub,
  };
  return stub as unknown as Logger;
};

type Evaluate = (options?: EvaluateProjectRulesOptions) => Promise<ProjectRulesEvaluationResult>;

describe('startProjectRulesScheduler', () => {
  test('runs the evaluator on each interval tick', async () => {
    const evaluate = mock<Evaluate>(async () => EMPTY_RESULT);
    const logger = createLoggerStub();

    const scheduler = startProjectRulesScheduler({ logger, intervalMs: 5, evaluate });

    await new Promise((resolve) => setTimeout(resolve, 25));
    scheduler.stop();

    expect(evaluate.mock.calls.length).toBeGreaterThan(0);
    expect(evaluate.mock.calls[0][0]).toMatchObject({ logger });
  });

  test('stop() prevents future interval fires', async () => {
    const evaluate = mock<Evaluate>(async () => EMPTY_RESULT);
    const logger = createLoggerStub();

    const scheduler = startProjectRulesScheduler({ logger, intervalMs: 5, evaluate });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const callsBeforeStop = evaluate.mock.calls.length;
    expect(callsBeforeStop).toBeGreaterThan(0);

    scheduler.stop();
    const callsAtStop = evaluate.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(evaluate.mock.calls.length).toBe(callsAtStop);
  });

  test('inFlight guard prevents overlapping evaluations', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const evaluate = mock<Evaluate>(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 15));
      concurrent--;
      return EMPTY_RESULT;
    });
    const logger = createLoggerStub();

    const scheduler = startProjectRulesScheduler({ logger, intervalMs: 1, evaluate });

    await new Promise((resolve) => setTimeout(resolve, 30));
    scheduler.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(evaluate.mock.calls.length).toBeGreaterThan(0);
    expect(maxConcurrent).toBe(1);
  });

  test('logs and continues when the evaluation throws while running', async () => {
    const evaluate = mock<Evaluate>(async () => {
      throw new Error('boom');
    });
    const logger = createLoggerStub();

    const scheduler = startProjectRulesScheduler({ logger, intervalMs: 5, evaluate });

    await new Promise((resolve) => setTimeout(resolve, 25));
    scheduler.stop();

    const errorCalls = (logger.error as ReturnType<typeof mock>).mock.calls;
    expect(errorCalls.length).toBeGreaterThan(0);
    expect(errorCalls[0][0]).toMatchObject({ err: { name: 'Error', message: 'boom' } });
  });

  test('stop() suppresses errors from in-flight evaluations', async () => {
    let releaseEvaluation!: () => void;
    const blockingEvaluation = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    const evaluate = mock<Evaluate>(async () => {
      await blockingEvaluation;
      throw new Error('pool has ended');
    });
    const logger = createLoggerStub();

    const scheduler = startProjectRulesScheduler({ logger, intervalMs: 1, evaluate });

    await new Promise((resolve) => setTimeout(resolve, 10));

    scheduler.stop();
    releaseEvaluation();
    await flushMicrotasks();
    await flushMicrotasks();

    expect((logger.error as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});
