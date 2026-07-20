import {
  calcProductMolPercentage,
  calcProductSalePrice,
  getEffectiveMol,
  getEffectiveUnitCost,
  MAX_MOL_PERCENTAGE,
  MIN_MOL_PERCENTAGE,
  type PricingItem,
  parseOptionalNumberInputValue,
} from './numbers';

export const makeCostUpdater =
  <T extends { items?: PricingItem[] }>(index: number, value: string) =>
  (prev: T): T => {
    const items = prev.items || [];
    const cur = items[index];
    if (!cur) return prev;
    const newCost = parseOptionalNumberInputValue(value);
    const curUnitCost = getEffectiveUnitCost(cur);
    if (newCost === curUnitCost && value !== '') return prev;
    const newMol =
      newCost === undefined ? null : calcProductMolPercentage(newCost, Number(cur.unitPrice ?? 0));
    const updated = [...items];
    updated[index] = {
      ...cur,
      productMolPercentage: newMol,
      // Quantity units never reprice a line. Preserve the entered numeric cost for both product
      // snapshots and supplier-sourced costs.
      ...(cur.supplierQuoteItemId
        ? { supplierQuoteUnitPrice: newCost ?? null }
        : { productCost: newCost }),
    };
    return { ...prev, items: updated };
  };

export const makeMolUpdater =
  <T extends { items?: PricingItem[] }>(index: number, value: string) =>
  (prev: T): T => {
    const items = prev.items || [];
    const cur = items[index];
    if (!cur) return prev;
    const parsedMol = parseOptionalNumberInputValue(value);
    const newMol =
      parsedMol === undefined
        ? undefined
        : Math.min(MAX_MOL_PERCENTAGE, Math.max(MIN_MOL_PERCENTAGE, parsedMol));
    const curMol = getEffectiveMol(cur);
    if (newMol === curMol && value !== '') return prev;
    const curCost = getEffectiveUnitCost(cur);
    const newUnitPrice = calcProductSalePrice(curCost, newMol ?? 0);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: newUnitPrice,
      productMolPercentage: newMol ?? null,
    };
    return { ...prev, items: updated };
  };

export const makeUnitPriceUpdater =
  <T extends { items?: PricingItem[] }>(index: number, value: string) =>
  (prev: T): T => {
    const items = prev.items || [];
    const cur = items[index];
    if (!cur) return prev;
    const newUnitPrice = parseOptionalNumberInputValue(value);
    if (newUnitPrice === cur.unitPrice && value !== '') return prev;
    const unitCost = getEffectiveUnitCost(cur);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: newUnitPrice,
      productMolPercentage:
        newUnitPrice === undefined ? null : calcProductMolPercentage(unitCost, newUnitPrice),
    };
    return { ...prev, items: updated };
  };
