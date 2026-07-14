import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workbook, type Worksheet } from 'exceljs';
import type { ComponentProps } from 'react';
import type {
  BulkClientCreateResponse,
  Client,
  ClientProfileOption,
  ClientProfileOptionsByCategory,
} from '../../../types';
import {
  buildClientImportDefinition,
  CLIENT_IMPORT_FIELDS,
} from '../../../utils/clientImportWorkbook';
import {
  buildImportWorkbook,
  IMPORT_FIRST_DATA_ROW,
  IMPORT_WORKSHEET_NAME,
} from '../../../utils/entityImportWorkbook';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

const emptyProfileOptions: ClientProfileOptionsByCategory = {
  sector: [],
  numberOfEmployees: [],
  revenue: [],
  officeCountRange: [],
};

const listAllProfileOptions = mock(async () => emptyProfileOptions);
const toastError = mock(() => undefined);
const toastSuccess = mock(() => undefined);

const profileOption: ClientProfileOption = {
  id: 'option-1',
  category: 'sector',
  value: 'Manufacturing',
  sortOrder: 0,
  usageCount: 0,
};

mock.module('../../../services/api', () => ({
  default: {
    clients: {
      listAllProfileOptions,
    },
  },
}));

mock.module('../../../utils/toast', () => ({ toastError, toastSuccess }));

clearSpyStateAfterAll();

const ClientsView = (await import('../../../components/CRM/ClientsView')).default;

const renderClientsView = (overrides: Partial<ComponentProps<typeof ClientsView>> = {}) => {
  const props: ComponentProps<typeof ClientsView> = {
    clients: [],
    onAddClient: mock(async () => {}),
    onAddClientsBulk: mock(async () => ({
      summary: { total: 0, succeeded: 0, failed: 0 },
      results: [],
    })),
    onUpdateClient: mock(async () => {}),
    onDeleteClient: mock(async () => {}),
    onCreateClientProfileOption: mock(async () => profileOption),
    onUpdateClientProfileOption: mock(async () => profileOption),
    onDeleteClientProfileOption: mock(async () => {}),
    permissions: ['crm.clients.view', 'crm.clients.create', 'crm.clients.update'],
    ...overrides,
  };

  render(<ClientsView {...props} />);
  return props;
};

const openAddClientModal = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'crm:clients.addClient' }));
  await screen.findByText('crm:clients.identifyingData');
  return user;
};

const fillRequiredClientFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText('crm:clients.clientCodePlaceholder'), 'ACME');
  await user.type(screen.getByPlaceholderText('crm:clients.namePlaceholder'), 'Acme Srl');
  await user.type(
    screen.getByPlaceholderText('crm:clients.fiscalCodePlaceholder'),
    'IT12345678901',
  );
};

const submitClientForm = async (user: ReturnType<typeof userEvent.setup>) => {
  const submitButton = document.querySelector('button[type="submit"]');
  if (!(submitButton instanceof HTMLElement)) {
    throw new Error('Could not find client form submit button');
  }
  await user.click(submitButton);
};

const openClientCreationMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'crm:clients.bulk.addOptions' }));
};

const workbookTranslator = (key: string) => key;

const requireWorksheet = (workbook: Workbook, name: string): Worksheet => {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) throw new Error(`Missing worksheet ${name}`);
  return worksheet;
};

const makeClientWorkbookFile = async (
  rows: Array<Partial<Record<(typeof CLIENT_IMPORT_FIELDS)[number], string>>> = [],
  mutate?: (workbook: Workbook) => void,
) => {
  const workbook = await buildImportWorkbook(
    new Workbook(),
    buildClientImportDefinition(emptyProfileOptions, workbookTranslator),
  );
  const worksheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);
  rows.forEach((row, rowIndex) => {
    for (const [field, value] of Object.entries(row)) {
      const column = CLIENT_IMPORT_FIELDS.indexOf(field as (typeof CLIENT_IMPORT_FIELDS)[number]);
      if (column >= 0)
        worksheet.getCell(IMPORT_FIRST_DATA_ROW + rowIndex, column + 1).value = value;
    }
  });
  mutate?.(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer as unknown as BlobPart], 'praetor-clients-import.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('<ClientsView /> bulk creation actions', () => {
  beforeEach(() => {
    localStorage.clear();
    listAllProfileOptions.mockClear();
    toastError.mockClear();
    toastSuccess.mockClear();
    window.ExcelJS = { Workbook };
  });

  test('renders an accessible split button with create permission', async () => {
    const user = userEvent.setup();
    renderClientsView();

    expect(screen.getByRole('button', { name: 'crm:clients.addClient' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'crm:clients.bulk.addOptions' })).toBeInTheDocument();
    await openClientCreationMenu(user);
    expect(
      screen.getByRole('menuitem', { name: 'crm:clients.bulk.addMultiple' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'crm:clients.bulk.importExcel' }),
    ).toBeInTheDocument();
  });

  test('hides every creation action without create permission', () => {
    renderClientsView({ permissions: ['crm.clients.view'] });
    expect(screen.queryByRole('button', { name: 'crm:clients.addClient' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'crm:clients.bulk.addOptions' }),
    ).not.toBeInTheDocument();
  });

  test('opens a non-hideable horizontal table with add and remove row actions', async () => {
    const user = userEvent.setup();
    renderClientsView();
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.addMultiple' }));

    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.title' });
    const source = await readComponentSource('CRM/ClientBulkCreateDialogs.tsx');
    expect(source).toContain('allowColumnHiding={false}');
    expect(source).toContain("aria-label={t('crm:clients.bulk.removeRow')}");
    expect(source).toContain('candidate._rowId !== row._rowId');
    expect(
      within(dialog).getAllByPlaceholderText('crm:clients.clientCodePlaceholder'),
    ).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'crm:clients.bulk.addRow' }));
    expect(
      within(dialog).getAllByPlaceholderText('crm:clients.clientCodePlaceholder'),
    ).toHaveLength(2);
  });

  test('keeps only failed rows, displays cell errors, and closes after the retry succeeds', async () => {
    const createdClient = {
      id: 'c-created',
      name: 'Alpha',
      clientCode: 'CLI-1',
      fiscalCode: 'IT1',
      type: 'company' as const,
      contacts: [],
      isDisabled: false,
      totalSentQuotes: 0,
      totalAcceptedOrders: 0,
    };
    const createBulk = mock()
      .mockResolvedValueOnce({
        summary: { total: 2, succeeded: 1, failed: 1 },
        results: [
          { index: 0, success: true, client: createdClient },
          {
            index: 1,
            success: false,
            errors: [{ field: 'name', code: 'required', message: 'name is required' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        summary: { total: 1, succeeded: 1, failed: 0 },
        results: [{ index: 0, success: true, client: { ...createdClient, id: 'c-retried' } }],
      });
    const user = userEvent.setup();
    renderClientsView({ onAddClientsBulk: createBulk });
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.addMultiple' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.title' });
    await user.click(within(dialog).getByRole('button', { name: 'crm:clients.bulk.addRow' }));

    const codes = within(dialog).getAllByPlaceholderText('crm:clients.clientCodePlaceholder');
    const names = within(dialog).getAllByPlaceholderText('crm:clients.namePlaceholder');
    const fiscalCodes = within(dialog).getAllByPlaceholderText('crm:clients.fiscalCodePlaceholder');
    fireEvent.change(codes[0], { target: { value: 'CLI-1' } });
    fireEvent.change(names[0], { target: { value: 'Alpha' } });
    fireEvent.change(fiscalCodes[0], { target: { value: 'IT1' } });
    fireEvent.change(codes[1], { target: { value: 'CLI-2' } });
    fireEvent.change(fiscalCodes[1], { target: { value: 'IT2' } });
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.createClients' }),
    );

    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    expect(createBulk.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ clientCode: 'CLI-1', name: 'Alpha', fiscalCode: 'IT1' }),
      expect.objectContaining({ clientCode: 'CLI-2', fiscalCode: 'IT2' }),
    ]);
    expect(
      within(dialog).getAllByPlaceholderText('crm:clients.clientCodePlaceholder'),
    ).toHaveLength(1);
    expect(within(dialog).getByText('common:validation.required')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText('crm:clients.namePlaceholder'), {
      target: { value: 'Beta' },
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.createClients' }),
    );
    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'crm:clients.bulk.title' }),
      ).not.toBeInTheDocument(),
    );
  });

  test('locks editable bulk rows while a request is in flight', async () => {
    let resolveBulk: ((response: BulkClientCreateResponse) => void) | undefined;
    const createBulk = mock(
      () =>
        new Promise<BulkClientCreateResponse>((resolve) => {
          resolveBulk = resolve;
        }),
    );
    const user = userEvent.setup();
    renderClientsView({ onAddClientsBulk: createBulk });
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.addMultiple' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.title' });
    fireEvent.change(within(dialog).getByPlaceholderText('crm:clients.clientCodePlaceholder'), {
      target: { value: 'CLI-1' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('crm:clients.namePlaceholder'), {
      target: { value: 'Alpha' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('crm:clients.fiscalCodePlaceholder'), {
      target: { value: 'IT1' },
    });

    await user.click(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.createClients' }),
    );
    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByPlaceholderText('crm:clients.namePlaceholder')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'crm:clients.bulk.addRow' })).toBeDisabled();

    await act(async () => {
      resolveBulk?.({
        summary: { total: 1, succeeded: 0, failed: 1 },
        results: [
          {
            index: 0,
            success: false,
            errors: [{ field: 'name', code: 'invalid', message: 'Invalid' }],
          },
        ],
      });
    });
    await waitFor(() =>
      expect(within(dialog).getByPlaceholderText('crm:clients.namePlaceholder')).toBeEnabled(),
    );
  });

  test('Excel dialog shows the protected template contract and fetches fresh profile values on download', async () => {
    const freshOptions: ClientProfileOptionsByCategory = {
      ...emptyProfileOptions,
      sector: [{ ...profileOption, value: 'Fresh sector' }],
    };
    listAllProfileOptions
      .mockResolvedValueOnce(emptyProfileOptions)
      .mockResolvedValueOnce(freshOptions);
    const createObjectUrl = mock(() => 'blob:client-template');
    const revokeObjectUrl = mock(() => undefined);
    const previousCreateObjectUrl = URL.createObjectURL;
    const previousRevokeObjectUrl = URL.revokeObjectURL;
    const previousAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
    HTMLAnchorElement.prototype.click = mock(() => undefined);
    const user = userEvent.setup();

    try {
      renderClientsView();
      await waitFor(() => expect(listAllProfileOptions).toHaveBeenCalledTimes(1));
      await openClientCreationMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importExcel' }));

      const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.excel.title' });
      const fileInput = within(dialog).getByLabelText('crm:clients.bulk.excel.fileLabel');
      const browseButton = within(dialog).getByRole('button', {
        name: 'crm:clients.bulk.excel.browseButton',
      });
      const openFilePicker = mock(() => undefined);
      Object.defineProperty(fileInput, 'click', { value: openFilePicker });
      expect(fileInput).toHaveClass('hidden');
      expect(within(dialog).getByText('crm:clients.bulk.excel.noFileSelected')).toBeVisible();
      fireEvent.click(browseButton);
      expect(openFilePicker).toHaveBeenCalledTimes(1);
      expect(within(dialog).getByText('crm:clients.bulk.excel.structureTitle')).toBeInTheDocument();
      expect(within(dialog).getByText('clientCode')).toBeInTheDocument();
      expect(within(dialog).getByText('fiscalCode')).toBeInTheDocument();

      await user.click(
        within(dialog).getByRole('button', {
          name: 'crm:clients.bulk.excel.downloadTemplate',
        }),
      );
      await waitFor(() => expect(listAllProfileOptions).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
      expect(
        within(dialog).getByRole('button', { name: 'crm:clients.bulk.excel.importButton' }),
      ).toBeDisabled();
    } finally {
      URL.createObjectURL = previousCreateObjectUrl;
      URL.revokeObjectURL = previousRevokeObjectUrl;
      HTMLAnchorElement.prototype.click = previousAnchorClick;
    }
  });

  test('does not download a stale client template when the fresh profile request fails', async () => {
    listAllProfileOptions
      .mockResolvedValueOnce(emptyProfileOptions)
      .mockRejectedValueOnce(new Error('profile options unavailable'));
    const createObjectUrl = mock(() => 'blob:stale-client-template');
    const previousCreateObjectUrl = URL.createObjectURL;
    const previousConsoleError = console.error;
    const consoleError = mock(() => undefined);
    URL.createObjectURL = createObjectUrl;
    console.error = consoleError;
    const user = userEvent.setup();

    try {
      renderClientsView();
      await waitFor(() => expect(listAllProfileOptions).toHaveBeenCalledTimes(1));
      await openClientCreationMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importExcel' }));
      const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.excel.title' });

      await user.click(
        within(dialog).getByRole('button', {
          name: 'crm:clients.bulk.excel.downloadTemplate',
        }),
      );

      await waitFor(() => expect(listAllProfileOptions).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('crm:clients.bulk.excel.downloadFailed'),
      );
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to load client profile options:',
        expect.any(Error),
      );
      expect(createObjectUrl).not.toHaveBeenCalled();
      expect(
        within(dialog).getByRole('button', { name: 'crm:clients.bulk.excel.downloadTemplate' }),
      ).toBeEnabled();
    } finally {
      URL.createObjectURL = previousCreateObjectUrl;
      console.error = previousConsoleError;
    }
  });

  test('Excel import maps errors to worksheet rows and retries only failed records', async () => {
    const createBulk = mock()
      .mockResolvedValueOnce({
        summary: { total: 2, succeeded: 1, failed: 1 },
        results: [
          {
            index: 0,
            success: true as const,
            client: { id: 'c1', name: 'Alpha', clientCode: 'CLI-1', fiscalCode: 'IT1' },
          },
          {
            index: 1,
            success: false as const,
            errors: [{ field: 'fiscalCode', code: 'duplicate' as const, message: 'Duplicate' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        summary: { total: 1, succeeded: 1, failed: 0 },
        results: [
          {
            index: 0,
            success: true,
            client: { id: 'c2', name: 'Beta', clientCode: 'CLI-2', fiscalCode: 'IT2' },
          },
        ],
      });
    const user = userEvent.setup();
    renderClientsView({ onAddClientsBulk: createBulk });
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importExcel' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.excel.title' });
    const file = await makeClientWorkbookFile([
      { fiscalCode: 'IT1', name: 'Alpha', clientCode: 'CLI-1' },
      { fiscalCode: 'IT2', name: 'Beta', clientCode: 'CLI-2' },
    ]);

    fireEvent.change(within(dialog).getByLabelText('crm:clients.bulk.excel.fileLabel'), {
      target: { files: [file] },
    });
    await within(dialog).findByText('crm:clients.bulk.excel.readyTitle');
    const importButton = within(dialog).getByRole('button', {
      name: 'crm:clients.bulk.excel.importButton',
    });
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    expect(createBulk).toHaveBeenCalledWith([
      { clientCode: 'CLI-1', name: 'Alpha', fiscalCode: 'IT1' },
      { clientCode: 'CLI-2', name: 'Beta', fiscalCode: 'IT2' },
    ]);
    expect(within(dialog).getByText('crm:clients.bulk.excel.resultTitle')).toBeInTheDocument();
    expect(within(dialog).getByText(/crm:clients.bulk.excel.rowLabel/)).toBeInTheDocument();
    expect(importButton).toBeEnabled();
    await user.click(importButton);
    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(2));
    expect(createBulk.mock.calls[1]?.[0]).toEqual([
      { clientCode: 'CLI-2', name: 'Beta', fiscalCode: 'IT2' },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'crm:clients.bulk.excel.title' }),
      ).not.toBeInTheDocument(),
    );
  });

  test('shows formula-cell errors even when the Excel row is not importable', async () => {
    const user = userEvent.setup();
    renderClientsView();
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importExcel' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.excel.title' });
    const file = await makeClientWorkbookFile([], (workbook) => {
      const sheet = requireWorksheet(workbook, IMPORT_WORKSHEET_NAME);
      sheet.getCell(IMPORT_FIRST_DATA_ROW, CLIENT_IMPORT_FIELDS.indexOf('clientCode') + 1).value = {
        formula: 'CONCAT("CLI","-1")',
        result: 'CLI-1',
      };
      sheet.getCell(IMPORT_FIRST_DATA_ROW, CLIENT_IMPORT_FIELDS.indexOf('name') + 1).value = 'Acme';
    });

    fireEvent.change(within(dialog).getByLabelText('crm:clients.bulk.excel.fileLabel'), {
      target: { files: [file] },
    });

    expect(
      await within(dialog).findByText(/crm:clients.bulk.excel.errors.invalidCell/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.excel.importButton' }),
    ).toBeDisabled();
  });

  test('ignores a stale workbook read when a newer XLSX selection finishes first', async () => {
    let resolveFirstRead: ((source: ArrayBuffer) => void) | undefined;
    const firstFile = await makeClientWorkbookFile([
      { clientCode: 'CLI-1', name: 'First', fiscalCode: 'IT1' },
    ]);
    Object.defineProperty(firstFile, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveFirstRead = resolve;
        }),
    });
    const secondFile = await makeClientWorkbookFile([
      { clientCode: 'CLI-2', name: 'Second', fiscalCode: 'IT2' },
    ]);
    const createBulk = mock(
      async (): Promise<BulkClientCreateResponse> => ({
        summary: { total: 1, succeeded: 1, failed: 0 },
        results: [{ index: 0, success: true, client: { id: 'c2', name: 'Second' } }],
      }),
    );
    const user = userEvent.setup();
    renderClientsView({ onAddClientsBulk: createBulk });
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importExcel' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.excel.title' });
    const input = within(dialog).getByLabelText('crm:clients.bulk.excel.fileLabel');

    fireEvent.change(input, { target: { files: [firstFile] } });
    fireEvent.change(input, { target: { files: [secondFile] } });
    await within(dialog).findByText('crm:clients.bulk.excel.readyTitle');
    await act(async () => {
      resolveFirstRead?.(await firstFile.slice().arrayBuffer());
      await Promise.resolve();
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.excel.importButton' }),
    );

    expect(createBulk).toHaveBeenCalledWith([
      { clientCode: 'CLI-2', name: 'Second', fiscalCode: 'IT2' },
    ]);
  });
});

describe('<ClientsView /> contact validation', () => {
  beforeEach(() => {
    localStorage.clear();
    listAllProfileOptions.mockClear();
  });

  test('creates a client without requiring a contact', async () => {
    const props = renderClientsView();
    const user = await openAddClientModal();
    await fillRequiredClientFields(user);

    await submitClientForm(user);

    await waitFor(() => expect(props.onAddClient).toHaveBeenCalledTimes(1));
    // On create, empty optional fields must be omitted (sent as `undefined`,
    // stripped by normalizeClientPayload). `clientCreateBodySchema` only
    // accepts strings, so sending `null` would 400 the request — see
    // the edit-path test below for why update uses `null` instead.
    expect(props.onAddClient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Acme Srl',
        clientCode: 'ACME',
        fiscalCode: 'IT12345678901',
        contacts: [],
        contactName: undefined,
        email: undefined,
        phone: undefined,
      }),
    );
    const createPayload = (props.onAddClient as ReturnType<typeof mock>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    for (const field of ['contactName', 'email', 'phone', 'description', 'atecoCode', 'website']) {
      expect(createPayload[field]).not.toBeNull();
    }
    expect(screen.queryByText('common:validation.required')).not.toBeInTheDocument();
  });

  test('regression #405: edit submit sends null for cleared email/phone/contactName', async () => {
    // Render a client whose primary contact is already cleared (no legacy
    // contactName/email/phone, no contacts array). Opening edit and submitting
    // without changes used to send `undefined` for these fields, which
    // `normalizeClientPayload` stripped from the wire body — so the server
    // never saw the keys and never cleared the columns. The fix sends
    // explicit `null` for cleared fields.
    const existingClient: Client = {
      id: 'client-1',
      name: 'Acme Srl',
      clientCode: 'ACME',
      fiscalCode: 'IT12345678901',
      contacts: [],
    };
    const props = renderClientsView({ clients: [existingClient] });

    const user = userEvent.setup();
    const nameCell = await screen.findByText('Acme Srl');
    const row = nameCell.closest('tr');
    if (!row) throw new Error('row for existing client not found');
    await user.click(row);

    await screen.findByText('crm:clients.editClient');

    await submitClientForm(user);

    await waitFor(() => expect(props.onUpdateClient).toHaveBeenCalledTimes(1));
    expect(props.onUpdateClient).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        contacts: [],
        contactName: null,
        email: null,
        phone: null,
      }),
    );
  });

  test('requires a contact name when submitting a partially filled contact draft', async () => {
    const props = renderClientsView();
    const user = await openAddClientModal();
    await fillRequiredClientFields(user);

    await user.click(screen.getByRole('button', { name: 'crm:clients.addContact' }));
    await user.type(screen.getByPlaceholderText('crm:clients.rolePlaceholder'), 'Buyer');
    await submitClientForm(user);

    expect(props.onAddClient).not.toHaveBeenCalled();
    expect(screen.getByText('common:validation.required')).toBeInTheDocument();
  });

  test('requires a contact name when saving a contact draft', async () => {
    const props = renderClientsView();
    const user = await openAddClientModal();

    await user.click(screen.getByRole('button', { name: 'crm:clients.addContact' }));
    await user.click(screen.getAllByRole('button', { name: 'common:buttons.save' })[0]);

    expect(props.onAddClient).not.toHaveBeenCalled();
    expect(screen.getByText('common:validation.required')).toBeInTheDocument();
  });
});

describe('<ClientsView /> dark-mode form inputs', () => {
  beforeEach(() => {
    localStorage.clear();
    listAllProfileOptions.mockClear();
  });

  test('form fields render the theme-aware shadcn Input, not a hardcoded light fill', async () => {
    renderClientsView();
    await openAddClientModal();

    const codeInput = screen.getByPlaceholderText('crm:clients.clientCodePlaceholder');
    // Migrated to the shadcn Input primitive so the theme-aware base (and aria-invalid
    // destructive state) applies instead of the old bg-zinc-50 / bg-red-50 light slab.
    expect(codeInput).toHaveAttribute('data-slot', 'input');
    expect(codeInput.className).not.toContain('bg-zinc-50');
    expect(codeInput.className).not.toContain('bg-red-50');
    expect(codeInput.className).not.toContain('border-zinc-200');
  });
});

describe('<ClientsView /> dark-mode error banners (issue #768 follow-up)', () => {
  test('the contact + general validation banners avoid light-only red classes', async () => {
    const source = await readComponentSource('CRM/ClientsView.tsx');
    // Error banners use translucent red plus an explicit dark-mode text color so they read
    // correctly on the dark dialog surface, matching the amber warning banners from #768.
    expectSourceContainsAll(source, ['border-red-500/30', 'bg-red-500/10', 'dark:text-red-300']);
    // The old light-only banner border (a pale red slab in dark mode) is gone. Input invalid
    // states use border-red-500, so border-red-200 is unique to the message banners here.
    expectSourceOmitsAll(source, ['border-red-200']);
  });
});

describe('<ClientsView /> dark-mode form chrome', () => {
  test('field labels, table containers, and the page header use theme tokens, not light zinc', async () => {
    const source = await readComponentSource('CRM/ClientsView.tsx');
    // Field labels, the manage-values table containers, and the page title/subtitle adapt to the
    // theme instead of rendering as low-contrast zinc text/borders on the dark surface. The
    // contact-draft panel must be themed too: its labels resolve to text-muted-foreground, so a
    // light bg-zinc-50 panel would make them low-contrast in dark mode (PR #798 review).
    expectSourceContainsAll(source, [
      'text-xs font-bold text-muted-foreground',
      'containerClassName="shadow-none border-border rounded-2xl"',
      '<h2 className="text-2xl font-semibold text-foreground">',
      'p-4 bg-muted/50 rounded-xl border border-border',
    ]);
    expectSourceOmitsAll(source, [
      'text-xs font-bold text-zinc-500',
      'shadow-none border-zinc-200 rounded-2xl',
      'text-2xl font-semibold text-zinc-800',
      'p-4 bg-zinc-50 rounded-xl border border-zinc-200',
    ]);
  });
});
