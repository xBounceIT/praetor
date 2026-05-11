import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { ClientProfileOption, ClientProfileOptionsByCategory } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

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

const ClientsView = (await import('../../../components/CRM/ClientsView')).default;

const renderClientsView = (overrides: Partial<ComponentProps<typeof ClientsView>> = {}) => {
  const props: ComponentProps<typeof ClientsView> = {
    clients: [],
    onAddClient: mock(async () => {}),
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
    expect(screen.queryByText('common:validation.required')).not.toBeInTheDocument();
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

describe('<ClientsView /> disable toggle confirmation', () => {
  test('routes the disable action through a confirmation dialog instead of an immediate update', async () => {
    const source = await Bun.file(
      new URL('../../../components/CRM/ClientsView.tsx', import.meta.url),
    ).text();

    // The row action invokes requestToggleDisabled rather than onUpdateClient directly.
    expect(source).toContain('requestToggleDisabled(row);');
    expect(source).not.toMatch(
      /onUpdateClient\(row\.id,\s*\{\s*isDisabled:\s*!row\.isDisabled\s*\}\)/,
    );

    // Confirmation state and handlers are present.
    expect(source).toContain(
      'const [isToggleDisabledOpen, setIsToggleDisabledOpen] = useState(false);',
    );
    expect(source).toContain(
      'const [isTogglingDisabled, setIsTogglingDisabled] = useState(false);',
    );
    expect(source).toContain('const requestToggleDisabled = useCallback');
    expect(source).toContain('const cancelToggleDisabled = ');
    expect(source).toContain('const handleToggleDisabled = async () => {');

    // The confirm handler only fires onUpdateClient when the user confirms and not while in flight.
    expect(source).toContain(
      'if (!canUpdateClients || !clientToToggleDisabled || isTogglingDisabled) return;',
    );
    expect(source).toContain('setIsTogglingDisabled(true);');
    expect(source).toContain('isDisabled: !clientToToggleDisabled.isDisabled,');

    // A confirmation modal is rendered for the toggle action with the new translation keys.
    expect(source).toContain('isOpen={isToggleDisabledOpen && !!clientToToggleDisabled}');
    expect(source).toContain("'crm:clients.disableConfirmTitle'");
    expect(source).toContain("'crm:clients.enableConfirmTitle'");
    expect(source).toContain("'crm:clients.confirmDisable'");
    expect(source).toContain("'crm:clients.confirmEnable'");
  });
});
