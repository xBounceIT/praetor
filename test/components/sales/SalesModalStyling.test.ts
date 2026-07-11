import { describe, expect, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('sales modal styling', () => {
  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx', 'client-quote-notes'],
    ['client offers', 'sales/ClientOffersView.tsx', 'client-offer-notes'],
    ['supplier quotes', 'sales/SupplierQuotesView.tsx', 'supplier-quote-notes'],
  ])('%s modal uses shared shadcn modal layout and primitives', async (_name, path, notesId) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="full"',
      '<ModalBody className="flex-1 space-y-5">',
      '<ModalFooter>',
      `id="${notesId}"`,
      "summary', { defaultValue: 'Summary' })",
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl bg-white', '<textarea']);
  });

  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx', 'client-quote-notes'],
    ['client offers', 'sales/ClientOffersView.tsx', 'client-offer-notes'],
    ['supplier quotes', 'sales/SupplierQuotesView.tsx', 'supplier-quote-notes'],
  ])('%s notes section header matches other modal section headers', async (_name, path, notesId) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">',
      `<FieldLabel htmlFor="${notesId}" className="sr-only">`,
      `id="${notesId}"`,
      "description={t('sales:fieldInfo.notes'",
    ]);
  });

  test.each([
    [
      'client quotes',
      'sales/ClientQuotesView.tsx',
      "useDocumentCodePreview('client_quote'",
      'clientQuoteCodePreview ??',
    ],
    [
      'client offers',
      'sales/ClientOffersView.tsx',
      "useDocumentCodePreview('client_offer'",
      'clientOfferCodePreview ??',
    ],
    [
      'supplier quotes',
      'sales/SupplierQuotesView.tsx',
      "useDocumentCodePreview('supplier_quote'",
      'supplierQuoteCodePreview ??',
    ],
  ])('%s code field shows the next document-code preview when blank', async (_name, path, hookSnippet, placeholderSnippet) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      hookSnippet,
      placeholderSnippet,
      'autoCodePreviewDescription',
    ]);
  });

  test('supplier quote attachment section header matches other modal section headers', async () => {
    const source = await readComponentSource('sales/SupplierQuoteAttachmentsSection.tsx');

    expectSourceContainsAll(source, [
      '<div className="space-y-3 border-t border-border pt-4">',
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">',
      '<span className="size-1.5 rounded-full bg-primary"></span>',
      "description={t('sales:fieldInfo.attachments'",
    ]);
    expectSourceOmitsAll(source, [
      '<div className="space-y-3 border-t border-zinc-100 pt-4">',
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-praetor">',
      '<span className="size-1.5 rounded-full bg-praetor"></span>',
    ]);
  });

  test.each([
    ['quote versions', 'sales/QuoteVersionsPanel.tsx'],
    ['offer versions', 'sales/OfferVersionsPanel.tsx'],
    ['supplier quote versions', 'sales/SupplierQuoteVersionsPanel.tsx'],
  ])('%s panel delegates duplicate shell UI to the shared version history panel', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      "import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';",
      '<VersionHistoryPanel',
      'restoreInFlight={restoreInFlight}',
      'onRestore={() => setConfirmOpen(true)}',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl bg-white', '<button', 'formatInsertDateTime']);
  });

  test('shared version history panel owns the shadcn shell and buttons', async () => {
    const source = await readComponentSource('shared/VersionHistoryPanel.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      'bg-background text-foreground',
      'variant="outline"',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl bg-white', '<button']);
  });

  test.each([
    [
      'client quotes',
      'sales/ClientQuotesView.tsx',
      'sales.clientQuotes.items',
      '<StandardTable<QuoteItem>',
      '<ClientQuoteSectionHeading label=',
      'onClick={addProductRow}',
    ],
    [
      'client offers',
      'sales/ClientOffersView.tsx',
      'sales.clientOffers.items',
      '<StandardTable<ClientOfferItem>',
      '<ClientOfferSectionHeading',
      'onClick={addItem}',
    ],
  ])('%s item editor uses the shared StandardTable layout', async (_name, path, persistenceKey, tableMarker, sectionMarker, addActionMarker) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      tableMarker,
      sectionMarker,
      addActionMarker,
      `persistenceKey="${persistenceKey}"`,
      'allowColumnHiding={false}',
      'defaultRowsPerPage={5}',
      'minBodyRows={0}',
      'tableContainerClassName="overflow-x-auto"',
      "id: 'actions'",
      'controller.canViewSupplierQuotes',
      'href={line.supplierQuoteHref}',
      'controller.canViewInternalListing',
      'href={line.productHref}',
    ]);
    expectSourceOmitsAll(source, [
      'className="hidden lg:flex gap-2 items-center pt-5"',
      'className="flex-1 min-w-0 grid grid-cols-17 gap-2 items-center"',
      'floating',
      'showColumnSettings={false}',
    ]);
    expect((source.match(/max-w-\[5rem\] flex-none/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((source.match(/outline-none text-right/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expectSourceOmitsAll(source, ['outline-none text-center']);
    expectSourceOmitsAll(source, ['grid grid-cols-17 gap-2 items-center pt-5']);
  });

  test('supplier quote items restore the section heading and lock column visibility', async () => {
    const source = await readComponentSource('sales/SupplierQuotesView.tsx');

    expectSourceContainsAll(source, [
      '<SupplierQuoteSectionTitle>',
      '<StandardTable<SupplierQuoteItem>',
      'persistenceKey="sales.supplierQuotes.items"',
      'allowColumnHiding={false}',
      '<Button type="button" size="sm" onClick={controller.addItem}>',
      'className="flex min-w-[150px] items-center justify-end gap-1"',
      'max-w-[5rem] text-right',
    ]);
    expectSourceOmitsAll(source, ['showColumnSettings={false}']);
  });
});
