// Shared SQL-shape assertions for repo tests. Pulled out so the same regex doesn't drift
// across multiple test files asserting against the same emitted SQL.

/**
 * Extract the body of a `JOIN tasks t ON ...` clause from an emitted SQL string.
 *
 * Returns the ON-clause body (everything between `ON` and the next top-level `JOIN`/`WHERE`/
 * `GROUP` keyword), or `null` if no `JOIN tasks t` clause is present. Callers assert with
 * `expect(extractTasksJoinOn(sql)).not.toBeNull()` and then narrow with `!` for subsequent
 * `.toContain(...)` assertions.
 *
 * Used to verify that both branches of `timeEntriesTasksJoin` (matched FK and name fallback)
 * sit inside the same ON clause, OR-combined — substring presence anywhere in the SQL would
 * silently pass even if a regression moved one branch into a CTE or WHERE filter.
 *
 * **Limitation**: the lookahead `(?=\s+(?:JOIN|WHERE|GROUP)\b)` doesn't track nesting. If a
 * future ON clause contains a subquery like `EXISTS (SELECT 1 FROM x WHERE y)`, the inner
 * `WHERE` will prematurely terminate the match. Today's JOIN ON contains only column
 * comparisons so this is safe; switch to a balanced-paren walk if that ever changes.
 */
export const extractTasksJoinOn = (sql: string): string | null => {
  const match = sql.match(/JOIN\s+tasks\s+"?t"?\s+ON\s+([\s\S]*?)(?=\s+(?:JOIN|WHERE|GROUP)\b)/);
  return match ? match[1] : null;
};
