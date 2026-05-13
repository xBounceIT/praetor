export const normalizeCurrency = (currency: string): string =>
  currency === 'USD' ? '$' : currency;
