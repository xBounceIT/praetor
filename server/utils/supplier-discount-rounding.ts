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

type SupplierItemWithPreservedMarker<T extends NormalizedSupplierItem> = Omit<
  T,
  'legacyDiscountRounding'
> &
  NormalizedSupplierItem;

/**
 * Omission identifies a compatibility-window writer that still rounds discounted net units.
 * Marker-aware writers must send false explicitly for precise lines.
 */
export const legacyDiscountRoundingForWrite = (
  marker: boolean | undefined,
  discount: number,
): boolean => marker ?? discount !== 0;

/**
 * Keeps migrated calculation provenance when an older client resubmits document items without
 * the additive marker. Stable ids take precedence; positional fallback is limited to equal-length
 * legacy payloads so inserted or removed rows cannot inherit another line's rounding behavior.
 */
export const preserveLegacyDiscountRounding = <T extends NormalizedSupplierItem>(
  normalizedItems: T[],
  incomingItems: IncomingSupplierItem[],
  existingItems: ExistingSupplierItem[],
): SupplierItemWithPreservedMarker<T>[] => {
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const canFallbackByIndex = incomingItems.length === existingItems.length;

  return normalizedItems.map((item, index) => {
    const normalizedItem: SupplierItemWithPreservedMarker<T> = item;
    const incoming = incomingItems[index];
    if (incoming?.legacyDiscountRounding !== undefined) return normalizedItem;

    const existing = incoming?.id
      ? existingById.get(incoming.id)
      : canFallbackByIndex
        ? existingItems[index]
        : undefined;
    return existing
      ? { ...normalizedItem, legacyDiscountRounding: existing.legacyDiscountRounding }
      : normalizedItem;
  });
};
