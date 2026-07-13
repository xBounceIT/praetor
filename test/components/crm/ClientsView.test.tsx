import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type {
  BulkClientCreateResponse,
  Client,
  ClientProfileOption,
  ClientProfileOptionsByCategory,
} from '../../../types';
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

describe('<ClientsView /> bulk creation actions', () => {
  beforeEach(() => {
    localStorage.clear();
    listAllProfileOptions.mockClear();
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
      screen.getByRole('menuitem', { name: 'crm:clients.bulk.importCsv' }),
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

  test('CSV dialog always shows the import contract and header-only template action', async () => {
    const user = userEvent.setup();
    renderClientsView();
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importCsv' }));

    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.csv.title' });
    const fileInput = within(dialog).getByLabelText('crm:clients.bulk.csv.fileLabel');
    const browseButton = within(dialog).getByRole('button', {
      name: 'crm:clients.bulk.csv.browseButton',
    });
    const openFilePicker = mock(() => undefined);
    Object.defineProperty(fileInput, 'click', { value: openFilePicker });
    expect(fileInput).toHaveClass('hidden');
    expect(within(dialog).getByText('crm:clients.bulk.csv.noFileSelected')).toBeVisible();
    expect(browseButton).toBeVisible();
    fireEvent.click(browseButton);
    expect(openFilePicker).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText('crm:clients.bulk.csv.structureTitle')).toBeInTheDocument();
    expect(within(dialog).getByText('clientCode')).toBeInTheDocument();
    expect(within(dialog).getByText('fiscalCode')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.csv.downloadTemplate' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.csv.importButton' }),
    ).toBeDisabled();
  });

  test('CSV import maps mixed server results back to source lines and blocks duplicate submission', async () => {
    const createBulk = mock(
      async (): Promise<BulkClientCreateResponse> => ({
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
      }),
    );
    const user = userEvent.setup();
    renderClientsView({ onAddClientsBulk: createBulk });
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importCsv' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.csv.title' });
    const fileInput = within(dialog).getByLabelText('crm:clients.bulk.csv.fileLabel');
    const file = new File(
      ['fiscalCode;name;clientCode\n', 'IT1;Alpha;CLI-1\n', 'IT2;Beta;CLI-2'],
      'clients.csv',
      { type: 'text/csv' },
    );

    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByText('crm:clients.bulk.csv.readyTitle');
    const importButton = within(dialog).getByRole('button', {
      name: 'crm:clients.bulk.csv.importButton',
    });
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    expect(createBulk).toHaveBeenCalledWith([
      { fiscalCode: 'IT1', name: 'Alpha', clientCode: 'CLI-1' },
      { fiscalCode: 'IT2', name: 'Beta', clientCode: 'CLI-2' },
    ]);
    expect(within(dialog).getByText('crm:clients.bulk.csv.resultTitle')).toBeInTheDocument();
    expect(within(dialog).getByText(/crm:clients.bulk.csv.rowLabel/)).toBeInTheDocument();
    expect(importButton).toBeDisabled();
  });

  test('shows structural errors even when a CSV has no importable rows', async () => {
    const user = userEvent.setup();
    renderClientsView();
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importCsv' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.csv.title' });
    const file = new File(
      ['clientCode,name,fiscalCode\nCLI-1,Missing fiscal code'],
      'invalid.csv',
      { type: 'text/csv' },
    );

    fireEvent.change(within(dialog).getByLabelText('crm:clients.bulk.csv.fileLabel'), {
      target: { files: [file] },
    });

    expect(
      await within(dialog).findByText(/crm:clients.bulk.csv.errors.fieldMismatch/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.csv.importButton' }),
    ).toBeDisabled();
  });

  test('ignores a stale file read when a newer CSV selection finishes first', async () => {
    let resolveFirstRead: ((source: string) => void) | undefined;
    const firstFile = new File(['ignored'], 'first.csv', { type: 'text/csv' });
    Object.defineProperty(firstFile, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          resolveFirstRead = resolve;
        }),
    });
    const secondFile = new File(['clientCode,name,fiscalCode\nCLI-2,Second,IT2'], 'second.csv', {
      type: 'text/csv',
    });
    const createBulk = mock(
      async (): Promise<BulkClientCreateResponse> => ({
        summary: { total: 1, succeeded: 1, failed: 0 },
        results: [{ index: 0, success: true, client: { id: 'c2', name: 'Second' } }],
      }),
    );
    const user = userEvent.setup();
    renderClientsView({ onAddClientsBulk: createBulk });
    await openClientCreationMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'crm:clients.bulk.importCsv' }));
    const dialog = await screen.findByRole('dialog', { name: 'crm:clients.bulk.csv.title' });
    const input = within(dialog).getByLabelText('crm:clients.bulk.csv.fileLabel');

    fireEvent.change(input, { target: { files: [firstFile] } });
    fireEvent.change(input, { target: { files: [secondFile] } });
    await within(dialog).findByText('crm:clients.bulk.csv.readyTitle');
    await act(async () => {
      resolveFirstRead?.('clientCode,name,fiscalCode\nCLI-1,First,IT1');
      await Promise.resolve();
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'crm:clients.bulk.csv.importButton' }),
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
