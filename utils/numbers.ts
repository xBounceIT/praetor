import type { SupplierUnitType } from '../types';

export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const roundToTwoDecimals = (value: number) => {
  return Number(Math.round(Number(value + 'e2')) + 'e-2');
};

/** Convert a unit price from one unit type to another via hourly base rate. */
export const convertUnitPrice = (
  price: number,
  fromType: SupplierUnitType,
  toType: SupplierUnitType,
): number => {
  if (fromType === toType) return price;
  const hourly = fromType === 'days' ? price / 8 : price;
  return toType === 'days' ? hourly * 8 : hourly;
};
