import { describe, expect, mock, test } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Supplier } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';
import { expectSourceContainsAll, readComponentSource } from '../modalStylingTestUtils';

installI18nMock();

mock.module('../../../services/api/views', () => ({
  viewsApi: {
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error('not used')),
    update: () => Promise.reject(new Error('not used')),
    remove: () => Promise.resolve(),
    directory: () => Promise.resolve([]),
    getShares: () => Promise.resolve([]),
    replaceShares: () => Promise.resolve([]),
  },
}));

const SuppliersView = (await import('../../../components/CRM/SuppliersView')).default;

const supplier: Supplier = {
  id: 'supplier-1',
  name: 'CloudSeat Licensing',
  supplierCode: 'DM-SUP-002',
  contactName: 'Andrea Monti',
  email: 'channel@cloudseat.dev',
  phone: '+39 06 7700 2002',
  vatNumber: 'IT20000000002',
  taxCode: 'CLSLDR80A02H501Z',
  createdAt: Date.UTC(2025, 11, 19),
};

const renderSuppliersView = (overrides: Partial<ComponentProps<typeof SuppliersView>> = {}) => {
  const props: ComponentProps<typeof SuppliersView> = {
    suppliers: [supplier],
    supplierOrders: [],
    currency: 'EUR',
    onAddSupplier: mock(async () => {}),
    onUpdateSupplier: mock(async () => {}),
    onDeleteSupplier: mock(async () => {}),
    permissions: ['crm.suppliers.view'],
    ...overrides,
  };

  render(<SuppliersView {...props} />);
  return props;
};

const expectSupplierValueCell = (cell: HTMLElement, value: string) => {
  expect(cell).toHaveTextContent(value);
  const valueElement = within(cell).getByText(value);
  expect(valueElement.className).toContain('text-xs text-zinc-600');
};

describe('SuppliersView CRUD failure surfacing', () => {
  test('handleSubmit/handleDelete/handleStatusUpdate await + try/catch + toast', async () => {
    const source = await readComponentSource('CRM/SuppliersView.tsx');

    expectSourceContainsAll(source, [
      "import { toastError } from '../../utils/toast';",
      'const handleSubmit = async (e: React.FormEvent)',
      'await onUpdateSupplier(editingSupplier.id, payload);',
      'await onAddSupplier(payload);',
      'const handleDelete = async () =>',
      'await onDeleteSupplier(supplierToDelete.id);',
      'const handleStatusUpdate = useCallback(',
      'await onUpdateSupplier(id, updates);',
      "t('crm:suppliers.failedToSave')",
      "t('crm:suppliers.failedToDelete')",
      "t('crm:suppliers.failedToUpdateStatus')",
      'void onStatusUpdate(row.id,',
      'isDisabled: !row.isDisabled',
    ]);
  });
});

describe('<SuppliersView /> table contact columns', () => {
  test('renders supplier contact fields in dedicated customer-style columns', async () => {
    renderSuppliersView();

    await waitFor(() =>
      expect(screen.getByText('crm:suppliers.tableHeaders.contactName')).toBeInTheDocument(),
    );
    expect(screen.queryByText('crm:suppliers.tableHeaders.contact')).not.toBeInTheDocument();
    expect(screen.getByText('crm:suppliers.tableHeaders.email')).toBeInTheDocument();
    expect(screen.getByText('crm:suppliers.tableHeaders.phone')).toBeInTheDocument();

    const row = screen.getByText('CloudSeat Licensing').closest('tr');
    if (!row) throw new Error('supplier row not found');
    const cells = within(row).getAllByRole('cell');

    expectSupplierValueCell(cells[3], 'Andrea Monti');
    expectSupplierValueCell(cells[4], 'channel@cloudseat.dev');
    expectSupplierValueCell(cells[5], '+39 06 7700 2002');
  });
});
