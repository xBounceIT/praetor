import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import { recordFirstInteractiveLogin } from '../../services/firstLogin.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('recordFirstInteractiveLogin', () => {
  test('creates the RIL tip after successfully claiming the first login', async () => {
    exec.enqueue({ rows: [['user-1']], rowCount: 1 });
    exec.enqueue({ rows: [], rowCount: 1 });

    const claimed = await recordFirstInteractiveLogin(
      'user-1',
      { createRilPreferencesTip: true },
      testDb,
    );

    expect(claimed).toBe(true);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "users"');
    expect(exec.calls[1].sql.toLowerCase()).toContain('insert into "notifications"');
  });

  test('does not create another tip after the first login was already claimed', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });

    expect(
      await recordFirstInteractiveLogin('user-1', { createRilPreferencesTip: true }, testDb),
    ).toBe(false);
    expect(exec.calls).toHaveLength(1);
  });

  test('records ineligible users without creating an inaccessible RIL tip', async () => {
    exec.enqueue({ rows: [['user-1']], rowCount: 1 });

    expect(
      await recordFirstInteractiveLogin('user-1', { createRilPreferencesTip: false }, testDb),
    ).toBe(true);
    expect(exec.calls).toHaveLength(1);
  });
});
