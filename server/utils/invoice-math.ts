type ItemMath = {
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  // Per-item Italian VAT (IVA) rate in percent. Optional so pre-tax-feature data still computes.
  taxRate?: number;
};

// Match the NUMERIC(_, 2) precision used for invoice columns so totals computed here
// align with what would be re-derived from the persisted rows. The frontend mirrors this
// helper in `utils/numbers.ts` so both layers agree on rendered values.
export const roundCurrency = (value: number) => Math.round(value * 100) / 100;

export const computeInvoiceTotals = (
  items: ItemMath[],
): { subtotal: number; taxTotal: number; total: number } => {
  let subtotalRaw = 0;
  let taxTotalRaw = 0;
  for (const item of items) {
    const quantity = item.quantity ?? 0;
    const unitPrice = item.unitPrice ?? 0;
    const discount = item.discount ?? 0;
    const discountFactor = 1 - discount / 100;
    const taxableAmount = quantity * unitPrice * discountFactor;
    const taxRate = item.taxRate ?? 0;
    subtotalRaw += taxableAmount;
    taxTotalRaw += (taxableAmount * taxRate) / 100;
  }
  const subtotal = roundCurrency(subtotalRaw);
  const taxTotal = roundCurrency(taxTotalRaw);
  // Compute total from the rounded components so the displayed parts always sum to the total.
  const total = roundCurrency(subtotal + taxTotal);
  return { subtotal, taxTotal, total };
};
