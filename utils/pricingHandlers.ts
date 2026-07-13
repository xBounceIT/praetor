import type { SupplierUnitType } from '../types';
import {
  calcProductSalePrice,
  convertUnitPrice,
  getEffectiveMol,
  getEffectiveUnitCost,
  MAX_MOL_PERCENTAGE,
  type PricingItem,
  parseOptionalNumberInputValue,
} from './numbers';

export const makeCostUpdater =
  <T extends { items?: PricingItem[] }>(
    index: number,
    value: string,
    defaultUnitType: SupplierUnitType = 'hours',
  ) =>
  (prev: T): T => {
    const items = prev.items || [];
    const cur = items[index];
    if (!cur) return prev;
    const newCost = parseOptionalNumberInputValue(value);
    const curUnitCost = getEffectiveUnitCost(cur, defaultUnitType);
    if (newCost === curUnitCost && value !== '') return prev;
    const curMol = getEffectiveMol(cur);
    const newUnitPrice = calcProductSalePrice(newCost ?? 0, curMol);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: newUnitPrice,
      // The entered cost is in the LINE's unit. Supplier-sourced costs are stored in that same
      // unit (the supplier item's — the server snapshot, forward sync and staleness compare all
      // assume it; storing hourly here pushed a ÷8 cost onto a days-priced supplier item, #812
      // round 19); product costs keep the canonical hourly basis.
      ...(cur.supplierQuoteItemId
        ? { supplierQuoteUnitPrice: newCost ?? null }
        : {
            productCost:
              newCost === undefined
                ? undefined
                : convertUnitPrice(newCost, cur.unitType || defaultUnitType, 'hours'),
          }),
    };
    return { ...prev, items: updated };
  };

export const makeMolUpdater =
  <T extends { items?: PricingItem[] }>(
    index: number,
    value: string,
    defaultUnitType: SupplierUnitType = 'hours',
  ) =>
  (prev: T): T => {
    const items = prev.items || [];
    const cur = items[index];
    if (!cur) return prev;
    const parsedMol = parseOptionalNumberInputValue(value);
    const newMol =
      parsedMol === undefined ? undefined : Math.min(MAX_MOL_PERCENTAGE, Math.max(0, parsedMol));
    const curMol = getEffectiveMol(cur);
    if (newMol === curMol && value !== '') return prev;
    const curCost = getEffectiveUnitCost(cur, defaultUnitType);
    const newUnitPrice = calcProductSalePrice(curCost, newMol ?? 0);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: newUnitPrice,
      productMolPercentage: newMol ?? null,
    };
    return { ...prev, items: updated };
  };
