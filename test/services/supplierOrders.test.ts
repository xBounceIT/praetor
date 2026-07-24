import { describe, expect, test } from 'bun:test';
import { encodePathSegment } from '../../services/api/path';

describe('supplierOrdersApi path construction', () => {
  test('keeps crafted order and version ids inside the intended route', () => {
    const pathname = new URL(
      `/api/accounting/supplier-orders/${encodePathSegment('../supplier-invoices/SINV-1?')}/versions/${encodePathSegment('..')}`,
      'https://praetor.test',
    ).pathname;

    expect(pathname).toBe(
      `/api/accounting/supplier-orders/..%2Fsupplier-invoices%2FSINV-1%3F/versions/${'~'.repeat(101)}..`,
    );
  });

  test('protects every dynamic order and version path interpolation', async () => {
    const source = await Bun.file(
      new URL('../../services/api/supplierOrders.ts', import.meta.url),
    ).text();

    expect(source).not.toMatch(/\$\{(?:id|versionId)\}/);
    expect(source.match(/supplierOrderPath\(id\)/g) ?? []).toHaveLength(5);
    expect(source.match(/encodePathSegment\(versionId\)/g) ?? []).toHaveLength(2);
  });
});
