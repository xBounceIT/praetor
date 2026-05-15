import { mock } from 'bun:test';
import { TX_SENTINEL } from './txSentinel.ts';

// Returns a mock matching withDbTransaction's signature that invokes `cb` with `TX_SENTINEL`
// rather than `undefined`. Route tests use this so a repo call wrapped by a route in
// `withDbTransaction(async tx => repo.fn(args, tx))` lands as `repo.fn(args, TX_SENTINEL)`,
// while a repo call made outside a transaction lands as `repo.fn(args, undefined)`. Tests
// can then distinguish the two by asserting on the last positional arg — previously both
// paths produced `undefined`, so transaction-boundary contracts were invisible.
//
// We pick `TX_SENTINEL` (a unique symbol) rather than a real Drizzle instance to keep
// Bun's matcher diffs small; passing a full executor with its schema tree triggers an
// expensive serializer when an assertion mismatches, exhausting memory on Windows runs.
//
// Tests that previously overrode `withDbTransactionMock` to inject TX_SENTINEL no longer
// need to do so — it's now the default.
// Loose `tx: unknown` here — production `withDbTransaction`'s real signature is
// `(cb: (tx: DbExecutor) => Promise<T>) => Promise<T>`, but the mock stands in only for
// the value channel (the cb receives whatever we hand it). Loosening the test-side type
// lets per-test `mockImplementation` callers pass TX_SENTINEL or a real fake executor
// without a redundant `as unknown as DbExecutor` cast at every site.
type WithDbTransactionMockImpl = (
  cb: (tx: unknown) => unknown,
  config?: unknown,
) => Promise<unknown>;

export const makeWithDbTransactionMock = () => {
  const defaultImpl: WithDbTransactionMockImpl = async (cb) => cb(TX_SENTINEL);
  const withDbTransactionMock = mock(defaultImpl);
  // Tests reset all their mocks in a beforeEach loop (`m.mockReset()`), which wipes
  // implementations. Callers invoke this after `mockReset()` to restore the sentinel-passing
  // behavior, so the route under test sees `tx === TX_SENTINEL` and not `tx === undefined`.
  const resetWithDbTransactionMock = () => {
    withDbTransactionMock.mockImplementation(defaultImpl);
  };
  return { withDbTransactionMock, resetWithDbTransactionMock };
};
