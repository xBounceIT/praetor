import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_CUSTOMER_OFFERS,
  DEMO_EXPECTED_COUNTS,
  DEMO_QUOTES,
} from '../../db/demoSeedManifest.ts';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const revisionInsertBlock = (table: string) => {
  const start = SEED_SQL.indexOf(`INSERT INTO ${table} (`);
  if (start === -1) throw new Error(`Missing ${table} insert in seed.sql`);
  // Take through the first ON CONFLICT that closes the baseline REV1 insert.
  const conflict = SEED_SQL.indexOf('ON CONFLICT', start);
  if (conflict === -1) throw new Error(`Missing ON CONFLICT for ${table}`);
  const end = SEED_SQL.indexOf(';', conflict);
  if (end === -1) throw new Error(`Unterminated ${table} insert in seed.sql`);
  return SEED_SQL.slice(start, end + 1);
};

describe('seed.sql revision snapshots stay aligned with live writers', () => {
  test('quote_revisions snapshots include description and pricingSemanticsVersion', () => {
    const block = revisionInsertBlock('quote_revisions');
    expect(block).toContain("'description', q.description");
    expect(block).toContain("'pricingSemanticsVersion', i.pricing_semantics_version");
    expect(block).toContain("'schemaVersion', 2");
  });

  test('offer_revisions snapshots include description and pricingSemanticsVersion', () => {
    const block = revisionInsertBlock('offer_revisions');
    expect(block).toContain("'description', o.description");
    expect(block).toContain("'pricingSemanticsVersion', i.pricing_semantics_version");
    expect(block).toContain("'schemaVersion', 1");
  });

  test('supplier_quote_revisions snapshots include description and pricingSemanticsVersion', () => {
    const block = revisionInsertBlock('supplier_quote_revisions');
    expect(block).toContain("'description', sq.description");
    expect(block).toContain("'pricingSemanticsVersion', i.pricing_semantics_version");
    expect(block).toContain("'schemaVersion', 1");
  });
});

describe('seed.sql showcase multi-revision demo', () => {
  test('PREV/OFF/FORN #02 advance to REV2 after seeding a second timeline entry', () => {
    expect(SEED_SQL).toContain('pg_temp.age_demo_revision_snapshot');
    expect(SEED_SQL).toContain("demo_document_code('client_quote', 2)");
    expect(SEED_SQL).toContain("demo_document_code('client_offer', 2)");
    expect(SEED_SQL).toContain("demo_document_code('supplier_quote', 2)");
    expect(SEED_SQL).toContain("'dm_qr2_' || md5(q.id), 2, 'REV2'");
    expect(SEED_SQL).toContain("'dm_or2_' || md5(o.id), 2, 'REV2'");
    expect(SEED_SQL).toContain("'dm_sqr2_' || md5(sq.id), 2, 'REV2'");
    expect(SEED_SQL).toContain("revision_code = 'REV2'");
  });

  test('manifest expected revision counts include the three showcase REV2 rows', () => {
    expect(DEMO_EXPECTED_COUNTS.quote_revisions).toBe(DEMO_QUOTES.length);
    expect(DEMO_EXPECTED_COUNTS.offer_revisions).toBe(DEMO_CUSTOMER_OFFERS.length);
    expect(DEMO_EXPECTED_COUNTS.supplier_quote_revisions).toBe(13);
  });
});
