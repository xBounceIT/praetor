import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as mcpTokensRepo from '../../repositories/mcpTokensRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

// hashToken (HMAC-keyed) requires ENCRYPTION_KEY at call time.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('createForUser', () => {
  test('captures the user current token_version via subquery, not the column default', async () => {
    // RETURNING row shape — positional, matches mcpTokens schema declaration order:
    // id, user_id, name, token_prefix, token_hash, scope, created_at, last_used_at,
    // revoked_at, token_version_at_issue
    exec.enqueue({
      rows: [
        [
          'mcp-token-1',
          'user-1',
          'Agent',
          'praetor_mcp_abcdefghij',
          'h'.repeat(64),
          'full',
          new Date('2026-05-16T10:00:00.000Z'),
          null,
          null,
          5,
        ],
      ],
      rowCount: 1,
    });

    await mcpTokensRepo.createForUser(
      {
        id: 'mcp-token-1',
        userId: 'user-1',
        name: 'Agent',
        rawToken: `${mcpTokensRepo.MCP_TOKEN_PREFIX}abcdefghijklmnopqrstuvwx`,
        scope: 'full',
      },
      testDb,
    );

    // The INSERT must reference users.token_version inline rather than relying on
    // the column default — otherwise a token issued in the same window as a
    // password rotation could be born with a stale snapshot.
    const sql = exec.calls[0].sql;
    expect(sql).toContain('"token_version"');
    expect(sql).toContain('"users"');
    expect(exec.calls[0].params).toContain('user-1');
  });
});
