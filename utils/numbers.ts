import type { DiscountType, SupplierUnitType } from '../types';

const CURRENCY_DECIMAL_PLACES = 2;

const shiftDecimal = (value: number, decimalPlaces: number): number => {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  return Number(`${coefficient}e${Number(exponent) + decimalPlaces}`);
};

// Match the NUMERIC(_, 2) precision used by the backend so frontend and backend agree on
// rendered totals. Mirrors `roundCurrency` in `server/utils/invoice-math.ts`.
export const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return value;

  const sign = Math.sign(value);
  if (sign === 0) return 0;

  const cents = Math.round(shiftDecimal(Math.abs(value), CURRENCY_DECIMAL_PLACES));
  if (cents === 0) return 0;

  return sign * shiftDecimal(cents, -CURRENCY_DECIMAL_PLACES);
};

export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const convertUnitPrice = (
  price: number,
  fromType: SupplierUnitType,
  toType: SupplierUnitType,
): number => {
  if (fromType === toType) return price;
  const hourly = fromType === 'days' ? price / 8 : price;
  return toType === 'days' ? hourly * 8 : hourly;
};

export const calcProductSalePrice = (cost: number, molPercentage: number): number => {
  // Guard against ≥100% MOL (would produce ≤0 or negative denominator)
  if (molPercentage >= 100) return cost;
  return cost / (1 - molPercentage / 100);
};

export interface PricingItem {
  unitPrice?: number;
  discount?: number;
  supplierQuoteItemId?: string | null;
  supplierQuoteUnitPrice?: number | null;
  productCost?: number;
  unitType?: SupplierUnitType;
  quantity?: number;
  productMolPercentage?: number | null;
  // Number of months the line runs (issue #757). Multiplies cost and revenue alongside
  // quantity. Absent/invalid → 1, so items that never set it (offers, orders, invoices)
  // keep their existing totals.
  durationMonths?: number;
}

export const getEffectiveCost = (item: PricingItem): number => {
  if (item.supplierQuoteItemId) return Number(item.supplierQuoteUnitPrice ?? 0);
  return Number(item.productCost ?? 0);
};

export const getEffectiveMol = (item: PricingItem): number => {
  return item.productMolPercentage ? Number(item.productMolPercentage) : 0;
};

export const getEffectiveDurationMonths = (item: PricingItem): number => {
  const months = Number(item.durationMonths ?? 1);
  return Number.isFinite(months) && months > 0 ? months : 1;
};

export interface ItemPricingContext {
  baseCost: number;
  unitCost: number;
  molPercentage: number;
  quantity: number;
  durationMonths: number;
  lineCost: number;
}

export const getItemPricingContext = (
  item: PricingItem,
  defaultUnitType: SupplierUnitType = 'hours',
): ItemPricingContext => {
  const baseCost = getEffectiveCost(item);
  const unitCost = convertUnitPrice(baseCost, 'hours', item.unitType || defaultUnitType);
  const molPercentage = getEffectiveMol(item);
  const quantity = Number(item.quantity || 0);
  const durationMonths = getEffectiveDurationMonths(item);
  const lineCost = unitCost * quantity * durationMonths;
  return { baseCost, unitCost, molPercentage, quantity, durationMonths, lineCost };
};

export interface PricingTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
  totalCost: number;
  margin: number;
  marginPercentage: number;
}

export const calculatePricingTotals = (
  items: PricingItem[],
  globalDiscount: number,
  defaultUnitType: SupplierUnitType = 'hours',
  discountType: DiscountType = 'percentage',
): PricingTotals => {
  let subtotal = 0;
  let totalCost = 0;

  items.forEach((item) => {
    const durationMonths = getEffectiveDurationMonths(item);
    const lineSubtotal = Number(item.quantity || 0) * Number(item.unitPrice || 0) * durationMonths;
    const lineDiscount = (lineSubtotal * (item.discount || 0)) / 100;
    subtotal += lineSubtotal - lineDiscount;

    const cost = getEffectiveCost(item);
    totalCost +=
      Number(item.quantity || 0) *
      convertUnitPrice(cost, 'hours', item.unitType || defaultUnitType) *
      durationMonths;
  });

  const discountAmount =
    discountType === 'currency'
      ? Math.min(Math.max(globalDiscount, 0), subtotal)
      : subtotal * (globalDiscount / 100);
  const total = subtotal - discountAmount;
  const margin = total - totalCost;
  const marginPercentage = total > 0 ? (margin / total) * 100 : 0;

  // Round at the same precision the backend uses so the rendered totals match what gets
  // persisted (NUMERIC(_, 2)). Without this, accumulating floats like 0.1 + 0.2 leak the
  // 0.30000000000000004 representation into the UI while the backend stores 0.30.
  return {
    subtotal: roundCurrency(subtotal),
    discountAmount: roundCurrency(discountAmount),
    total: roundCurrency(total),
    totalCost: roundCurrency(totalCost),
    margin: roundCurrency(margin),
    marginPercentage: roundCurrency(marginPercentage),
  };
};

export const formatDiscountValue = (
  discount: number,
  discountType: DiscountType,
  currency: string,
): string => (discountType === 'currency' ? `${discount} ${currency}` : `${discount}%`);
