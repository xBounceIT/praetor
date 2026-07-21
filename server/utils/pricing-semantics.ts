export const LEGACY_PRICING_SEMANTICS_VERSION = 1 as const;
export const CURRENT_PRICING_SEMANTICS_VERSION = 2 as const;

export type PricingSemanticsVersion =
  | typeof LEGACY_PRICING_SEMANTICS_VERSION
  | typeof CURRENT_PRICING_SEMANTICS_VERSION;

export const normalizePricingSemanticsVersion = (
  value: unknown,
  fallback: PricingSemanticsVersion = CURRENT_PRICING_SEMANTICS_VERSION,
): PricingSemanticsVersion =>
  value === LEGACY_PRICING_SEMANTICS_VERSION
    ? LEGACY_PRICING_SEMANTICS_VERSION
    : value === CURRENT_PRICING_SEMANTICS_VERSION
      ? CURRENT_PRICING_SEMANTICS_VERSION
      : fallback;

export const normalizeHistoricalPricingSemanticsVersion = (
  value: unknown,
): PricingSemanticsVersion =>
  normalizePricingSemanticsVersion(value, LEGACY_PRICING_SEMANTICS_VERSION);

export const normalizeHistoricalPricingSemanticsItems = <
  T extends { pricingSemanticsVersion?: unknown },
>(
  items: readonly T[],
): Array<T & { pricingSemanticsVersion: PricingSemanticsVersion }> =>
  items.map((item) => ({
    ...item,
    pricingSemanticsVersion: normalizeHistoricalPricingSemanticsVersion(
      item.pricingSemanticsVersion,
    ),
  }));

type VersionedItem = {
  id: string;
  pricingSemanticsVersion?: PricingSemanticsVersion;
};

export const pricingSemanticsVersionForDocument = (
  storedItems: readonly { pricingSemanticsVersion?: unknown }[],
): PricingSemanticsVersion =>
  storedItems.reduce<PricingSemanticsVersion>(
    (oldest, item) =>
      Math.min(
        oldest,
        normalizeHistoricalPricingSemanticsVersion(item.pricingSemanticsVersion),
      ) as PricingSemanticsVersion,
    CURRENT_PRICING_SEMANTICS_VERSION,
  );

/**
 * When creating a document from another one, matching source row ids retain their exact
 * historical marker. A source row can be retained once only; copied, unknown, or new rows use
 * the source document contract instead.
 */
export const inheritPricingSemanticsVersions = <T extends { id?: string | null }>(
  items: readonly T[],
  sourceItems: readonly { id: string; pricingSemanticsVersion?: unknown }[],
): Array<T & { pricingSemanticsVersion: PricingSemanticsVersion }> => {
  const sourceById = new Map(
    sourceItems.map((item) => [
      item.id,
      normalizeHistoricalPricingSemanticsVersion(item.pricingSemanticsVersion),
    ]),
  );
  const documentVersion = pricingSemanticsVersionForDocument(sourceItems);
  const retainedSourceItemIds = new Set<string>();

  return items.map((item) => {
    const sourceVersion =
      item.id && !retainedSourceItemIds.has(item.id) ? sourceById.get(item.id) : undefined;
    if (item.id && sourceVersion !== undefined) retainedSourceItemIds.add(item.id);

    return {
      ...item,
      pricingSemanticsVersion: sourceVersion ?? documentVersion,
    };
  });
};

/**
 * A document keeps the pricing contract under which it was created. Existing row ids retain their
 * own marker; freshly generated ids inherit the document's oldest stored marker. New documents
 * have no stored rows and therefore use the current database default.
 */
export const preservePricingSemanticsVersions = <T extends VersionedItem>(
  items: T[],
  storedItems: Array<{ id: string; pricingSemanticsVersion: unknown }>,
): T[] => {
  if (storedItems.length === 0) return items;

  const storedById = new Map(
    storedItems.map((item) => [
      item.id,
      normalizeHistoricalPricingSemanticsVersion(item.pricingSemanticsVersion),
    ]),
  );
  const documentVersion = pricingSemanticsVersionForDocument(storedItems);

  return items.map((item) => ({
    ...item,
    pricingSemanticsVersion:
      item.pricingSemanticsVersion ?? storedById.get(item.id) ?? documentVersion,
  }));
};
