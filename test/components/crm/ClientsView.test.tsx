import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { ClientProfileOption, ClientProfileOptionsByCategory } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
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

clearSpyStateAfterAll();

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
