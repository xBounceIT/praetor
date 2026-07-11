import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('supplier accounting modal styling', () => {
  test('client order version panel delegates duplicate shell UI to the shared version history panel', async () => {
    const source = await readComponentSource('accounting/OrderVersionsPanel.tsx');

    expectSourceContainsAll(source, [
      "import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';",
      '<VersionHistoryPanel',
      'restoreInFlight={restoreInFlight}',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl bg-white', '<button', 'formatInsertDateTime']);
  });

  test('supplier order modal uses shared shadcn modal layout and themed version panel', async () => {
    const source = await readComponentSource('accounting/SupplierOrdersView.tsx');
    const versionsSource = await readComponentSource('accounting/SupplierOrderVersionsPanel.tsx');

    expectSourceContainsAll(source, [
      '<ModalContent size="full"',
      '<ModalHeader>',
      '<ModalBody className="flex-1 space-y-5">',
      '<ModalFooter>',
      'id="supplier-order-notes"',
      "summary', { defaultValue: 'Summary' })",
      '<DeleteConfirmModal',
      '<SupplierOrderSectionTitle>',
      '<StandardTable<SupplierSaleOrderItem>',
      'showHeaderTitle={false}',
      'showColumnSettings={false}',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl bg-white', '<textarea']);
    expectSourceContainsAll(versionsSource, [
      "import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';",
      '<VersionHistoryPanel',
      'restoreInFlight={restoreInFlight}',
    ]);
    expectSourceOmitsAll(versionsSource, [
      'rounded-2xl bg-white',
      '<button',
      'formatInsertDateTime',
    ]);
  });

  test('supplier invoice modal uses shared shadcn modal layout and form primitives', async () => {
    const source = await readComponentSource('accounting/SupplierInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="full"',
      'id="supplier-invoice-supplier"',
      'id="supplier-invoice-notes"',
      "summary', { defaultValue: 'Summary' })",
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl bg-white', '<textarea']);
  });

  test.each([
    ['supplier order', 'accounting/SupplierOrdersView.tsx', 'supplier-order-notes'],
    ['supplier invoice', 'accounting/SupplierInvoicesView.tsx', 'supplier-invoice-notes'],
  ])('%s notes section header matches other modal section headers', async (_name, path, notesId) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">',
      '<span className="size-1.5 rounded-full bg-primary"></span>',
      `<FieldLabel htmlFor="${notesId}" className="sr-only">`,
      `id="${notesId}"`,
    ]);
  });

  test('supplier invoice item rows render unit, currency, and percentage beside inputs instead of headers', async () => {
    const source = await readComponentSource('accounting/SupplierInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "{controller.t('crm:internalListing.salePrice')}",
      '<span className="shrink-0 text-xs font-medium text-muted-foreground">/</span>',
      "{controller.t('accounting:clientsInvoices.unit')}",
      '{controller.currency}',
      '<span className="shrink-0 text-xs font-medium text-muted-foreground">%</span>',
    ]);
    expectSourceOmitsAll(source, [
      "{t('crm:internalListing.salePrice')} ({currency})",
      "{controller.t('crm:internalListing.salePrice')} ({controller.currency})",
    ]);
  });
});
