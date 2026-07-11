import { describe, expect, mock, test } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  contacts: [
    {
      fullName: 'Andrea Monti',
      role: 'Buyer',
      email: 'channel@cloudseat.dev',
      phone: '+39 06 7700 2002',
    },
    { fullName: 'Laura Bianchi', role: 'Support', email: 'support@cloudseat.dev' },
  ],
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
describe('<SuppliersView /> multiple contacts', () => {
  test('creates a supplier without requiring contacts or sending legacy aliases', async () => {
    const props = renderSuppliersView({
      suppliers: [],
      permissions: ['crm.suppliers.create'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'crm:suppliers.addSupplier' }));
    await user.type(screen.getByPlaceholderText('crm:suppliers.codePlaceholder'), 'SUP-NEW');
    await user.type(screen.getByPlaceholderText('crm:suppliers.namePlaceholder'), 'New Supplier');
    await user.type(screen.getByPlaceholderText('crm:suppliers.vatPlaceholder'), 'IT12345678901');
    await user.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => expect(props.onAddSupplier).toHaveBeenCalledTimes(1));
    const payload = (props.onAddSupplier as ReturnType<typeof mock>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('contacts');
    expect(payload).not.toHaveProperty('contactName');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
  }, 15_000);

  test('preserves unnamed legacy email and phone when contacts remain untouched', async () => {
    const legacySupplier: Supplier = {
      ...supplier,
      id: 'supplier-legacy',
      name: 'Legacy Supplier',
      contacts: [],
      contactName: undefined,
      email: 'legacy@example.test',
      phone: '555',
    };
    const props = renderSuppliersView({
      suppliers: [legacySupplier],
      permissions: ['crm.suppliers.view', 'crm.suppliers.update'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByText('Legacy Supplier'));
    await screen.findByText('crm:suppliers.editSupplier');
    await user.click(screen.getByRole('button', { name: 'common:buttons.update' }));

    await waitFor(() => expect(props.onUpdateSupplier).toHaveBeenCalledTimes(1));
    const payload = (props.onUpdateSupplier as ReturnType<typeof mock>).mock
      .calls[0]?.[1] as Supplier;
    expect(payload).not.toHaveProperty('contacts');
    expect(payload).not.toHaveProperty('contactName');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
  }, 15_000);

  test('blocks submission when a partially filled contact has no name', async () => {
    const props = renderSuppliersView({
      suppliers: [],
      permissions: ['crm.suppliers.create'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'crm:suppliers.addSupplier' }));
    await user.click(screen.getByRole('button', { name: 'crm:suppliers.addContact' }));
    await user.type(screen.getByPlaceholderText('crm:suppliers.rolePlaceholder'), 'Buyer');
    const saveButtons = screen.getAllByRole('button', { name: 'common:buttons.save' });
    await user.click(saveButtons[saveButtons.length - 1]);

    expect(props.onAddSupplier).not.toHaveBeenCalled();
    expect(screen.getByText('common:validation.required')).toBeInTheDocument();
  }, 15_000);

  test('automatically includes a complete pending contact draft in the supplier payload', async () => {
    const props = renderSuppliersView({
      suppliers: [],
      permissions: ['crm.suppliers.create'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'crm:suppliers.addSupplier' }));
    await user.type(screen.getByPlaceholderText('crm:suppliers.codePlaceholder'), 'SUP-DRAFT');
    await user.type(screen.getByPlaceholderText('crm:suppliers.namePlaceholder'), 'Draft Supplier');
    await user.type(screen.getByPlaceholderText('crm:suppliers.vatPlaceholder'), 'IT12345678901');
    await user.click(screen.getByRole('button', { name: 'crm:suppliers.addContact' }));
    await user.type(
      screen.getByPlaceholderText('crm:suppliers.fullNamePlaceholder'),
      '  Pending Contact  ',
    );
    await user.type(
      screen.getByPlaceholderText('crm:suppliers.emailPlaceholder'),
      ' pending@example.test ',
    );

    const saveButtons = screen.getAllByRole('button', { name: 'common:buttons.save' });
    await user.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(props.onAddSupplier).toHaveBeenCalledTimes(1));
    const payload = (props.onAddSupplier as ReturnType<typeof mock>).mock.calls[0]?.[0] as Supplier;
    expect(payload.contacts).toEqual([
      {
        fullName: 'Pending Contact',
        role: '',
        email: 'pending@example.test',
        phone: '',
      },
    ]);
    expect(payload.contactName).toBe('Pending Contact');
    expect(payload.email).toBe('pending@example.test');
    expect(payload.phone).toBe('');
  }, 15_000);

  test('adds and edits a contact while preserving the first contact as primary', async () => {
    const props = renderSuppliersView({
      permissions: ['crm.suppliers.view', 'crm.suppliers.update'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByText('CloudSeat Licensing'));
    await screen.findByText('crm:suppliers.editSupplier');
    const lauraRow = (await screen.findByText('Laura Bianchi')).closest('tr');
    if (!lauraRow) throw new Error('secondary contact row not found');
    await user.click(within(lauraRow).getByRole('button', { name: 'table.rowActions' }));
    await user.click(await screen.findByRole('button', { name: 'common:buttons.edit' }));

    const fullNameInput = await screen.findByPlaceholderText('crm:suppliers.fullNamePlaceholder');
    await user.clear(fullNameInput);
    await user.type(fullNameInput, 'Laura Neri');
    const draftPanel = fullNameInput.closest('.grid');
    if (!draftPanel) throw new Error('contact draft panel not found');
    await user.click(
      within(draftPanel as HTMLElement).getByRole('button', { name: 'common:buttons.update' }),
    );
    expect(screen.getByText('Laura Neri')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'crm:suppliers.addContact' }));
    await user.type(
      screen.getByPlaceholderText('crm:suppliers.fullNamePlaceholder'),
      'Marco Verdi',
    );
    await user.type(screen.getByPlaceholderText('crm:suppliers.rolePlaceholder'), 'Sales');
    await user.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    expect(screen.getByText('Marco Verdi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'common:buttons.update' }));

    await waitFor(() => expect(props.onUpdateSupplier).toHaveBeenCalledTimes(1));
    const payload = (props.onUpdateSupplier as ReturnType<typeof mock>).mock
      .calls[0]?.[1] as Supplier;
    expect(payload.contacts).toHaveLength(3);
    expect(payload.contacts?.[1]?.fullName).toBe('Laura Neri');
    expect(payload.contacts?.[2]).toEqual({
      fullName: 'Marco Verdi',
      role: 'Sales',
      email: '',
      phone: '',
    });
    expect(payload.contactName).toBe('Andrea Monti');
    expect(payload.email).toBe('channel@cloudseat.dev');
    expect(payload.phone).toBe('+39 06 7700 2002');
  });

  test('removes a secondary contact', async () => {
    const props = renderSuppliersView({
      permissions: ['crm.suppliers.view', 'crm.suppliers.update'],
    });
    const user = userEvent.setup();

    await user.click(screen.getByText('CloudSeat Licensing'));
    await screen.findByText('crm:suppliers.editSupplier');

    const lauraRow = (await screen.findByText('Laura Bianchi')).closest('tr');
    if (!lauraRow) throw new Error('secondary contact row not found');
    await user.click(within(lauraRow).getByRole('button', { name: 'table.rowActions' }));
    await user.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    expect(screen.queryByText('Laura Bianchi')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common:buttons.update' }));
    await waitFor(() => expect(props.onUpdateSupplier).toHaveBeenCalledTimes(1));
    const payload = (props.onUpdateSupplier as ReturnType<typeof mock>).mock
      .calls[0]?.[1] as Supplier;
    expect(payload.contacts).toHaveLength(1);
    expect(payload.contacts?.[0]?.fullName).toBe('Andrea Monti');
  });
});
