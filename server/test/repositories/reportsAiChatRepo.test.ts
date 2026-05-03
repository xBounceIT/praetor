import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/reportsAiChatRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('constants', () => {
  test('exports DEFAULT_CHAT_TITLE and id prefixes', () => {
    expect(repo.DEFAULT_CHAT_TITLE).toBe('AI Reporting');
    expect(repo.RPT_CHAT_ID_PREFIX).toBe('rpt-chat');
    expect(repo.RPT_MSG_ID_PREFIX).toBe('rpt-msg');
  });
});

describe('listSessionsForUser', () => {
  test('binds userId, isArchived=false, and limit=50', async () => {
    exec.enqueue({ rows: [] });
    await repo.listSessionsForUser('user-1', testDb);
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].params).toContain(false);
    expect(exec.calls[0].params).toContain(50);
  });

  test('returns rows with timestamps coerced to epoch ms', async () => {
    const created = new Date(1);
    const updated = new Date(2);
    exec.enqueue({ rows: [['s1', 'Hello', created, updated]] });
    const result = await repo.listSessionsForUser('user-1', testDb);
    expect(result).toEqual([{ id: 's1', title: 'Hello', createdAt: 1, updatedAt: 2 }]);
  });

  test('null timestamps coerce to 0', async () => {
    exec.enqueue({ rows: [['s1', 'Hello', null, null]] });
    const [result] = await repo.listSessionsForUser('user-1', testDb);
    expect(result).toEqual({ id: 's1', title: 'Hello', createdAt: 0, updatedAt: 0 });
  });
});

describe('createSession', () => {
  test('inserts with [id, userId, title, isArchived=false]', async () => {
    exec.enqueue({ rows: [] });
    await repo.createSession('s1', 'user-1', 'My Title', testDb);
    expect(exec.calls[0].sql).toContain('insert into "report_chat_sessions"');
    expect(exec.calls[0].params).toEqual(['s1', 'user-1', 'My Title', false]);
  });
});

describe('archiveSession', () => {
  test.each([
    [1, true],
    [0, false],
    [null, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await repo.archiveSession('s1', 'user-1', testDb)).toBe(expected);
  });

  test('binds isArchived=true followed by [id, userId] for the where clause', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await repo.archiveSession('s1', 'user-1', testDb);
    expect(exec.calls[0].sql).toContain('update "report_chat_sessions"');
    expect(exec.calls[0].sql).toContain('"is_archived"');
    expect(exec.calls[0].params).toEqual([true, 's1', 'user-1']);
  });
});

describe('sessionExistsForUser', () => {
  test('returns true when at least one row matches', async () => {
    exec.enqueue({ rows: [[1]] });
    expect(await repo.sessionExistsForUser('s1', 'user-1', testDb)).toBe(true);
  });

  test('returns false when no row matches', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.sessionExistsForUser('s1', 'user-1', testDb)).toBe(false);
  });

  test('binds [id, userId] for the where clause', async () => {
    exec.enqueue({ rows: [] });
    await repo.sessionExistsForUser('s1', 'user-1', testDb);
    expect(exec.calls[0].params).toContain('s1');
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('getActiveSessionForUser', () => {
  test('returns null when no row found', async () => {
    exec.enqueue({ rows: [] });
    const result = await repo.getActiveSessionForUser('s1', 'user-1', testDb);
    expect(result).toBeNull();
  });

  test('returns first row', async () => {
    exec.enqueue({ rows: [['Hello']] });
    const result = await repo.getActiveSessionForUser('s1', 'user-1', testDb);
    expect(result).toEqual({ title: 'Hello' });
  });

  test('filters on is_archived=false (bound as a param) and binds [id, userId]', async () => {
    exec.enqueue({ rows: [] });
    await repo.getActiveSessionForUser('s1', 'user-1', testDb);
    expect(exec.calls[0].params).toContain('s1');
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].params).toContain(false);
  });
});

describe('updateSessionTitleAndTouch', () => {
  test('binds [DEFAULT_CHAT_TITLE, candidateTitle, id, userId] in source order', async () => {
    exec.enqueue({ rows: [] });
    await repo.updateSessionTitleAndTouch('s1', 'user-1', 'New Title', testDb);
    expect(exec.calls[0].params).toEqual([repo.DEFAULT_CHAT_TITLE, 'New Title', 's1', 'user-1']);
  });

  test('only overwrites title when blank or default — keeps the CASE expression', async () => {
    exec.enqueue({ rows: [] });
    await repo.updateSessionTitleAndTouch('s1', 'user-1', 'New', testDb);
    expect(exec.calls[0].sql).toContain('CASE');
    expect(exec.calls[0].sql).toContain('BTRIM');
    expect(exec.calls[0].sql).toContain('LEFT(');
  });
});

describe('touchSession', () => {
  test('updates only updated_at, scoped by [id, userId]', async () => {
    exec.enqueue({ rows: [] });
    await repo.touchSession('s1', 'user-1', testDb);
    expect(exec.calls[0].params).toEqual(['s1', 'user-1']);
    expect(exec.calls[0].sql).toContain('update "report_chat_sessions"');
    expect(exec.calls[0].sql).toContain('"updated_at"');
    expect(exec.calls[0].sql).not.toContain('is_archived');
  });
});

describe('listMessagesForSession', () => {
  test('without beforeMs uses 2-param query (sessionId, limit)', async () => {
    exec.enqueue({ rows: [] });
    await repo.listMessagesForSession('s1', { beforeMs: null, limit: 30 }, testDb);
    expect(exec.calls[0].params).toEqual(['s1', 30]);
    expect(exec.calls[0].sql).not.toContain('TO_TIMESTAMP');
  });

  test('with beforeMs uses 3-param query and TO_TIMESTAMP filter', async () => {
    exec.enqueue({ rows: [] });
    await repo.listMessagesForSession('s1', { beforeMs: 1700000000000, limit: 10 }, testDb);
    expect(exec.calls[0].params).toEqual(['s1', 1700000000000, 10]);
    expect(exec.calls[0].sql).toContain('TO_TIMESTAMP($2 / 1000.0)');
  });

  test('maps positional row to ChatMessage shape, coercing nulls', async () => {
    const created = new Date(1700000000000);
    exec.enqueue({ rows: [['m1', 's1', 'user', 'hi', null, created]] });
    const result = await repo.listMessagesForSession('s1', { beforeMs: null, limit: 10 }, testDb);
    expect(result).toEqual([
      {
        id: 'm1',
        sessionId: 's1',
        role: 'user',
        content: 'hi',
        thoughtContent: null,
        createdAt: 1700000000000,
      },
    ]);
  });

  test('empty content/role pass through; empty thoughtContent maps to null', async () => {
    exec.enqueue({ rows: [['m1', 's1', '', '', '', new Date(0)]] });
    const [m] = await repo.listMessagesForSession('s1', { beforeMs: null, limit: 1 }, testDb);
    expect(m.content).toBe('');
    expect(m.thoughtContent).toBeNull();
  });

  test('null thoughtContent and null createdAt coerce safely', async () => {
    exec.enqueue({ rows: [['m1', 's1', 'user', 'hi', null, null]] });
    const [m] = await repo.listMessagesForSession('s1', { beforeMs: null, limit: 1 }, testDb);
    expect(m.thoughtContent).toBeNull();
    expect(m.createdAt).toBe(0);
  });
});

describe('listRecentMessages', () => {
  test('default limit is 20 and orders DESC', async () => {
    exec.enqueue({ rows: [] });
    await repo.listRecentMessages('s1', {}, testDb);
    expect(exec.calls[0].params).toEqual(['s1', 20]);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by');
    expect(exec.calls[0].sql.toLowerCase()).toContain('desc');
  });

  test('custom limit is honored', async () => {
    exec.enqueue({ rows: [] });
    await repo.listRecentMessages('s1', { limit: 5 }, testDb);
    expect(exec.calls[0].params).toEqual(['s1', 5]);
  });

  test('beforeOrAt filter switches to <= predicate with 3 params', async () => {
    exec.enqueue({ rows: [] });
    const cutoff = new Date('2026-01-01T00:00:00Z');
    await repo.listRecentMessages('s1', { beforeOrAt: cutoff, limit: 10 }, testDb);
    expect(exec.calls[0].params).toEqual(['s1', cutoff.toISOString(), 10]);
    expect(exec.calls[0].sql).toContain('<=');
  });
});

describe('insertUserMessage', () => {
  test('writes role=user with [id, sessionId, role, content]', async () => {
    exec.enqueue({ rows: [] });
    await repo.insertUserMessage('m1', 's1', 'hi', testDb);
    expect(exec.calls[0].params).toEqual(['m1', 's1', 'user', 'hi']);
    expect(exec.calls[0].sql).toContain('insert into "report_chat_messages"');
  });
});

describe('insertAssistantMessage', () => {
  test('without createdAt: column default supplies created_at; binds 5 params', async () => {
    exec.enqueue({ rows: [] });
    await repo.insertAssistantMessage(
      { id: 'm1', sessionId: 's1', content: 'ok', thoughtContent: null },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['m1', 's1', 'assistant', 'ok', null]);
  });

  test('with explicit Date createdAt: binds it as the 6th param (ISO-serialized)', async () => {
    exec.enqueue({ rows: [] });
    const when = new Date('2026-05-01T12:00:00Z');
    await repo.insertAssistantMessage(
      {
        id: 'm1',
        sessionId: 's1',
        content: 'ok',
        thoughtContent: 'thinking…',
        createdAt: when,
      },
      testDb,
    );
    expect(exec.calls[0].params).toEqual([
      'm1',
      's1',
      'assistant',
      'ok',
      'thinking…',
      when.toISOString(),
    ]);
  });

  test('with string createdAt: coerced to Date in repo, then ISO-serialized by Drizzle', async () => {
    exec.enqueue({ rows: [] });
    const iso = '2026-05-01T12:00:00.000Z';
    await repo.insertAssistantMessage(
      {
        id: 'm1',
        sessionId: 's1',
        content: 'ok',
        thoughtContent: null,
        createdAt: iso,
      },
      testDb,
    );
    const params = exec.calls[0].params;
    expect(params[params.length - 1]).toBe(iso);
  });
});

describe('findUserMessage / findFirstAssistantAfter', () => {
  test('findUserMessage returns null when missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findUserMessage('m1', 's1', testDb)).toBeNull();
  });

  test('findUserMessage returns first row as ChatMessageRef', async () => {
    const when = new Date('2026-05-01T12:00:00Z');
    exec.enqueue({ rows: [['m1', when]] });
    const result = await repo.findUserMessage('m1', 's1', testDb);
    expect(result).toEqual({ id: 'm1', createdAt: when });
  });

  test('findUserMessage binds [messageId, sessionId, role=user]', async () => {
    exec.enqueue({ rows: [] });
    await repo.findUserMessage('m1', 's1', testDb);
    expect(exec.calls[0].params).toContain('m1');
    expect(exec.calls[0].params).toContain('s1');
    expect(exec.calls[0].params).toContain('user');
  });

  test('findFirstAssistantAfter returns null when no later message', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findFirstAssistantAfter('s1', new Date('2026-05-01'), testDb)).toBeNull();
  });

  test('findFirstAssistantAfter binds [sessionId, role=assistant, afterDate] and orders ASC', async () => {
    exec.enqueue({ rows: [] });
    const when = new Date('2026-05-01T12:00:00Z');
    await repo.findFirstAssistantAfter('s1', when, testDb);
    expect(exec.calls[0].params).toContain('s1');
    expect(exec.calls[0].params).toContain('assistant');
    expect(exec.calls[0].params).toContain(when.toISOString());
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by');
    expect(exec.calls[0].sql.toLowerCase()).toContain('asc');
  });
});

describe('deleteMessage / updateMessageContent', () => {
  test('deleteMessage targets report_chat_messages with [id]', async () => {
    exec.enqueue({ rows: [] });
    await repo.deleteMessage('m1', testDb);
    expect(exec.calls[0].params).toEqual(['m1']);
    expect(exec.calls[0].sql).toContain('delete from "report_chat_messages"');
  });

  test('updateMessageContent binds [content, id] (set first, then where)', async () => {
    exec.enqueue({ rows: [] });
    await repo.updateMessageContent('m1', 'new', testDb);
    expect(exec.calls[0].params).toEqual(['new', 'm1']);
  });
});

describe('getFirstUserMessageContent', () => {
  test('returns empty string when no user message', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.getFirstUserMessageContent('s1', testDb)).toBe('');
  });

  test('returns first user message content from positional row', async () => {
    exec.enqueue({ rows: [['first ask']] });
    expect(await repo.getFirstUserMessageContent('s1', testDb)).toBe('first ask');
  });

  test('binds [sessionId, role=user] and limits to 1 with ASC order', async () => {
    exec.enqueue({ rows: [] });
    await repo.getFirstUserMessageContent('s1', testDb);
    expect(exec.calls[0].params).toContain('s1');
    expect(exec.calls[0].params).toContain('user');
    expect(exec.calls[0].params).toContain(1); // limit
    expect(exec.calls[0].sql.toLowerCase()).toContain('asc');
  });
});
