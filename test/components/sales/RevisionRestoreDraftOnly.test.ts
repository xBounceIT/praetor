import { describe, expect, test } from 'bun:test';

const readSource = async (path: string) =>
  (await Bun.file(new URL(`../../../components/sales/${path}`, import.meta.url)).text()).replace(
    /\r\n/g,
    '\n',
  );

describe('revision restore draft-only UI guard', () => {
  test('customer quotes require draft status in addition to existing read-only constraints', async () => {
    const source = await readSource('ClientQuotesView.tsx');
    expect(source).toContain("baseReadOnly || editingQuote?.status !== 'draft'");
  });

  test('customer offers use the effective draft-only read-only guard', async () => {
    const source = await readSource('ClientOffersView.tsx');
    expect(source).toContain('const revisionRestoreDisabled = baseReadOnly;');
  });

  test('supplier quotes require effective draft status and no linked order', async () => {
    const source = await readSource('SupplierQuotesView.tsx');
    expect(source).toContain('controller.baseReadOnly || controller.editingQuote?.linkedOrderId');
  });
});
