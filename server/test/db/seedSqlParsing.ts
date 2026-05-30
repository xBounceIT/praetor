// Shared helpers for statically parsing server/db/seed.sql in tests (no database needed).
// The seed file is plain SQL, so these walk the text while respecting `'…''…'` string
// literals and nested parentheses. Used by seedTaskReferences.test.ts and
// seedProjectCoherence.test.ts.

type TopLevelEvent = { type: 'comma' | 'open' | 'close'; index: number };

// Walk a SQL fragment yielding top-level commas and the outer `(...)` boundaries while
// respecting `'…''…'` strings and nested parens. Internal primitive the exported parsers
// build on; not consumed directly by tests.
function* walkSqlTopLevel(input: string): Generator<TopLevelEvent> {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inString) {
      if (c === "'") {
        if (input[i + 1] === "'") {
          i += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === '(') {
      if (depth === 0) yield { type: 'open', index: i };
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) yield { type: 'close', index: i };
    } else if (c === ',' && depth === 0) {
      yield { type: 'comma', index: i };
    }
  }
}

const splitTopLevelCommas = (input: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  for (const evt of walkSqlTopLevel(input)) {
    if (evt.type !== 'comma') continue;
    parts.push(input.slice(start, evt.index));
    start = evt.index + 1;
  }
  parts.push(input.slice(start));
  return parts.map((s) => s.trim());
};

// Strip the surrounding single quotes (and un-double `''`) from a SQL literal. Non-string
// cells (NULL, numbers, expressions) are returned trimmed as-is.
export const unquote = (value: string): string => {
  const trimmed = value.trim();
  const m = trimmed.match(/^'((?:''|[^'])*)'$/);
  return m ? m[1].replace(/''/g, "'") : trimmed;
};

// Given the body between a `VALUES`/`FROM (VALUES` keyword and the statement end, return one
// array of raw (still-quoted) cell strings per `(...)` tuple.
export const extractTopLevelTuples = (body: string): string[][] => {
  const tuples: string[][] = [];
  let start = -1;
  for (const evt of walkSqlTopLevel(body)) {
    if (evt.type === 'open') {
      start = evt.index + 1;
    } else if (evt.type === 'close' && start !== -1) {
      tuples.push(splitTopLevelCommas(body.slice(start, evt.index)));
      start = -1;
    }
  }
  return tuples;
};

const requirePosition = (label: string, idx: number): number => {
  if (idx === -1) throw new Error(`seed.sql: failed to locate ${label}`);
  return idx;
};

// Match the closing paren for the `(` at `openIdx`, respecting strings and nesting. Reuses
// walkSqlTopLevel's state machine: its first top-level 'close' event is this paren's match.
const matchParen = (sql: string, openIdx: number): number => {
  for (const evt of walkSqlTopLevel(sql.slice(openIdx))) {
    if (evt.type === 'close') return openIdx + evt.index;
  }
  throw new Error(`seed.sql: unbalanced parenthesis starting at ${openIdx}`);
};

export type ParsedRow = Record<string, string>;

// Parse every `INSERT INTO <table> (cols) VALUES (...), (...)` block whose values are inline
// literal tuples (clients, projects, customer_offers, sales, …). Returns one record per
// tuple, keyed by column name with `unquote`d values. Blocks that feed VALUES through a
// `SELECT … FROM (VALUES …)` projection (e.g. quote_items) are not handled here — use
// parseSelectValuesBlocks for those.
export const parseInsertValuesBlocks = (sql: string, table: string): ParsedRow[] => {
  const rows: ParsedRow[] = [];
  const header = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(`, 'gi');
  let match: RegExpExecArray | null = header.exec(sql);
  while (match !== null) {
    const colsOpen = match.index + match[0].length - 1;
    const colsClose = matchParen(sql, colsOpen);
    const columns = splitTopLevelCommas(sql.slice(colsOpen + 1, colsClose)).map((c) => c.trim());

    const valuesKw = requirePosition(
      'VALUES keyword',
      sql.toUpperCase().indexOf('VALUES', colsClose),
    );
    const onConflict = sql.toUpperCase().indexOf('ON CONFLICT', valuesKw);
    const semicolon = sql.indexOf(';', valuesKw);
    const endCandidates = [onConflict, semicolon].filter((idx) => idx !== -1);
    const end = endCandidates.length > 0 ? Math.min(...endCandidates) : sql.length;

    for (const tuple of extractTopLevelTuples(sql.slice(valuesKw + 'VALUES'.length, end))) {
      const row: ParsedRow = {};
      columns.forEach((col, idx) => {
        if (idx < tuple.length) row[col] = unquote(tuple[idx]);
      });
      rows.push(row);
    }
    match = header.exec(sql);
  }
  return rows;
};

export type SelectValuesBlock = { aliasColumns: string[]; rows: ParsedRow[] };

// Parse every `INSERT INTO <table> ... FROM (VALUES (...), ...) AS v(col, col, …)` block.
// Returns the alias column names and one record per tuple keyed by those names. This is the
// shape used by both time_entries blocks in seed.sql.
export const parseSelectValuesBlocks = (sql: string, table: string): SelectValuesBlock[] => {
  const blocks: SelectValuesBlock[] = [];
  // Whitespace-tolerant: seed.sql writes `FROM (VALUES` inline for time_entries but
  // `FROM (\n    VALUES` for quote_items/sale_items/etc.
  const fromValuesRe = /FROM\s*\(\s*VALUES/gi;
  const aliasRe = /\)\s*AS\s+v\s*\(/gi;
  let cursor = 0;
  while (cursor < sql.length) {
    const insertIdx = sql.indexOf(`INSERT INTO ${table}`, cursor);
    if (insertIdx === -1) break;

    fromValuesRe.lastIndex = insertIdx;
    const fromValues = fromValuesRe.exec(sql);
    if (!fromValues) break;
    const bodyStart = fromValues.index + fromValues[0].length;

    // The first `) AS v(` after the VALUES body is the `)` that closes `FROM (`.
    aliasRe.lastIndex = bodyStart;
    const alias = aliasRe.exec(sql);
    if (!alias) break;
    const aliasColsStart = alias.index + alias[0].length;
    const aliasClose = requirePosition("')' closing AS v(...)", sql.indexOf(')', aliasColsStart));
    const aliasColumns = sql
      .slice(aliasColsStart, aliasClose)
      .split(',')
      .map((s) => s.trim());

    const body = sql.slice(bodyStart, alias.index);
    const rows = extractTopLevelTuples(body).map((tuple) => {
      const row: ParsedRow = {};
      aliasColumns.forEach((col, idx) => {
        if (idx < tuple.length) row[col] = unquote(tuple[idx]);
      });
      return row;
    });
    blocks.push({ aliasColumns, rows });
    cursor = aliasClose;
  }
  return blocks;
};

// Resolve a date expression cell to a day offset relative to CURRENT_DATE.
// `CURRENT_DATE` → 0, `CURRENT_DATE - INTERVAL '18 days'` → -18,
// `(CURRENT_DATE + INTERVAL '30 days')::date` → 30. Returns null for unrecognized cells.
export const dateOffsetDays = (cell: string | undefined): number | null => {
  if (!cell) return null;
  const m = cell.match(/CURRENT_DATE\s*([+-])\s*INTERVAL\s*'(\d+)\s*days?'/i);
  if (m) return (m[1] === '-' ? -1 : 1) * Number(m[2]);
  if (/CURRENT_DATE/i.test(cell) && !/INTERVAL/i.test(cell)) return 0;
  return null;
};
