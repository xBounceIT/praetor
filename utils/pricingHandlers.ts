import type { SupplierUnitType } from '../types';
import {
  calcProductSalePrice,
  convertUnitPrice,
  getEffectiveCost,
  getEffectiveMol,
  type PricingItem,
  parseNumberInputValue,
  roundToTwoDecimals,
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
    const newCost = parseNumberInputValue(value);
    const curUnitCost = convertUnitPrice(
      getEffectiveCost(cur),
      'hours',
      cur.unitType || defaultUnitType,
    );
    if (newCost === curUnitCost) return prev;
    const curMol = getEffectiveMol(cur);
    const hourlyCost = convertUnitPrice(newCost, cur.unitType || defaultUnitType, 'hours');
    const newUnitPrice = calcProductSalePrice(newCost, curMol);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: roundToTwoDecimals(newUnitPrice),
      ...(cur.supplierQuoteItemId
        ? { supplierQuoteUnitPrice: roundToTwoDecimals(hourlyCost) }
        : { productCost: roundToTwoDecimals(hourlyCost) }),
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
    const newMol = parseNumberInputValue(value);
    const curMol = getEffectiveMol(cur);
    if (newMol === curMol) return prev;
    const curCost = convertUnitPrice(
      getEffectiveCost(cur),
      'hours',
      cur.unitType || defaultUnitType,
    );
    const newUnitPrice = calcProductSalePrice(curCost, newMol);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: roundToTwoDecimals(newUnitPrice),
      productMolPercentage: roundToTwoDecimals(newMol),
    };
    return { ...prev, items: updated };
  };
