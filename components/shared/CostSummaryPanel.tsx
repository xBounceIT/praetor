import type React from 'react';
import type { DiscountType } from '../../types';
import CustomSelect from './CustomSelect';
import ValidatedNumberInput from './ValidatedNumberInput';

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
  amountPaid,
  balanceDue,
  margin,
}) => {
  return (
    <div className="bg-slate-50 rounded-xl p-4 space-y-2">
      {globalDiscount && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-500 shrink-0">{globalDiscount.label}</span>
          <div className="flex items-center gap-1">
            <ValidatedNumberInput
              step="0.01"
              min="0"
              max={globalDiscount.type === 'percentage' ? '100' : undefined}
              value={globalDiscount.value}
              onValueChange={globalDiscount.onChange}
              disabled={globalDiscount.disabled}
              className="w-20 text-sm px-2 py-1.5 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <CustomSelect
              options={[
                { id: 'percentage', name: '%' },
                { id: 'currency', name: currency },
              ]}
              value={globalDiscount.type}
              onChange={(v) => globalDiscount.onTypeChange(v as DiscountType)}
              disabled={globalDiscount.disabled}
              buttonClassName="h-[34px] min-w-[52px] text-sm px-2 py-1.5 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none font-semibold"
            />
          </div>
        </div>
      )}
      <div className={globalDiscount ? 'border-t border-slate-200 pt-2 space-y-2' : 'space-y-2'}>
        <div className="flex justify-between">
          <span className="text-sm font-bold text-slate-500">{subtotalLabel}</span>
          <span className="text-sm font-black text-slate-800">
            {subtotal.toFixed(2)} {currency}
          </span>
        </div>
        {discountRow && discountRow.amount > 0 && (
          <div className="flex justify-between">
            <span className="text-sm font-bold text-slate-500">{discountRow.label}</span>
            <span className="text-sm font-black text-amber-600">
              -{discountRow.amount.toFixed(2)} {currency}
            </span>
          </div>
        )}
        {margin && (
          <div className="flex justify-between">
            <span className="text-sm font-bold text-emerald-600">{margin.label}</span>
            <span className="text-sm font-black text-emerald-600">
              {margin.amount.toFixed(2)} {currency}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-2">
          <span className="text-sm font-black text-slate-700 uppercase tracking-widest">
            {totalLabel}
          </span>
          <span className="text-lg font-black text-praetor">
            {total.toFixed(2)} <span className="text-sm text-slate-400 font-bold">{currency}</span>
          </span>
        </div>
        {amountPaid && (
          <div className="flex justify-between items-center border-t border-slate-200 pt-2">
            <span className="text-sm font-bold text-slate-500">{amountPaid.label}</span>
            <div className="flex items-center gap-2">
              <ValidatedNumberInput
                value={amountPaid.value}
                onValueChange={amountPaid.onChange}
                className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-bold text-emerald-600 outline-none focus:ring-2 focus:ring-praetor"
              />
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
          </div>
        )}
        {balanceDue && (
          <div className="flex justify-between text-sm">
            <span className="font-bold text-slate-500">{balanceDue.label}</span>
            <span className={`font-black ${balanceDue.colorClass || 'text-red-500'}`}>
              {balanceDue.amount.toFixed(2)} {currency}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default CostSummaryPanel;
