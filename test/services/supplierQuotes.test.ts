import { describe, expect, test } from 'bun:test';

describe('supplierQuotesApi path segments', () => {
  test('uses encoded helper paths for quote and revision identifiers', async () => {
    const source = await Bun.file(
      new URL('../../services/api/supplierQuotes.ts', import.meta.url),
    ).text();

    expect(source).not.toMatch(/\$\{(?:id|revisionId)\}/);
    expect(source.match(/supplierQuotePath\(id\)/g) ?? []).toHaveLength(12);
    expect(source.match(/encodePathSegment\(revisionId\)/g) ?? []).toHaveLength(2);
  });
});
