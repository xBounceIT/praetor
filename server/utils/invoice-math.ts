type ItemMath = { quantity: number; unitPrice: number; discount: number; taxRate?: number };

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

// Items without `taxRate` default to 0, keeping `total === subtotal` for callers
// that haven't started passing VAT through.
export const computeInvoiceTotals = (
  items: ItemMath[],
): { subtotal: number; tax: number; total: number } => {
  let subtotal = 0;
  let tax = 0;
  for (const item of items) {
    const discountFactor = 1 - item.discount / 100;
    const lineSubtotal = item.quantity * item.unitPrice * discountFactor;
    subtotal += lineSubtotal;
    tax += lineSubtotal * ((item.taxRate ?? 0) / 100);
  }
  const roundedSubtotal = roundCurrency(subtotal);
  const roundedTax = roundCurrency(tax);
  return {
    subtotal: roundedSubtotal,
    tax: roundedTax,
    total: roundCurrency(roundedSubtotal + roundedTax),
  };
};
