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
});
