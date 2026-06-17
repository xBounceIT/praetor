import type { SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.ts';

// Shared sentinel for regression tests that assert a repo helper was invoked with the tx
// supplied by withDbTransaction (and not, say, `undefined` or `db`). Tests inject this
// sentinel by overriding their local withDbTransactionMock to pass TX_SENTINEL into the
// callback, then assert the repo mock's last positional arg === TX_SENTINEL.
//
// Keep the object intentionally tiny: it preserves identity assertions while supporting the
// raw-SQL helpers that call `exec.execute(...)` inside mocked route transactions.
export const TX_SENTINEL = {
  async execute(_query: SQL) {
    return { rows: [], rowCount: 0 };
  },
} as unknown as DbExecutor;
