import { describe, expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  clientOfferNetValueSql,
  orderNetValueSql,
  quoteNetValueSql,
  supplierOrderNetValueSql,
  supplierQuoteNetValueSql,
} from '../../repositories/reportsCommercialSql.ts';

const dialect = new PgDialect();

describe('commercial report duration multiplier', () => {
  test.each([
    ['client quote', quoteNetValueSql],
    ['client offer', clientOfferNetValueSql],
    ['client order', orderNetValueSql],
    ['supplier quote', supplierQuoteNetValueSql],
    ['supplier order', supplierOrderNetValueSql],
  ])('%s applies the complete months/years/N-A duration rule', (_name, expression) => {
    const { sql: text } = dialect.sqlToQuery(expression as SQL);
    const normalizedSql = text.replace(/\s+/g, ' ');
    expect(normalizedSql).toMatch(
      /CASE WHEN \w+\.duration_unit = 'na' THEN 1 WHEN \w+\.pricing_semantics_version = 1 THEN COALESCE\(\w+\.duration_months, 1\) WHEN \w+\.duration_unit = 'years' THEN COALESCE\(\w+\.duration_months, 12\) \/ 12\.0 ELSE COALESCE\(\w+\.duration_months, 1\) END/i,
    );
  });
});
