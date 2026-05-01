import { beforeEach, describe, expect, test } from 'bun:test';
import * as repo from '../../repositories/reportsAiChatRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('constants', () => {
  test('exports DEFAULT_CHAT_TITLE and id prefixes', () => {
    expect(repo.DEFAULT_CHAT_TITLE).toBe('AI Reporting');
    expect(repo.RPT_CHAT_ID_PREFIX).toBe('rpt-chat');
    expect(repo.RPT_MSG_ID_PREFIX).toBe('rpt-msg');
  });
});

describe('listSessionsForUser', () => {
  test('passes userId as $1 and limits to 50', async () => {
    exec.enqueue({ rows: [] });
    await repo.listSessionsForUser('user-1', exec);
    expect(exec.calls[0].params).toEqual(['user-1']);
    expect(exec.calls[0].sql).toContain('LIMIT 50');
    expect(exec.calls[0].sql).toContain('is_archived = FALSE');
  });

  test('returns rows verbatim (SQL coerces title via COALESCE)', async () => {
    const row = { id: 's1', title: 'Hello', createdAt: 1, updatedAt: 2 };
    exec.enqueue({ rows: [row] });
    const result = await repo.listSessionsForUser('user-1', exec);
    expect(result).toEqual([row]);
  });
});

describe('createSession', () => {
  test('passes [id, userId, title] and inserts non-archived row', async () => {
    exec.enqueue({ rows: [] });
    await repo.createSession('s1', 'user-1', 'My Title', exec);
    expect(exec.calls[0].params).toEqual(['s1', 'user-1', 'My Title']);
    expect(exec.calls[0].sql).toContain('INSERT INTO report_chat_sessions');
    expect(exec.calls[0].sql).toContain('FALSE, CURRENT_TIMESTAMP');
  });
});

describe('archiveSession', () => {
  test.each([
    [1, true],
    [0, false],
    [null, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await repo.archiveSession('s1', 'user-1', exec)).toBe(expected);
  });

  test('passes [id, userId] and sets is_archived = TRUE', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await repo.archiveSession('s1', 'user-1', exec);
    expect(exec.calls[0].params).toEqual(['s1', 'user-1']);
    expect(exec.calls[0].sql).toContain('SET is_archived = TRUE');
  });
});

describe('sessionExistsForUser', () => {
  test.each([
    [1, true],
    [0, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await repo.sessionExistsForUser('s1', 'user-1', exec)).toBe(expected);
  });
});

describe('getActiveSessionForUser', () => {
  test('returns null when no row found', async () => {
    exec.enqueue({ rows: [] });
    const result = await repo.getActiveSessionForUser('s1', 'user-1', exec);
    expect(result).toBeNull();
  });

  test('returns first row when found', async () => {
    exec.enqueue({ rows: [{ title: 'Hello' }] });
    const result = await repo.getActiveSessionForUser('s1', 'user-1', exec);
    expect(result).toEqual({ title: 'Hello' });
  });

  test('filters on is_archived = FALSE', async () => {
    exec.enqueue({ rows: [] });
    await repo.getActiveSessionForUser('s1', 'user-1', exec);
    expect(exec.calls[0].sql).toContain('is_archived = FALSE');
    expect(exec.calls[0].params).toEqual(['s1', 'user-1']);
  });
});

describe('updateSessionTitleAndTouch', () => {
  test('passes [id, candidateTitle, userId, DEFAULT_CHAT_TITLE]', async () => {
    exec.enqueue({ rows: [] });
    await repo.updateSessionTitleAndTouch('s1', 'user-1', 'New Title', exec);
    expect(exec.calls[0].params).toEqual(['s1', 'New Title', 'user-1', repo.DEFAULT_CHAT_TITLE]);
  });

  test('only overwrites title when blank or default — uses CASE clause', async () => {
    exec.enqueue({ rows: [] });
    await repo.updateSessionTitleAndTouch('s1', 'user-1', 'New', exec);
    expect(exec.calls[0].sql).toContain("BTRIM(title) = '' OR title = $4");
    expect(exec.calls[0].sql).toContain('LEFT($2, 80)');
  });
});

describe('touchSession', () => {
  test('updates only updated_at, scoped by user', async () => {
    exec.enqueue({ rows: [] });
    await repo.touchSession('s1', 'user-1', exec);
    expect(exec.calls[0].params).toEqual(['s1', 'user-1']);
    expect(exec.calls[0].sql).toContain('SET updated_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0].sql).not.toContain('is_archived');
  });
});

describe('listMessagesForSession', () => {
  test('without beforeMs uses 2-param query', async () => {
    exec.enqueue({ rows: [] });
    await repo.listMessagesForSession('s1', { beforeMs: null, limit: 30 }, exec);
    expect(exec.calls[0].params).toEqual(['s1', 30]);
    expect(exec.calls[0].sql).not.toContain('TO_TIMESTAMP');
  });

  test('with beforeMs uses 3-param query and TO_TIMESTAMP filter', async () => {
    exec.enqueue({ rows: [] });
    await repo.listMessagesForSession('s1', { beforeMs: 1700000000000, limit: 10 }, exec);
    expect(exec.calls[0].params).toEqual(['s1', 1700000000000, 10]);
    expect(exec.calls[0].sql).toContain('TO_TIMESTAMP($2 / 1000.0)');
  });

  test('maps row, coercing nulls and stringifying ids', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          content: 'hi',
          thoughtContent: null,
          createdAt: 1700000000000,
        },
      ],
    });
    const result = await repo.listMessagesForSession('s1', { beforeMs: null, limit: 10 }, exec);
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
    exec.enqueue({
      rows: [
        {
          id: 'm1',
          sessionId: 's1',
          role: '',
          content: '',
          thoughtContent: '',
          createdAt: 0,
        },
      ],
    });
    const [m] = await repo.listMessagesForSession('s1', { beforeMs: null, limit: 1 }, exec);
    expect(m.content).toBe('');
    expect(m.thoughtContent).toBeNull();
  });

  test('SQL COALESCEs role and content so the typed shape is accurate', async () => {
    exec.enqueue({ rows: [] });
    await repo.listMessagesForSession('s1', { beforeMs: null, limit: 1 }, exec);
    expect(exec.calls[0].sql).toContain("COALESCE(role, '')");
    expect(exec.calls[0].sql).toContain("COALESCE(content, '')");
  });
});

describe('listRecentMessages', () => {
  test('default limit is 20 and DESC order is preserved', async () => {
    exec.enqueue({ rows: [] });
    await repo.listRecentMessages('s1', {}, exec);
    expect(exec.calls[0].params).toEqual(['s1', 20]);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
  });

  test('custom limit is honored', async () => {
    exec.enqueue({ rows: [] });
    await repo.listRecentMessages('s1', { limit: 5 }, exec);
    expect(exec.calls[0].params).toEqual(['s1', 5]);
  });

  test('beforeOrAt filter switches to <= predicate with 3 params', async () => {
    exec.enqueue({ rows: [] });
    const cutoff = new Date('2026-01-01T00:00:00Z');
    await repo.listRecentMessages('s1', { beforeOrAt: cutoff, limit: 10 }, exec);
    expect(exec.calls[0].params).toEqual(['s1', cutoff, 10]);
    expect(exec.calls[0].sql).toContain('created_at <= $2');
  });

  test('SQL COALESCEs role and content so the typed shape is accurate', async () => {
    exec.enqueue({ rows: [] });
    await repo.listRecentMessages('s1', {}, exec);
    expect(exec.calls[0].sql).toContain("COALESCE(role, '')");
    expect(exec.calls[0].sql).toContain("COALESCE(content, '')");
  });
});

describe('insertUserMessage', () => {
  test('writes role=user with [id, sessionId, content]', async () => {
    exec.enqueue({ rows: [] });
    await repo.insertUserMessage('m1', 's1', 'hi', exec);
    expect(exec.calls[0].params).toEqual(['m1', 's1', 'hi']);
    expect(exec.calls[0].sql).toContain("'user'");
    expect(exec.calls[0].sql).toContain('CURRENT_TIMESTAMP');
  });
});

describe('insertAssistantMessage', () => {
  test('without createdAt: passes null as $5 so COALESCE falls through to CURRENT_TIMESTAMP', async () => {
    exec.enqueue({ rows: [] });
    await repo.insertAssistantMessage(
      { id: 'm1', sessionId: 's1', content: 'ok', thoughtContent: null },
      exec,
    );
    expect(exec.calls[0].params).toEqual(['m1', 's1', 'ok', null, null]);
    expect(exec.calls[0].sql).toContain('COALESCE($5::timestamptz, CURRENT_TIMESTAMP)');
  });

  test('with explicit createdAt: passes it through as $5', async () => {
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
      exec,
    );
    expect(exec.calls[0].params).toEqual(['m1', 's1', 'ok', 'thinking…', when]);
  });
});

describe('findUserMessage / findFirstAssistantAfter', () => {
  test('findUserMessage returns null when missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findUserMessage('m1', 's1', exec)).toBeNull();
  });

  test('findUserMessage maps created_at via SQL alias and returns first row', async () => {
    const when = new Date('2026-05-01T12:00:00Z');
    exec.enqueue({ rows: [{ id: 'm1', createdAt: when }] });
    const result = await repo.findUserMessage('m1', 's1', exec);
    expect(result).toEqual({ id: 'm1', createdAt: when });
    expect(exec.calls[0].sql).toContain("role = 'user'");
  });

  test('findFirstAssistantAfter returns null when no later message', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findFirstAssistantAfter('s1', new Date('2026-05-01'), exec)).toBeNull();
  });

  test('findFirstAssistantAfter passes [sessionId, afterDate] and orders ASC', async () => {
    exec.enqueue({ rows: [] });
    const when = new Date('2026-05-01T12:00:00Z');
    await repo.findFirstAssistantAfter('s1', when, exec);
    expect(exec.calls[0].params).toEqual(['s1', when]);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at ASC');
    expect(exec.calls[0].sql).toContain("role = 'assistant'");
  });
});

describe('deleteMessage / updateMessageContent', () => {
  test('deleteMessage passes id as $1', async () => {
    exec.enqueue({ rows: [] });
    await repo.deleteMessage('m1', exec);
    expect(exec.calls[0].params).toEqual(['m1']);
    expect(exec.calls[0].sql).toContain('DELETE FROM report_chat_messages');
  });

  test('updateMessageContent passes [content, id] in that order', async () => {
    exec.enqueue({ rows: [] });
    await repo.updateMessageContent('m1', 'new', exec);
    expect(exec.calls[0].params).toEqual(['new', 'm1']);
  });
});

describe('getFirstUserMessageContent', () => {
  test('returns empty string when no user message', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.getFirstUserMessageContent('s1', exec)).toBe('');
  });

  test('returns first user message content', async () => {
    exec.enqueue({ rows: [{ content: 'first ask' }] });
    expect(await repo.getFirstUserMessageContent('s1', exec)).toBe('first ask');
  });

  test('SQL filters role=user and orders ASC LIMIT 1', async () => {
    exec.enqueue({ rows: [] });
    await repo.getFirstUserMessageContent('s1', exec);
    expect(exec.calls[0].sql).toContain("role = 'user'");
    expect(exec.calls[0].sql).toContain('ORDER BY created_at ASC');
    expect(exec.calls[0].sql).toContain('LIMIT 1');
  });
});
