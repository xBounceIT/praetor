import { describe, expect, test } from 'bun:test';
import { parseInsertValuesBlocks, parseSelectValuesBlocks } from './seedSqlParsing.ts';

describe('seed SQL parsing helpers', () => {
  test('the inline VALUES parser ignores INSERT ... SELECT statements', () => {
    const sql = `
      INSERT INTO target_table (id, resolved_name, quantity)
      SELECT v.id, source.name, v.quantity
      FROM (VALUES ('row-1', 'source-1', 3)) AS v(id, source_id, quantity)
      JOIN source_table source ON source.id = v.source_id;
    `;

    expect(parseInsertValuesBlocks(sql, 'target_table')).toEqual([]);
    expect(parseSelectValuesBlocks(sql, 'target_table')[0]?.rows).toEqual([
      { id: 'row-1', source_id: 'source-1', quantity: '3' },
    ]);
  });

  test('rejects malformed inline VALUES tuple arity', () => {
    const sql = `INSERT INTO target_table (id, name) VALUES ('row-1');`;
    expect(() => parseInsertValuesBlocks(sql, 'target_table')).toThrow(/expected 2 values, got 1/);
  });

  test('rejects malformed INSERT ... SELECT tuple arity', () => {
    const sql = `
      INSERT INTO target_table (id, quantity)
      SELECT v.id, v.quantity
      FROM (VALUES ('row-1')) AS v(id, quantity);
    `;
    expect(() => parseSelectValuesBlocks(sql, 'target_table')).toThrow(/expected 2 values, got 1/);
  });
  test('keeps semicolons inside inline VALUES string literals', () => {
    const sql = `
      INSERT INTO target_table (id, note)
      VALUES ('row-1', 'review; follow-up');
    `;

    expect(parseInsertValuesBlocks(sql, 'target_table')).toEqual([
      { id: 'row-1', note: 'review; follow-up' },
    ]);
  });

  test('keeps semicolons inside INSERT ... SELECT string literals', () => {
    const sql = `
      INSERT INTO target_table (id, note)
      SELECT v.id, v.note
      FROM (VALUES ('row-1', 'review; follow-up')) AS v(id, note);
    `;

    expect(parseSelectValuesBlocks(sql, 'target_table')[0]?.rows).toEqual([
      { id: 'row-1', note: 'review; follow-up' },
    ]);
  });
});
