import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as ssoStatesRepo from '../../repositories/ssoStatesRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('removeForProvider', () => {
  test('atomically consumes only an unexpired provider-scoped state', async () => {
    exec.enqueue({ rows: [['relay-state']] });

    await expect(
      ssoStatesRepo.removeForProvider('request-id', 'provider-1', 'saml', testDb),
    ).resolves.toBe('relay-state');

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('delete from "sso_states"');
    expect(sql).toContain('"state" =');
    expect(sql).toContain('"provider_id" =');
    expect(sql).toContain('"protocol" =');
    expect(sql).toContain('"expires_at" >');
  });

  test('returns null when no unexpired state is consumed', async () => {
    exec.enqueue({ rows: [] });

    await expect(
      ssoStatesRepo.removeForProvider('expired-request-id', 'provider-1', 'saml', testDb),
    ).resolves.toBeNull();
  });
});
