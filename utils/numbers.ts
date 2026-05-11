import type { DiscountType, SupplierUnitType } from '../types';

// Rounds a currency value to 2 decimal places, matching the server's
// `roundCurrency` in `server/utils/invoice-math.ts` so the frontend
// previews stay in sync with persisted invoice totals.
export const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

export const parseNumberInputValue = (value: string, fallback: number = 0): number => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// Variant for callers that need to distinguish "cleared" (undefined) from
// "typed 0" — e.g. validation that requires the user to enter a value.
export const parseOptionalNumberInputValue = (value: string): number | undefined => {
  if (value === '') return undefined;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
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
}

export const getEffectiveCost = (item: PricingItem): number => {
  if (item.supplierQuoteItemId) return Number(item.supplierQuoteUnitPrice ?? 0);
  return Number(item.productCost ?? 0);
};

export const getEffectiveMol = (item: PricingItem): number => {
  return item.productMolPercentage ? Number(item.productMolPercentage) : 0;
};

export interface ItemPricingContext {
  baseCost: number;
  unitCost: number;
  molPercentage: number;
  quantity: number;
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
  const lineCost = unitCost * quantity;
  return { baseCost, unitCost, molPercentage, quantity, lineCost };
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
    const lineSubtotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    const lineDiscount = (lineSubtotal * (item.discount || 0)) / 100;
    subtotal += lineSubtotal - lineDiscount;

    const cost = getEffectiveCost(item);
    totalCost +=
      Number(item.quantity || 0) *
      convertUnitPrice(cost, 'hours', item.unitType || defaultUnitType);
  });

  const rawDiscountAmount =
    discountType === 'currency'
      ? Math.min(Math.max(globalDiscount, 0), subtotal)
      : subtotal * (globalDiscount / 100);
  const rawTotal = subtotal - rawDiscountAmount;
  const rawMargin = rawTotal - totalCost;
  // Round to 2dp to match `computeInvoiceTotals` on the server and avoid
  // floating-point drift in previews (e.g. 0.1 * 0.2 → 0.020000000000000004).
  const total = roundCurrency(rawTotal);
  const margin = roundCurrency(rawMargin);
  return {
    subtotal: roundCurrency(subtotal),
    discountAmount: roundCurrency(rawDiscountAmount),
    total,
    totalCost: roundCurrency(totalCost),
    margin,
    marginPercentage: total > 0 ? roundCurrency((margin / total) * 100) : 0,
  };
};

export const formatDiscountValue = (
  discount: number,
  discountType: DiscountType,
  currency: string,
): string => (discountType === 'currency' ? `${discount} ${currency}` : `${discount}%`);
