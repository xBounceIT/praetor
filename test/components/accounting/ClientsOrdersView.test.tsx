import { describe, expect, mock, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import type { Client, ClientsOrder } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';

installI18nMock();

const ClientsOrdersView = (await import('../../../components/accounting/ClientsOrdersView'))
  .default;

const clients: Client[] = [{ id: 'client-1', name: 'Helios Energy Services' }];

const orders: ClientsOrder[] = [
  {
    id: 'dm_so_01',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-1',
        orderId: 'dm_so_01',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 2,
        unitPrice: 2000,
        productCost: 1200,
        productMolPercentage: 40,
      },
    ],
    paymentTerms: '30gg',
    discount: 5,
    discountType: 'percentage',
    status: 'draft',
    createdAt: Date.UTC(2026, 3, 24),
    updatedAt: Date.UTC(2026, 3, 24),
  },
];

describe('<ClientsOrdersView />', () => {
  test('pricing amount columns keep sorting but hide StandardTable header filters', () => {
    render(
      <ClientsOrdersView
        orders={orders}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => {})}
        onDeleteClientsOrder={mock(() => {})}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'table.filters sales:clientQuotes.globalDiscount' }),
    ).toBeInTheDocument();

    for (const header of [
      'accounting:clientsOrders.subtotal',
      'common:labels.discount',
      'accounting:clientsOrders.margin',
      'sales:clientQuotes.totalCost',
      'accounting:clientsOrders.totalColumn',
    ]) {
      expect(screen.queryByRole('button', { name: `table.filters ${header}` })).toBeNull();
      expect(screen.getByText(header).closest('th')?.querySelector('svg')).toBeInTheDocument();
    }
  });

  test('client column does not render item count below the client name', () => {
    render(
      <ClientsOrdersView
        orders={orders}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => {})}
        onDeleteClientsOrder={mock(() => {})}
      />,
    );

    expect(screen.getByText('Helios Energy Services')).toBeInTheDocument();
    expect(screen.queryByText('accounting:clientsOrders.itemsCount')).toBeNull();
  });

  test('edit modal uses the shared shadcn modal layout and form primitives', async () => {
    const source = await Bun.file(
      new URL('../../../components/accounting/ClientsOrdersView.tsx', import.meta.url),
    ).text();

    expect(source).toContain("import { Button } from '@/components/ui/button';");
    expect(source).toContain(
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
    );
    expect(source).toContain("import { Textarea } from '@/components/ui/textarea';");
    expect(source).toContain('<ModalContent size="full"');
    expect(source).toContain('<ModalHeader>');
    expect(source).toContain('<ModalBody className="flex-1 space-y-5">');
    expect(source).toContain('<ModalFooter>');
    expect(source).toContain('id="client-order-client"');
    expect(source).toContain('id="client-order-notes"');
    expect(source).toContain('<DeleteConfirmModal');
    expect(source).not.toContain('rounded-2xl bg-white');
    expect(source).not.toContain('shadow-lg shadow-zinc-200');
    expect(source).not.toContain('<textarea');
  });
});
