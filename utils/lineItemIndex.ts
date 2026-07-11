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
