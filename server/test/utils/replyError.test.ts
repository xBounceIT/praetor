import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as realAuditLogsRepo from '../../repositories/auditLogsRepo.ts';

const auditRepoSnapshot = { ...realAuditLogsRepo };

const createMock = mock(async (_input: realAuditLogsRepo.AuditLogInsert) => undefined);

beforeAll(() => {
  mock.module('../../repositories/auditLogsRepo.ts', () => ({
    ...auditRepoSnapshot,
    create: createMock,
  }));
});

afterAll(() => {
  mock.module('../../repositories/auditLogsRepo.ts', () => auditRepoSnapshot);
});

beforeEach(() => {
  createMock.mockClear();
  createMock.mockImplementation(async () => undefined);
});

const { replyError } = await import('../../utils/replyError.ts');

const buildRequest = (overrides: Partial<FastifyRequest> = {}): FastifyRequest =>
  ({
    ip: '10.0.0.5',
    user: {
      id: 'user-1',
      name: 'A',
      username: 'a',
      role: 'user',
      avatarInitials: 'A',
      permissions: [],
    },
    ...overrides,
  }) as unknown as FastifyRequest;

type ReplyCall = { method: 'code' | 'send'; args: unknown[] };

const buildReply = () => {
  const calls: ReplyCall[] = [];
  const reply = {
    code(status: number) {
      calls.push({ method: 'code', args: [status] });
      return reply;
    },
    send(body: unknown) {
      calls.push({ method: 'send', args: [body] });
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, calls };
};

describe('replyError', () => {
  test('writes audit then sends the reply with the configured status and body', async () => {
    const request = buildRequest();
    const { reply, calls } = buildReply();

    await replyError(request, reply, {
      statusCode: 409,
      message: 'Locked',
      action: 'client_offer.update.conflict',
      entityType: 'client_offer',
      entityId: 'co-1',
      details: { targetLabel: 'Offer #1' },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      action: 'client_offer.update.conflict',
      entityType: 'client_offer',
      entityId: 'co-1',
      ipAddress: '10.0.0.5',
    });
    expect(calls).toEqual([
      { method: 'code', args: [409] },
      { method: 'send', args: [{ error: 'Locked' }] },
    ]);
  });

  test('emits errorCode in the body when provided', async () => {
    const request = buildRequest();
    const { reply, calls } = buildReply();

    await replyError(request, reply, {
      statusCode: 400,
      message: 'Bad input',
      action: 'product.update.invalid',
      errorCode: 'PRODUCT_BAD',
    });

    expect(calls.at(-1)?.args[0]).toEqual({ error: 'Bad input', errorCode: 'PRODUCT_BAD' });
  });

  test('skipAudit=true skips the audit insert', async () => {
    const request = buildRequest();
    const { reply, calls } = buildReply();

    await replyError(request, reply, {
      statusCode: 404,
      message: 'Not found',
      action: 'noop',
      skipAudit: true,
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(calls).toEqual([
      { method: 'code', args: [404] },
      { method: 'send', args: [{ error: 'Not found' }] },
    ]);
  });

  test('does not propagate audit insert failures', async () => {
    createMock.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    const request = buildRequest();
    const { reply, calls } = buildReply();

    await expect(
      replyError(request, reply, {
        statusCode: 403,
        message: 'Forbidden',
        action: 'user.update.denied',
      }),
    ).resolves.toBeDefined();

    expect(calls).toEqual([
      { method: 'code', args: [403] },
      { method: 'send', args: [{ error: 'Forbidden' }] },
    ]);
  });

  test('still sends the reply when audit is skipped due to missing user', async () => {
    const request = buildRequest({ user: undefined });
    const { reply, calls } = buildReply();

    await replyError(request, reply, {
      statusCode: 403,
      message: 'Forbidden',
      action: 'user.update.denied',
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(calls).toEqual([
      { method: 'code', args: [403] },
      { method: 'send', args: [{ error: 'Forbidden' }] },
    ]);
  });
});
