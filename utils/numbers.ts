import type { DiscountType, SupplierUnitType } from '../types';

export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const roundToTwoDecimals = (value: number) => {
  return Number(Math.round(Number(value + 'e2')) + 'e-2');
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

  const discountAmount =
    discountType === 'currency'
      ? Math.min(Math.max(globalDiscount, 0), subtotal)
      : subtotal * (globalDiscount / 100);
  const total = subtotal - discountAmount;
  const margin = total - totalCost;
  const marginPercentage = total > 0 ? (margin / total) * 100 : 0;

  return { subtotal, discountAmount, total, margin, marginPercentage };
};

export const formatDiscountValue = (
  discount: number,
  discountType: DiscountType,
  currency: string,
): string => (discountType === 'currency' ? `${discount} ${currency}` : `${discount}%`);
