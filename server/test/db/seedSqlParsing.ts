// Shared helpers for statically parsing server/db/seed.sql in tests (no database needed).
// The seed file is plain SQL, so these walk the text while respecting `'…''…'` string
// literals and nested parentheses. Used by seedTaskReferences.test.ts and
// seedProjectCoherence.test.ts.

import {
  DOCUMENT_CODE_MODULES,
  isDocumentCodeModuleId,
  renderDocumentCode,
} from '../../utils/document-codes.ts';

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
  const documentCode = trimmed.match(/^pg_temp\.demo_document_code\('([^']+)',\s*(\d+)\)$/);
  if (documentCode) {
    const moduleId = documentCode[1];
    if (isDocumentCodeModuleId(moduleId)) {
      return renderDocumentCode(DOCUMENT_CODE_MODULES[moduleId], {
        year: new Date().getFullYear(),
        sequence: Number(documentCode[2]),
      });
    }
  }
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

// Find the next statement terminator or selected top-level keyword without treating content
// inside string literals or nested expressions as SQL structure.
const findSqlBoundary = (sql: string, start: number, keywords: readonly string[] = []): number => {
  let depth = 0;
  let inString = false;
  for (let i = start; i < sql.length; i += 1) {
    const char = sql[i];
    if (inString) {
      if (char === "'") {
        if (sql[i + 1] === "'") {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (char === ';') return i;
    for (const keyword of keywords) {
      if (sql.slice(i, i + keyword.length).toUpperCase() === keyword) return i;
    }
  }
  return sql.length;
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

export type InsertTarget = {
  table: string;
  columns: string[];
};

// Return the target table and column list for every INSERT in seed.sql, regardless of whether
// the rows come from inline VALUES or INSERT ... SELECT. This lets schema-drift tests cover the
// complete seed surface instead of maintaining a table-by-table allowlist.
export const parseInsertTargets = (sql: string): InsertTarget[] => {
  const targets: InsertTarget[] = [];
  const header = /INSERT\s+INTO\s+([a-z_]+)\s*\(/gi;
  let match: RegExpExecArray | null = header.exec(sql);
  while (match !== null) {
    const columnsOpen = match.index + match[0].length - 1;
    const columnsClose = matchParen(sql, columnsOpen);
    targets.push({
      table: match[1],
      columns: splitTopLevelCommas(sql.slice(columnsOpen + 1, columnsClose)),
    });
    header.lastIndex = columnsClose + 1;
    match = header.exec(sql);
  }
  return targets;
};

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
    const columns = splitTopLevelCommas(sql.slice(colsOpen + 1, colsClose));

    const afterColumns = sql.slice(colsClose + 1);
    const valuesMatch = /^\s*VALUES\b/i.exec(afterColumns);
    if (!valuesMatch) {
      header.lastIndex = colsClose + 1;
      match = header.exec(sql);
      continue;
    }
    const valuesKw =
      colsClose + 1 + requirePosition('VALUES keyword', valuesMatch[0].search(/VALUES/i));
    const end = findSqlBoundary(sql, valuesKw + 'VALUES'.length, ['ON CONFLICT']);

    for (const tuple of extractTopLevelTuples(sql.slice(valuesKw + 'VALUES'.length, end))) {
      if (tuple.length !== columns.length) {
        throw new Error(
          `seed.sql: ${table} INSERT expected ${columns.length} values, got ${tuple.length}`,
        );
      }
      const row: ParsedRow = {};
      columns.forEach((col, idx) => {
        row[col] = unquote(tuple[idx]);
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
    const boundedStatementEnd = findSqlBoundary(sql, insertIdx);

    fromValuesRe.lastIndex = insertIdx;
    const fromValues = fromValuesRe.exec(sql);
    if (!fromValues || fromValues.index >= boundedStatementEnd) {
      cursor = boundedStatementEnd + 1;
      continue;
    }
    const bodyStart = fromValues.index + fromValues[0].length;

    // The first `) AS v(` after the VALUES body is the `)` that closes `FROM (`.
    aliasRe.lastIndex = bodyStart;
    const alias = aliasRe.exec(sql);
    if (!alias || alias.index >= boundedStatementEnd) {
      cursor = boundedStatementEnd + 1;
      continue;
    }
    const aliasColsStart = alias.index + alias[0].length;
    const aliasClose = requirePosition("')' closing AS v(...)", sql.indexOf(')', aliasColsStart));
    const aliasColumns = sql
      .slice(aliasColsStart, aliasClose)
      .split(',')
      .map((s) => s.trim());

    const body = sql.slice(bodyStart, alias.index);
    const rows = extractTopLevelTuples(body).map((tuple) => {
      if (tuple.length !== aliasColumns.length) {
        throw new Error(
          `seed.sql: ${table} VALUES alias expected ${aliasColumns.length} values, got ${tuple.length}`,
        );
      }
      const row: ParsedRow = {};
      aliasColumns.forEach((col, idx) => {
        row[col] = unquote(tuple[idx]);
      });
      return row;
    });
    blocks.push({ aliasColumns, rows });
    cursor = boundedStatementEnd + 1;
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
