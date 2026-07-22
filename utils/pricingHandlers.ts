import {
  calcProductMolPercentage,
  calcProductSalePrice,
  getEffectiveMol,
  getEffectiveUnitCost,
  getItemPricingContext,
  MAX_MOL_PERCENTAGE,
  MIN_MOL_PERCENTAGE,
  type PricingItem,
  parseOptionalNumberInputValue,
  roundCurrency,
} from './numbers';

const LEGACY_PRICING_SEMANTICS_VERSION = 1;
const HOURS_PER_DAY = 8;

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
    const storedProductCost =
      newCost !== undefined &&
      cur.unitType === 'days' &&
      cur.pricingSemanticsVersion === LEGACY_PRICING_SEMANTICS_VERSION
        ? newCost / HOURS_PER_DAY
        : newCost;
    const updated = [...items];
    updated[index] = {
      ...cur,
      productMolPercentage: newMol,
      // New lines and supplier-sourced costs store the displayed numeric value. Historical
      // product-backed day lines retain their hourly storage contract so an edit cannot make the
      // legacy x8 read path multiply an already-daily value again.
      ...(cur.supplierQuoteItemId
        ? { supplierQuoteUnitPrice: newCost ?? null }
        : { productCost: storedProductCost }),
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

export const makeRevenueUpdater =
  <T extends { items?: PricingItem[] }>(index: number, value: string) =>
  (prev: T): T => {
    const items = prev.items || [];
    const cur = items[index];
    if (!cur) return prev;

    const newRevenue = parseOptionalNumberInputValue(value);
    if (newRevenue === undefined) {
      const updated = [...items];
      updated[index] = {
        ...cur,
        unitPrice: undefined,
        productMolPercentage: null,
      };
      return { ...prev, items: updated };
    }

    const { netRevenue, revenueMultiplier, unitCost } = getItemPricingContext(cur);
    if (!Number.isFinite(revenueMultiplier) || revenueMultiplier <= 0) return prev;
    if (Number.isFinite(cur.unitPrice) && newRevenue === netRevenue) return prev;

    const newUnitPrice = roundCurrency(newRevenue / revenueMultiplier);
    const updated = [...items];
    updated[index] = {
      ...cur,
      unitPrice: newUnitPrice,
      productMolPercentage: calcProductMolPercentage(unitCost, newUnitPrice),
    };
    return { ...prev, items: updated };
  };
