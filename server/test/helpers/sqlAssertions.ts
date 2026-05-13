// Shared SQL-shape assertions for repo tests. Pulled out so the same regex doesn't drift
// across multiple test files asserting against the same emitted SQL.

/**
 * Extract the body of a `JOIN <table> <alias> ON ...` clause from an emitted SQL string.
 *
 * Returns the ON-clause body (everything between `ON` and the next top-level `JOIN`/`WHERE`/
 * `GROUP` keyword), or `null` if no matching JOIN clause is present.
 *
 * Intended call shape:
 * ```ts
 * const onClause = extractJoinOn(sql, 'tasks', 't');
 * expect(onClause).not.toBeNull();
 * expect(onClause).toContain('"t"."id" = "te"."task_id"');
 * ```
 * `expect()` accepts `null`, so subsequent matchers work without explicit `!` narrowing -
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

/**
 * Extract the body of the `JOIN LATERAL ( <body> ) <alias>` subquery used by
 * `timeEntriesTasksJoin`. Returns the parenthesized subquery body (excluding outer parens),
 * or `null` if no matching LATERAL join with the expected alias is present.
 *
 * The lookup predicate (`t_inner.id = te.task_id OR (te.task_id IS NULL AND ...)`) lives in
 * the subquery's WHERE clause, not in the outer JOIN's ON (which is `ON TRUE`). Tests assert
 * against the extracted body to constrain the predicate to the join-resolution context.
 *
 * Uses a balanced-paren walk from the first `(` after `JOIN LATERAL`, so nested parentheses
 * inside the subquery (e.g. the ORDER BY tuple comparison) are handled correctly.
 */
const extractLateralBody = (sql: string, alias: string): string | null => {
  const startMatch = sql.match(/JOIN\s+LATERAL\s*\(/i);
  if (!startMatch || startMatch.index === undefined) return null;
  const openIdx = sql.indexOf('(', startMatch.index);
  if (openIdx === -1) return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < sql.length && depth > 0) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  const body = sql.slice(openIdx + 1, i);
  // Verify the LATERAL is aliased to the expected name (e.g. `) t ON TRUE`).
  const aliasRe = new RegExp(`^\\s*"?${escapeRegExp(alias)}"?\\s+ON\\b`, 'i');
  if (!aliasRe.test(sql.slice(i + 1))) return null;
  return body;
};

/**
 * Convenience wrapper for the `tasks t` LATERAL subquery used by `timeEntriesTasksJoin`
 * and its callers. Returns the WHERE-clause body of the subquery, which contains the
 * `t_inner.id = te.task_id OR (te.task_id IS NULL AND ...)` predicate. Falls back to the
 * full subquery body when the WHERE substring can't be isolated, so callers' `.toContain`
 * assertions still see the predicate text.
 */
export const extractTasksJoinOn = (sql: string): string | null => {
  const body = extractLateralBody(sql, 't');
  if (!body) return null;
  const m = body.match(/WHERE\s+([\s\S]*?)(?=\s+(?:ORDER|LIMIT|GROUP)\b|\s*$)/i);
  return m ? m[1] : body;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
