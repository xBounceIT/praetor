import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workbook, type Worksheet } from 'exceljs';
import type { ComponentProps } from 'react';
import type { BulkSupplierCreateInput, Supplier } from '../../../types';
import {
  buildImportWorkbook,
  IMPORT_FIRST_DATA_ROW,
  IMPORT_WORKSHEET_NAME,
} from '../../../utils/entityImportWorkbook';
import {
  buildSupplierImportDefinition,
  SUPPLIER_IMPORT_FIELDS,
} from '../../../utils/supplierImportWorkbook';
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
    onAddSuppliersBulk: mock(async (suppliers: BulkSupplierCreateInput[]) => ({
      summary: { total: suppliers.length, succeeded: suppliers.length, failed: 0 },
      results: suppliers.map((_, index) => ({ index, success: true as const, supplier })),
    })),
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

const requireWorksheet = (workbook: Workbook, name: string): Worksheet => {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) throw new Error(`Missing worksheet ${name}`);
  return worksheet;
};

const makeSupplierWorkbookFile = async (
  rows: Array<Partial<Record<(typeof SUPPLIER_IMPORT_FIELDS)[number], string>>>,
) => {
  const workbook = await buildImportWorkbook(
    new Workbook(),
    buildSupplierImportDefinition((key) => key),
  );
  const worksheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);
  rows.forEach((row, rowIndex) => {
    for (const [field, value] of Object.entries(row)) {
      const column = SUPPLIER_IMPORT_FIELDS.indexOf(
        field as (typeof SUPPLIER_IMPORT_FIELDS)[number],
      );
      if (column >= 0)
        worksheet.getCell(IMPORT_FIRST_DATA_ROW + rowIndex, column + 1).value = value;
    }
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer as unknown as BlobPart], 'praetor-suppliers-import.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
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

describe('<SuppliersView /> bulk creation actions', () => {
  test('shows the split button with create permission', async () => {
    const user = userEvent.setup();
    renderSuppliersView({ permissions: ['crm.suppliers.create'] });

    expect(screen.getByRole('button', { name: 'crm:suppliers.addSupplier' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'crm:suppliers.bulk.addOptions' }));
    expect(
      screen.getByRole('menuitem', { name: 'crm:suppliers.bulk.addMultiple' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'crm:suppliers.bulk.importExcel' }),
    ).toBeInTheDocument();
  });

  test('does not grant global row updates from base supplier permissions', async () => {
    const props = renderSuppliersView({
      permissions: ['crm.suppliers.view', 'crm.suppliers.update', 'crm.suppliers.delete'],
    });

    await waitFor(() =>
      expect(screen.getByText('CloudSeat Licensing').closest('tr')).not.toHaveClass(
        'cursor-pointer',
      ),
    );
    expect(screen.queryByText('crm:suppliers.editSupplier')).not.toBeInTheDocument();
    expect(props.onUpdateSupplier).not.toHaveBeenCalled();
    expect(props.onDeleteSupplier).not.toHaveBeenCalled();
  });

  test('hides the split button without create permission', () => {
    renderSuppliersView({ permissions: ['crm.suppliers.view'] });
    expect(
      screen.queryByRole('button', { name: 'crm:suppliers.bulk.addOptions' }),
    ).not.toBeInTheDocument();
  });

  test('keeps only failed supplier rows and retries them', async () => {
    const createBulk = mock()
      .mockResolvedValueOnce({
        summary: { total: 2, succeeded: 1, failed: 1 },
        results: [
          { index: 0, success: true, supplier },
          {
            index: 1,
            success: false,
            errors: [{ field: 'name', code: 'required', message: 'Required' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        summary: { total: 1, succeeded: 1, failed: 0 },
        results: [{ index: 0, success: true, supplier }],
      });
    const user = userEvent.setup();
    renderSuppliersView({
      suppliers: [],
      permissions: ['crm.suppliers.create'],
      onAddSuppliersBulk: createBulk,
    });
    await user.click(screen.getByRole('button', { name: 'crm:suppliers.bulk.addOptions' }));
    await user.click(screen.getByRole('menuitem', { name: 'crm:suppliers.bulk.addMultiple' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:suppliers.bulk.title' });
    await user.click(within(dialog).getByRole('button', { name: 'crm:suppliers.bulk.addRow' }));

    const codes = within(dialog).getAllByPlaceholderText('crm:suppliers.codePlaceholder');
    const names = within(dialog).getAllByPlaceholderText('crm:suppliers.namePlaceholder');
    const vatNumbers = within(dialog).getAllByPlaceholderText('crm:suppliers.vatPlaceholder');
    fireEvent.change(codes[0], { target: { value: 'SUP-1' } });
    fireEvent.change(names[0], { target: { value: 'First' } });
    fireEvent.change(vatNumbers[0], { target: { value: 'IT1' } });
    fireEvent.change(codes[1], { target: { value: 'SUP-2' } });
    fireEvent.change(vatNumbers[1], { target: { value: 'IT2' } });
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:suppliers.bulk.createSuppliers' }),
    );

    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    expect(within(dialog).getAllByPlaceholderText('crm:suppliers.codePlaceholder')).toHaveLength(1);
    expect(within(dialog).getByText('common:validation.required')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText('crm:suppliers.namePlaceholder'), {
      target: { value: 'Second' },
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:suppliers.bulk.createSuppliers' }),
    );

    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(2));
    expect(createBulk.mock.calls[1]?.[0]).toEqual([
      { supplierCode: 'SUP-2', name: 'Second', vatNumber: 'IT2' },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'crm:suppliers.bulk.title' }),
      ).not.toBeInTheDocument(),
    );
  });

  test('imports the strict supplier workbook and retries only failed records', async () => {
    window.ExcelJS = { Workbook };
    const createBulk = mock()
      .mockResolvedValueOnce({
        summary: { total: 2, succeeded: 1, failed: 1 },
        results: [
          { index: 0, success: true, supplier },
          {
            index: 1,
            success: false,
            errors: [{ field: 'vatNumber', code: 'duplicate', message: 'Duplicate' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        summary: { total: 1, succeeded: 1, failed: 0 },
        results: [{ index: 0, success: true, supplier }],
      });
    const user = userEvent.setup();
    renderSuppliersView({
      suppliers: [],
      permissions: ['crm.suppliers.create'],
      onAddSuppliersBulk: createBulk,
    });
    await user.click(screen.getByRole('button', { name: 'crm:suppliers.bulk.addOptions' }));
    await user.click(screen.getByRole('menuitem', { name: 'crm:suppliers.bulk.importExcel' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'crm:suppliers.bulk.excel.title',
    });
    const file = await makeSupplierWorkbookFile([
      {
        supplierCode: 'SUP-XLSX-1',
        name: 'Excel Supplier One',
        vatNumber: 'IT123-1',
        contactName: 'Jane',
        contactRole: 'Buyer',
        email: 'jane@example.test',
        phone: '+39 123',
      },
      {
        supplierCode: 'SUP-XLSX-2',
        name: 'Excel Supplier Two',
        vatNumber: 'IT123-2',
      },
    ]);

    fireEvent.change(within(dialog).getByLabelText('crm:suppliers.bulk.excel.fileLabel'), {
      target: { files: [file] },
    });
    await within(dialog).findByText('crm:suppliers.bulk.excel.readyTitle');
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:suppliers.bulk.excel.importButton' }),
    );

    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    expect(createBulk).toHaveBeenCalledWith([
      {
        supplierCode: 'SUP-XLSX-1',
        name: 'Excel Supplier One',
        vatNumber: 'IT123-1',
        contactName: 'Jane',
        contactRole: 'Buyer',
        email: 'jane@example.test',
        phone: '+39 123',
      },
      {
        supplierCode: 'SUP-XLSX-2',
        name: 'Excel Supplier Two',
        vatNumber: 'IT123-2',
      },
    ]);
    expect(within(dialog).getByText('crm:suppliers.bulk.excel.resultTitle')).toBeInTheDocument();
    const importButton = within(dialog).getByRole('button', {
      name: 'crm:suppliers.bulk.excel.importButton',
    });
    expect(importButton).toBeEnabled();

    await user.click(importButton);
    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(2));
    expect(createBulk.mock.calls[1]?.[0]).toEqual([
      {
        supplierCode: 'SUP-XLSX-2',
        name: 'Excel Supplier Two',
        vatNumber: 'IT123-2',
      },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'crm:suppliers.bulk.excel.title' }),
      ).not.toBeInTheDocument(),
    );
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

describe('<SuppliersView /> supplier-order totals', () => {
  test('uses rounded unit cost and duration like the supplier-order view', async () => {
    renderSuppliersView({
      supplierOrders: [
        {
          id: 'order-1',
          supplierId: supplier.id,
          supplierName: supplier.name,
          paymentTerms: 'immediate',
          discount: 12,
          discountType: 'currency',
          status: 'sent',
          createdAt: 1,
          updatedAt: 1,
          items: [
            {
              id: 'item-1',
              orderId: 'order-1',
              productId: 'product-1',
              productName: 'Service',
              quantity: 100,
              unitPrice: 10.01,
              discount: 10,
              durationMonths: 12,
              durationUnit: 'months',
            },
          ],
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('10.800,00 EUR')).toBeInTheDocument());
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
      permissions: ['crm.suppliers_all.view', 'crm.suppliers_all.update'],
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
      permissions: ['crm.suppliers_all.view', 'crm.suppliers_all.update'],
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
      permissions: ['crm.suppliers_all.view', 'crm.suppliers_all.update'],
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
