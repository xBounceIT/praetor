import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import QuoteCommunicationChannelField from '../../../components/sales/QuoteCommunicationChannelField';
import type { QuoteCommunicationChannel } from '../../../services/api/quoteCommunicationChannels';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

const baseChannels: QuoteCommunicationChannel[] = [
  {
    id: 'qcc_email',
    name: 'Email',
    icon: 'envelope',
    isDefault: true,
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
];

const renderField = (
  overrides: Partial<React.ComponentProps<typeof QuoteCommunicationChannelField>> = {},
) =>
  render(
    <QuoteCommunicationChannelField
      id="channel"
      value="qcc_email"
      channels={baseChannels}
      canManage={true}
      onChange={mock()}
      onCreate={mock(async () => undefined)}
      onUpdate={mock(async () => undefined)}
      onDelete={mock(async () => undefined)}
      {...overrides}
    />,
  );

describe('<QuoteCommunicationChannelField />', () => {
  test('opens inline management from the gear manage button', async () => {
    const onCreate = mock(async () => undefined);
    renderField({ onCreate });

    const manageButton = screen.getByRole('button', { name: 'common:buttons.manage' });
    expect(manageButton.querySelector('.fa-gear')).not.toBeNull();
    expect(manageButton).toHaveAttribute('data-size', 'xs');

    fireEvent.click(manageButton);
    fireEvent.change(screen.getByPlaceholderText('sales:communicationChannels.namePlaceholder'), {
      target: { value: 'PEC' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.add' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({ name: 'PEC', icon: 'comments' });
    });
  });

  test('renders refreshed dropdown options after manage actions update the channel list', () => {
    const { rerender } = renderField();

    rerender(
      <QuoteCommunicationChannelField
        id="channel"
        value="qcc_pec"
        channels={[
          ...baseChannels,
          {
            id: 'qcc_pec',
            name: 'PEC',
            icon: 'comments',
            isDefault: false,
            clientQuoteCount: 0,
            supplierQuoteCount: 0,
            totalQuoteCount: 0,
          },
        ]}
        canManage={true}
        onChange={mock()}
        onCreate={mock(async () => undefined)}
        onUpdate={mock(async () => undefined)}
        onDelete={mock(async () => undefined)}
      />,
    );

    expect(screen.getByText('PEC')).toBeInTheDocument();
  });

  test('groups each channel edit and delete action behind an ellipsis menu', async () => {
    const user = userEvent.setup();
    const onUpdate = mock(async () => undefined);
    const onDelete = mock(async () => undefined);
    renderField({
      channels: [
        ...baseChannels,
        {
          id: 'qcc_phone',
          name: 'Phone',
          icon: 'comments',
          isDefault: false,
          clientQuoteCount: 0,
          supplierQuoteCount: 0,
          totalQuoteCount: 0,
        },
      ],
      onUpdate,
      onDelete,
    });

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.manage' }));

    const customActions = screen.getByRole('button', { name: 'table.rowActions' });
    expect(customActions.querySelector('.fa-ellipsis')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.edit' })).not.toBeInTheDocument();

    await user.click(customActions);
    const editAction = await screen.findByRole('button', { name: 'common:buttons.edit' });
    expect(editAction.closest('[data-standard-table-action-menu="true"]')).toHaveStyle({
      zIndex: '100',
    });
    await user.click(editAction);

    expect(screen.getByPlaceholderText('sales:communicationChannels.namePlaceholder')).toHaveValue(
      'Phone',
    );
    expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('communicationChannels.icons.video'));
    await user.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('qcc_phone', { name: 'Phone', icon: 'video' }),
    );

    await user.click(customActions);
    await user.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('qcc_phone'));
  });

  test('shows default icons and keeps default channels immutable', () => {
    renderField();

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.manage' }));

    const emailRow = screen
      .getAllByText('Email')
      .map((element) => element.closest('tr'))
      .find((row) => row !== null);
    expect(emailRow?.querySelector('.fa-envelope')).not.toBeNull();
    expect(screen.getByLabelText('sales:communicationChannels.defaultLocked')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'common:labels.actions: Email' }),
    ).not.toBeInTheDocument();
  });

  test('keeps the manage control compact and raises its nested modal above quote dialogs', async () => {
    const source = await readComponentSource('sales/QuoteCommunicationChannelField.tsx');

    expectSourceContainsAll(source, [
      'className="relative h-4"',
      'size="xs"',
      'className="absolute -top-1 right-0 gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"',
      'className="fa-solid fa-gear"',
      'zIndex={90}',
      'StandardTable<QuoteCommunicationChannel>',
    ]);
    expectSourceOmitsAll(source, [
      'flex min-h-6 items-center justify-between gap-2',
      'flex h-5 items-start justify-between gap-2',
      'hover:bg-transparent',
      'leading-none',
      '<table',
    ]);
  });
});
