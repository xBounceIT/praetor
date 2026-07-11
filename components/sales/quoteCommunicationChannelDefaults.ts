import type { QuoteCommunicationChannel } from '../../services/api/quoteCommunicationChannels';

export const DEFAULT_QUOTE_COMMUNICATION_CHANNELS: QuoteCommunicationChannel[] = [
  {
    id: 'qcc_email',
    name: 'Email',
    icon: 'envelope',
    isDefault: true,
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
  {
    id: 'qcc_telefono',
    name: 'Telefono',
    icon: 'phone',
    isDefault: true,
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
  {
    id: 'qcc_whatsapp',
    name: 'WhatsApp',
    icon: 'whatsapp',
    isDefault: true,
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
];

export const noopQuoteCommunicationChannelMutation = async () => {};
