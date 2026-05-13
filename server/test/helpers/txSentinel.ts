// Shared sentinel for regression tests that assert a repo helper was invoked with the tx
// supplied by withDbTransaction (and not, say, `undefined` or `db`). Tests inject this
// sentinel by overriding their local withDbTransactionMock to pass TX_SENTINEL into the
// callback, then assert the repo mock's last positional arg === TX_SENTINEL. Using a
// single shared symbol keeps the rollback-boundary contract identical across tests.
export const TX_SENTINEL: unique symbol = Symbol('tx-sentinel');
