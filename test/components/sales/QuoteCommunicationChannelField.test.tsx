import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import QuoteCommunicationChannelField from '../../../components/sales/QuoteCommunicationChannelField';
import type { QuoteCommunicationChannel } from '../../../services/api/quoteCommunicationChannels';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const baseChannels: QuoteCommunicationChannel[] = [
  {
    id: 'qcc_email',
    name: 'Email',
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
    expect(manageButton.querySelector('svg')).not.toBeNull();

    fireEvent.click(manageButton);
    fireEvent.change(screen.getByPlaceholderText('sales:communicationChannels.namePlaceholder'), {
      target: { value: 'PEC' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.add' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({ name: 'PEC' });
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
});
