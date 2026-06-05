import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('ClientsInvoicesView modal styling', () => {
  test('edit modal uses the shared shadcn modal layout and form primitives', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="full"',
      '<ModalHeader>',
      '<ModalBody className="flex-1 space-y-5">',
      '<ModalFooter>',
      'id="client-invoice-client"',
      'id="client-invoice-notes"',
      "summary', { defaultValue: 'Summary' })",
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, [
      'rounded-2xl bg-white',
      'shadow-lg shadow-zinc-200',
      '<textarea',
    ]);
  });

  test('notes section header matches other modal section headers', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">',
      '<span className="size-1.5 rounded-full bg-primary"></span>',
      '<FieldLabel htmlFor="client-invoice-notes" className="sr-only">',
      'id="client-invoice-notes"',
    ]);
  });

  test('item rows render unit, currency, and percentage beside inputs instead of headers', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "{t('common:labels.price')}</div>",
      "{t('common:labels.discount')}</div>",
      '/',
      '{currency}',
      '<span className="shrink-0 text-xs font-medium text-muted-foreground">',
      '%',
    ]);
    expectSourceOmitsAll(source, [
      "{t('common:labels.price')} ({currency})",
      "{t('common:labels.discount')}%",
    ]);
  });

  test('exposes a Durata column and folds duration into the taxable line amount (issue #757)', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      // The Durata column header + per-row duration input wired through the shared parser.
      "{t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}",
      "'durationMonths',",
      'parseDurationMonthsInput(value)',
      // The taxable amount (and therefore subtotal/tax/total) multiplies by the line duration
      // via the shared clamp helper.
      'getEffectiveDurationMonths(item)',
    ]);
  });
});
