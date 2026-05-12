type ItemMath = { quantity: number; unitPrice: number; discount: number };

// Match the NUMERIC(_, 2) precision used for invoice columns so totals computed here
// align with what would be re-derived from the persisted rows. The frontend mirrors this
// helper in `utils/numbers.ts` so both layers agree on rendered values.
export const roundCurrency = (value: number) => Math.round(value * 100) / 100;

export const computeInvoiceTotals = (items: ItemMath[]): { subtotal: number; total: number } => {
  const subtotal = items.reduce((acc, item) => {
    const discountFactor = 1 - item.discount / 100;
    return acc + item.quantity * item.unitPrice * discountFactor;
  }, 0);
  const rounded = roundCurrency(subtotal);
  return { subtotal: rounded, total: rounded };
};
