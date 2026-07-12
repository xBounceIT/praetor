let temporaryLineItemSequence = 0;

/**
 * Creates a unique client-side id for unsaved line items. randomUUID is preferred, while the
 * monotonic fallback prevents same-millisecond collisions in non-secure browser contexts.
 */
export const isTemporaryLineItem = (item: { id: string }): boolean => item.id.startsWith('temp-');

export const createTemporaryLineItemId = (prefix = 'temp'): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return `${prefix}-${crypto.randomUUID()}`;
    } catch {}
  }

  temporaryLineItemSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${temporaryLineItemSequence.toString(36)}`;
};

/**
 * Builds a stable resolver from a line-item id to its current form-array index.
 * Sorted and filtered table rows can use it without coupling edits to the visible row position.
 */
export const createLineItemIndexResolver = (
  items: readonly { id: string }[] | null | undefined,
) => {
  const indexById = new Map<string, number>();
  items?.forEach((item, index) => {
    if (!indexById.has(item.id)) indexById.set(item.id, index);
  });

  return (item: { id: string }) => indexById.get(item.id) ?? -1;
};
