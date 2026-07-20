import { describe, expect, test } from 'bun:test';

const cases = [
  {
    source: new URL('../../../components/sales/ClientQuotesView.tsx', import.meta.url),
    fieldId: 'client-quote-code',
  },
  {
    source: new URL('../../../components/sales/ClientOffersView.tsx', import.meta.url),
    fieldId: 'client-offer-code',
  },
  {
    source: new URL('../../../components/sales/SupplierQuotesView.tsx', import.meta.url),
    fieldId: 'supplier-quote-code',
  },
];

describe('revision code field layout', () => {
  for (const { source, fieldId } of cases) {
    test(`shows the revision beside the ${fieldId} label`, async () => {
      const componentSource = (await Bun.file(source).text()).replace(/\r\n/g, '\n');

      expect(componentSource).toMatch(
        new RegExp(
          `<div className="flex items-center gap-2">\\s*` +
            `<FieldLabel htmlFor="${fieldId}"[\\s\\S]*?revisionCode[\\s\\S]*?` +
            `</div>\\s*<Input\\s+id="${fieldId}"`,
        ),
      );
    });
  }
});
