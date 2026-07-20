import { roundCurrency } from './invoice-math.ts';
export const MIN_CLIENT_LINE_MOL_PERCENTAGE = -999.99;
export const MAX_CLIENT_LINE_MOL_PERCENTAGE = 99.99;

export type ClientLinePricingInput = {
  unitPrice: number;
  productCost: number | null;
  productMolPercentage: number | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteUnitPrice?: number | null;
};

export const calculateClientLineMol = ({
  unitPrice,
  productCost,
  supplierQuoteItemId,
  supplierQuoteUnitPrice,
}: ClientLinePricingInput): number | null => {
  const baseCost = supplierQuoteItemId
    ? Number(supplierQuoteUnitPrice ?? 0)
    : Number(productCost ?? 0);
  const unitCost = baseCost;
  const salePrice = Number(unitPrice);

  if (!Number.isFinite(unitCost) || !Number.isFinite(salePrice) || unitCost < 0 || salePrice < 0) {
    return null;
  }
  if (salePrice === 0) return unitCost === 0 ? 0 : null;

  const mol = roundCurrency(((salePrice - unitCost) / salePrice) * 100);
  return Math.min(MAX_CLIENT_LINE_MOL_PERCENTAGE, Math.max(MIN_CLIENT_LINE_MOL_PERCENTAGE, mol));
};

export const withCalculatedClientLineMol = <T extends ClientLinePricingInput>(
  item: T,
): Omit<T, 'productMolPercentage'> & { productMolPercentage: number | null } => ({
  ...item,
  productMolPercentage: calculateClientLineMol(item),
});
