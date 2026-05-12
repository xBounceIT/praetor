import { describe, expect, test } from 'bun:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { assertAuthenticated } from '../../utils/auth-assert.ts';

type FakeReply = {
  statusCode: number;
  body: unknown;
  sentCount: number;
  code(c: number): FakeReply;
  send(body: unknown): FakeReply;
};

const buildFakeReply = (): FakeReply => {
  const reply: FakeReply = {
    statusCode: 0,
    body: undefined,
    sentCount: 0,
    code(c: number) {
      reply.statusCode = c;
      return reply;
    },
    send(body: unknown) {
      reply.sentCount += 1;
      reply.body = body;
      return reply;
    },
  };
  return reply;
};

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  permissions: ['timesheets.tracker.view'],
};

const callAssert = (user: unknown, reply = buildFakeReply()) => {
  const request = { user } as unknown as FastifyRequest;
  const result = assertAuthenticated(request, reply as unknown as FastifyReply);
  return { result, reply };
};

describe('assertAuthenticated', () => {
  test('returns true and does not touch reply when request.user is present', () => {
    const { result, reply } = callAssert(HAPPY_USER);

    expect(result).toBe(true);
    expect(reply.sentCount).toBe(0);
    expect(reply.statusCode).toBe(0);
  });

  test('returns false and sends a 401 when request.user is missing', () => {
    // Pass an empty object so request.user is undefined via property access.
    const { result, reply } = callAssert(undefined);

    expect(result).toBe(false);
    expect(reply.statusCode).toBe(401);
    expect(reply.sentCount).toBe(1);
    expect(reply.body).toEqual({ error: 'Authentication required' });
  });

  test('treats explicit null user the same as missing user', () => {
    const { result, reply } = callAssert(null);

    expect(result).toBe(false);
    expect(reply.statusCode).toBe(401);
  });
});
