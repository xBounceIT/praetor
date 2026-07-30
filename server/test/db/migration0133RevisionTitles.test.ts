import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../db/migrations/0133_add_revision_titles.sql', import.meta.url),
  'utf8',
);

describe('0133 revision titles migration', () => {
  test('adds a nullable bounded title without rewriting existing snapshots', () => {
    for (const table of ['quote_revisions', 'offer_revisions', 'supplier_quote_revisions']) {
      expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "title" varchar(200)`);
    }
    expect(migration).not.toContain('NOT NULL');
    expect(migration).not.toContain('UPDATE ');
  });
});
