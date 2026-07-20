type IncomingSupplierItem = {
  id?: string;
  legacyDiscountRounding?: boolean;
};

type ExistingSupplierItem = {
  id: string;
  legacyDiscountRounding: boolean;
};

type NormalizedSupplierItem = {
  legacyDiscountRounding?: boolean;
};

/**
 * Keeps migrated calculation provenance when an older client resubmits document items without
 * the additive marker. Stable ids take precedence; positional fallback is limited to equal-length
 * legacy payloads so inserted or removed rows cannot inherit another line's rounding behavior.
 */
export const preserveLegacyDiscountRounding = <T extends NormalizedSupplierItem>(
  normalizedItems: T[],
  incomingItems: IncomingSupplierItem[],
  existingItems: ExistingSupplierItem[],
): T[] => {
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const canFallbackByIndex = incomingItems.length === existingItems.length;

  return normalizedItems.map((item, index) => {
    const incoming = incomingItems[index];
    if (incoming?.legacyDiscountRounding !== undefined) return item;

    const existing = incoming?.id
      ? existingById.get(incoming.id)
      : canFallbackByIndex
        ? existingItems[index]
        : undefined;
    return existing?.legacyDiscountRounding ? { ...item, legacyDiscountRounding: true } : item;
  });
};
