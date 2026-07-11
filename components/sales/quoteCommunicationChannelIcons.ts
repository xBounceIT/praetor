import type { QuoteCommunicationChannelIcon } from '../../services/api/quoteCommunicationChannels';

export const QUOTE_COMMUNICATION_CHANNEL_ICON_OPTIONS: ReadonlyArray<{
  value: QuoteCommunicationChannelIcon;
  className: string;
}> = [
  { value: 'comments', className: 'fa-solid fa-comments' },
  { value: 'envelope', className: 'fa-solid fa-envelope' },
  { value: 'globe', className: 'fa-solid fa-globe' },
  { value: 'phone', className: 'fa-solid fa-phone' },
  { value: 'video', className: 'fa-solid fa-video' },
  { value: 'whatsapp', className: 'fa-brands fa-whatsapp' },
];

export const getQuoteCommunicationChannelIconClass = (
  icon: QuoteCommunicationChannelIcon,
): string =>
  QUOTE_COMMUNICATION_CHANNEL_ICON_OPTIONS.find((option) => option.value === icon)?.className ??
  'fa-solid fa-comments';
