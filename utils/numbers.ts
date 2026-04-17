import type { SupplierUnitType } from '../types';
export type UnitType = SupplierUnitType;

export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const roundToTwoDecimals = (value: number) => {
  return Number(Math.round(Number(value + 'e2')) + 'e-2');
};

export const convertUnitPrice = (price: number, fromType: UnitType, toType: UnitType): number => {
  if (fromType === toType) return price;
  const hourly = fromType === 'days' ? price / 8 : price;
  return toType === 'days' ? hourly * 8 : hourly;
};

export const calcProductSalePrice = (cost: number, molPercentage: number): number => {
  if (molPercentage >= 100) return cost;
  return cost / (1 - molPercentage / 100);
};

export interface PricingItem {
  unitPrice?: number;
  discount?: number;
  supplierQuoteItemId?: string | null;
  supplierQuoteUnitPrice?: number | null;
  specialBidId?: string;
  specialBidUnitPrice?: number | null;
  productCost?: number;
  unitType?: UnitType;
  quantity?: number;
  productMolPercentage?: number | null;
  specialBidMolPercentage?: number | null;
}

export const getEffectiveCost = (item: PricingItem): number => {
  if (item.supplierQuoteItemId) return Number(item.supplierQuoteUnitPrice ?? 0);
  if (item.specialBidId) return Number(item.specialBidUnitPrice ?? 0);
  return Number(item.productCost ?? 0);
};

export const getEffectiveMol = (item: PricingItem): number => {
  const molSource = item.specialBidId ? item.specialBidMolPercentage : item.productMolPercentage;
  return molSource ? Number(molSource) : 0;
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
  defaultUnitType: UnitType = 'hours',
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
  defaultUnitType: UnitType = 'hours',
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

  const discountAmount = subtotal * (globalDiscount / 100);
  const total = subtotal - discountAmount;
  const margin = total - totalCost;
  const marginPercentage = total > 0 ? (margin / total) * 100 : 0;

  return { subtotal, discountAmount, total, margin, marginPercentage };
};
