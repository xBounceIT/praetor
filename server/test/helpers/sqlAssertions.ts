// Shared SQL-shape assertions for repo tests. Pulled out so the same regex doesn't drift
// across multiple test files asserting against the same emitted SQL.

/**
 * Extract the body of a `JOIN <table> <alias> ON ...` clause from an emitted SQL string.
 *
 * Returns the ON-clause body (everything between `ON` and the next top-level `JOIN`/`WHERE`/
 * `GROUP` keyword), or `null` if no matching JOIN clause is present.
 *
 * Intended call shape (used by both `tasksRepo.test.ts` and `reportsHoursRepo.test.ts`):
 * ```ts
 * const onClause = extractJoinOn(sql, 'tasks', 't');
 * expect(onClause).not.toBeNull();
 * expect(onClause).toContain('"t"."id" = "te"."task_id"');
 * ```
 * `expect()` accepts `null`, so subsequent matchers work without explicit `!` narrowing —
 * the `not.toBeNull()` assertion guarantees the call never reaches them when the regex misses.
 *
 * **Limitation**: the lookahead `(?=\s+(?:JOIN|WHERE|GROUP)\b)` doesn't track nesting. If a
 * future ON clause contains a subquery like `EXISTS (SELECT 1 FROM x WHERE y)`, the inner
 * `WHERE` will prematurely terminate the match. Today's JOIN ONs contain only column
 * comparisons so this is safe; switch to a balanced-paren walk if that ever changes.
 */
export const extractJoinOn = (sql: string, tableName: string, alias: string): string | null => {
  // Drizzle quotes identifiers; raw SQL chunks may not. Match either form for both the table
  // name and its alias to keep the helper robust across the mixed-mode period of the migration.
  const t = escapeRegExp(tableName);
  const a = escapeRegExp(alias);
  const re = new RegExp(
    `JOIN\\s+"?${t}"?\\s+"?${a}"?\\s+ON\\s+([\\s\\S]*?)(?=\\s+(?:JOIN|WHERE|GROUP)\\b)`,
  );
  const match = sql.match(re);
  return match ? match[1] : null;
};

/** Convenience wrapper for the `tasks t` join used by `timeEntriesTasksJoin` and its callers. */
export const extractTasksJoinOn = (sql: string): string | null => extractJoinOn(sql, 'tasks', 't');

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
