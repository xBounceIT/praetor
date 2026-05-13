import type React from 'react';
import type { DiscountType } from '../../types';
import SelectControl from './SelectControl';
import ValidatedNumberInput from './ValidatedNumberInput';

// Guard against NaN / Infinity / undefined leaking from caller-supplied totals
// — `Number.prototype.toFixed` on a non-finite number returns "NaN" which then
// renders as literal "NaN" in the UI; explicit fallback keeps totals readable.
const formatAmount = (value: number | undefined | null): string =>
  Number.isFinite(value) ? (value as number).toFixed(2) : '0.00';

export interface CostSummaryPanelProps {
  currency: string;
  subtotal: number;
  total: number;
  subtotalLabel: string;
  totalLabel: string;
  globalDiscount?: {
    label: string;
    value: number;
    type: DiscountType;
    onChange: (value: string) => void;
    onTypeChange: (type: DiscountType) => void;
    disabled?: boolean;
  };
  discountRow?: {
    label: string;
    amount: number;
  };
  // Optional VAT/IVA row, rendered between subtotal and total. Only shown when amount > 0
  // so non-tax flows (e.g. quotes/offers reusing this panel) stay unchanged.
  taxRow?: {
    label: string;
    amount: number;
  };
  amountPaid?: {
    label: string;
    value: number;
    onChange: (value: string) => void;
  };
  balanceDue?: {
    label: string;
    amount: number;
    colorClass?: string;
  };
  margin?: {
    label: string;
    amount: number;
  };
}

const CostSummaryPanel: React.FC<CostSummaryPanelProps> = ({
  currency,
  subtotal,
  total,
  subtotalLabel,
  totalLabel,
  globalDiscount,
  discountRow,
  taxRow,
  amountPaid,
  balanceDue,
  margin,
}) => {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4">
      {globalDiscount && (
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {globalDiscount.label}
          </span>
          <div className="flex items-center gap-1">
            <ValidatedNumberInput
              step="0.01"
              min="0"
              max={globalDiscount.type === 'percentage' ? '100' : undefined}
              value={globalDiscount.value}
              formatDecimals={2}
              onValueChange={globalDiscount.onChange}
              disabled={globalDiscount.disabled}
              className="w-20 text-center font-medium"
            />
            <SelectControl
              options={[
                { id: 'percentage', name: '%' },
                { id: 'currency', name: currency },
              ]}
              value={globalDiscount.type}
              onChange={(v) => globalDiscount.onTypeChange(v as DiscountType)}
              disabled={globalDiscount.disabled}
              buttonClassName="h-9 min-w-[52px] px-2 text-sm font-medium"
            />
          </div>
        </div>
      )}
      <div className={globalDiscount ? 'space-y-2 border-t border-border pt-2' : 'space-y-2'}>
        <div className="flex justify-between">
          <span className="text-sm font-medium text-muted-foreground">{subtotalLabel}</span>
          <span className="text-sm font-semibold text-foreground">
            {formatAmount(subtotal)} {currency}
          </span>
        </div>
        {discountRow && discountRow.amount > 0 && (
          <div className="flex justify-between">
            <span className="text-sm font-medium text-muted-foreground">{discountRow.label}</span>
            <span className="text-sm font-semibold text-amber-600">
              -{formatAmount(discountRow.amount)} {currency}
            </span>
          </div>
        )}
        {taxRow && taxRow.amount > 0 && (
          <div className="flex justify-between">
            <span className="text-sm font-medium text-muted-foreground">{taxRow.label}</span>
            <span className="text-sm font-semibold text-foreground">
              {taxRow.amount.toFixed(2)} {currency}
            </span>
          </div>
        )}
        {margin && (
          <div className="flex justify-between">
            <span className="text-sm font-medium text-emerald-600">{margin.label}</span>
            <span className="text-sm font-semibold text-emerald-600">
              {formatAmount(margin.amount)} {currency}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-2">
          <span className="text-sm font-semibold uppercase tracking-widest text-foreground">
            {totalLabel}
          </span>
          <span className="text-lg font-semibold text-primary">
            {formatAmount(total)}{' '}
            <span className="text-sm font-medium text-muted-foreground">{currency}</span>
          </span>
        </div>
        {amountPaid && (
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="text-sm font-medium text-muted-foreground">{amountPaid.label}</span>
            <div className="flex items-center gap-2">
              <ValidatedNumberInput
                value={amountPaid.value}
                formatDecimals={2}
                onValueChange={amountPaid.onChange}
                className="w-24 text-right font-medium text-emerald-600"
              />
              <span className="text-xs font-medium text-muted-foreground">{currency}</span>
            </div>
          </div>
        )}
        {balanceDue && (
          <div className="flex justify-between text-sm">
            <span className="font-medium text-muted-foreground">{balanceDue.label}</span>
            <span className={`font-semibold ${balanceDue.colorClass || 'text-destructive'}`}>
              {formatAmount(balanceDue.amount)} {currency}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default CostSummaryPanel;
