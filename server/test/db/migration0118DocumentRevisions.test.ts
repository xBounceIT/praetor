import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';

const migration = readFileSync(
  new URL('../../db/migrations/0118_add_document_revisions.sql', import.meta.url),
  'utf8',
);

describe('0118 document revisions migration', () => {
  test('creates separate immutable histories and per-object uniqueness', () => {
    for (const table of ['quote_revisions', 'offer_revisions', 'supplier_quote_revisions']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain('"quote_id","revision_number"');
    expect(migration).toContain('"offer_id","revision_number"');
  });

  test('backfills REV1 only for progressed customer documents', () => {
    expect(migration).toContain("WHERE q.status <> 'draft'");
    expect(migration).toContain("WHERE o.status <> 'draft'");
    expect(migration).toContain("SET revision_number = 1, revision_code = 'REV1'");
    expect(migration).toContain('revisable_supplier_quotes');
  });

  test('adds high-water consistency constraints and the default template', () => {
    expect(migration).toContain("VALUES ('default', 'REV', '{PREFIX}{SEQ}', 1)");
    expect(migration).toContain('chk_revision_code_template_sequence');
    expect(migration).toContain("LIKE '%{SEQ}%'");
    expect(migration).toContain('"revision_number" = 0');
    expect(migration).toContain('"revision_number" > 0');
  });
});
