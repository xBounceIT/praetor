import type { QuoteCommunicationChannel } from '../../services/api/quoteCommunicationChannels';

export const DEFAULT_QUOTE_COMMUNICATION_CHANNELS: QuoteCommunicationChannel[] = [
  {
    id: 'qcc_email',
    name: 'Email',
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
];

export const noopQuoteCommunicationChannelMutation = async () => {};
