import { describe, test } from 'bun:test';
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
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
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

  // Regression: the desktop product-line `pt-5` gutter that reserves room for the floated
  // quick-view shortcut must live on the row flex that also holds the trash button — not on the
  // inner grid. When it sits on the grid, the sibling delete button centers against the grid's
  // padded box and floats ~10px above the inputs instead of aligning with the row.
  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx'],
    ['client offers', 'sales/ClientOffersView.tsx'],
  ])('%s desktop line row shares the quick-view gutter with the delete button', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      'className="hidden lg:flex gap-2 items-center pt-5"',
      'className="flex-1 min-w-0 grid grid-cols-16 gap-2 items-center"',
    ]);
    expectSourceOmitsAll(source, ['grid grid-cols-16 gap-2 items-center pt-5']);
  });
});
