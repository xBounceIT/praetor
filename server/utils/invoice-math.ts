type ItemMath = { quantity: number; unitPrice: number; discount: number };

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

export const computeInvoiceTotals = (items: ItemMath[]): { subtotal: number; total: number } => {
  const subtotal = items.reduce((acc, item) => {
    const discountFactor = 1 - item.discount / 100;
    return acc + item.quantity * item.unitPrice * discountFactor;
  }, 0);
  const rounded = roundCurrency(subtotal);
  return { subtotal: rounded, total: rounded };
};
