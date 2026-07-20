import { describe, expect, test } from 'bun:test';
import { encodePathSegment } from '../../services/api/path';

describe('clientQuotesApi path construction', () => {
  test('encodes traversal input as exactly one path segment', () => {
    expect(encodePathSegment('../../products/product-1')).toBe('..%2F..%2Fproducts%2Fproduct-1');
    expect(encodePathSegment('../users/user-1')).toBe('..%2Fusers%2Fuser-1');
  });

  test('keeps dot-only quote and version ids inside the intended route', () => {
    const pathname = new URL(
      `/api/sales/client-quotes/${encodePathSegment('..')}/versions/${encodePathSegment('.')}`,
      'https://praetor.test',
    ).pathname;

    expect(pathname).toBe(
      `/api/sales/client-quotes/${'~'.repeat(101)}../versions/${'~'.repeat(101)}.`,
    );
  });

  test('protects every dynamic quote and version path interpolation', async () => {
    const source = await Bun.file(
      new URL('../../services/api/clientQuotes.ts', import.meta.url),
    ).text();

    expect(source).not.toMatch(/\$\{(?:id|versionId)\}/);
    expect(source.match(/encodePathSegment\(id\)/g) ?? []).toHaveLength(7);
    expect(source.match(/encodePathSegment\(versionId\)/g) ?? []).toHaveLength(2);
  });
});
