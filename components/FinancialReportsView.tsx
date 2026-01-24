import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Invoice, Expense, Payment } from '../types';
import CustomSelect from './CustomSelect';
import Calendar from './Calendar';

interface FinancialReportsViewProps {
  invoices: Invoice[];
  expenses: Expense[];
  payments: Payment[];
  currency: string;
}

const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({
  invoices,
  expenses,
  payments,
  currency,
}) => {
  const { t } = useTranslation('finances');
  const [timePeriod, setTimePeriod] = useState<string>('6'); // Default to 6 months
  const [customRange, setCustomRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [isRangeModalOpen, setIsRangeModalOpen] = useState(false);

  const timeFrameOptions = useMemo(
    () => [
      { id: '3', name: t('reports.last3Months') },
      { id: '6', name: t('reports.last6Months') },
      { id: '12', name: t('reports.last12Months') },
      { id: 'custom', name: t('reports.customRange') },
    ],
    [t],
  );

  // Compute the display value for the selected time period
  const displayValue = useMemo(() => {
    if (timePeriod === 'custom' && customRange.start && customRange.end) {
      return `${customRange.start} - ${customRange.end}`;
    }
    return timeFrameOptions.find((opt) => opt.id === timePeriod)?.name || t('reports.last6Months');
  }, [timePeriod, customRange, timeFrameOptions, t]);

  const resolveDateRange = useMemo(() => {
    if (timePeriod === 'custom' && customRange.start && customRange.end) {
      return {
        start: new Date(customRange.start),
        end: new Date(customRange.end),
      };
    }

    const months = parseInt(timePeriod);
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    start.setDate(1); // Start from the 1st of that month

    return { start, end };
  }, [timePeriod, customRange]);

  const stats = useMemo(() => {
    const { start, end } = resolveDateRange;

    // Filter data based on date range
    const filteredPayments = payments.filter((p) => {
      const d = new Date(p.paymentDate);
      return d >= start && d <= end;
    });

    const filteredExpenses = expenses.filter((e) => {
      const d = new Date(e.expenseDate);
      return d >= start && d <= end;
    });

    // Income (from paid invoices and payments)
    const totalIncome = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

    // Expenses
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Net Profit
    const netProfit = totalIncome - totalExpenses;

    // Accounts Receivable (Unpaid Invoices) - This is point-in-time, generally all unpaid regardless of date, OR filter created date?
    // Usually AR is "what is owed now", so date filter might not strictly apply, but let's filter by issueDate for consistency if desired.
    // For standard AR, you usually want ALL outstanding money. Let's keep it global for now, or filter if requested.
    // Let's keep AR as "Global Current State" to be safe, or filter by 'issued within range'.
    // Given 'Financial Reports' usually implies 'Performance over period', AR is a balance sheet item.
    // Let's leave AR global for now as it represents current asset.
    const accountsReceivable = invoices
      .filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
      .reduce((sum, i) => sum + ((i.total ?? 0) - (i.amountPaid ?? 0)), 0);

    // Expense Categories
    const expenseCategories = filteredExpenses.reduce(
      (acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Monthly Data Calculation
    // Determine labels. If custom range is huge, we might need grouping.
    // For simplicity, let's stick to monthly grouping for now.

    const monthlyData: {
      month: string;
      year: number;
      income: number;
      expense: number;
      profit: number;
    }[] = [];

    const currentIter = new Date(start);
    currentIter.setDate(1); // Normalize to start of month

    while (currentIter <= end) {
      const monthKey = `${currentIter.getFullYear()}-${currentIter.getMonth()}`;
      const monthName = currentIter.toLocaleString('default', { month: 'short' });
      const year = currentIter.getFullYear();

      // Calculate for this month
      const income = filteredPayments
        .filter((p) => {
          const d = new Date(p.paymentDate);
          return `${d.getFullYear()}-${d.getMonth()}` === monthKey;
        })
        .reduce((sum, p) => sum + p.amount, 0);

      const expense = filteredExpenses
        .filter((e) => {
          const d = new Date(e.expenseDate);
          return `${d.getFullYear()}-${d.getMonth()}` === monthKey;
        })
        .reduce((sum, e) => sum + e.amount, 0);

      monthlyData.push({ month: monthName, year, income, expense, profit: income - expense });

      // Next month
      currentIter.setMonth(currentIter.getMonth() + 1);
    }

    return {
      totalIncome,
      totalExpenses,
      netProfit,
      accountsReceivable,
      expenseCategories,
      monthlyData,
    };
  }, [invoices, expenses, payments, resolveDateRange]);

  const handlePeriodChange = (val: string) => {
    if (val === 'custom') {
      setIsRangeModalOpen(true);
    } else {
      setTimePeriod(val);
    }
  };

  const handleRangeConfirm = () => {
    if (customRange.start && customRange.end) {
      setTimePeriod('custom');
      setIsRangeModalOpen(false);
    }
  };

  const hasActiveFilters = timePeriod !== '6' || !!customRange.start || !!customRange.end;

  const handleClearFilters = () => {
    setTimePeriod('6');
    setCustomRange({ start: null, end: null });
    setIsRangeModalOpen(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-black text-slate-800">{t('reports.title')}</h2>
          <p className="text-slate-500 text-sm">{t('reports.subtitle')}</p>
        </div>
        <div className="w-full md:w-fit flex-shrink-0 flex flex-col md:flex-row md:items-center gap-2">
          <CustomSelect
            options={timeFrameOptions}
            value={timePeriod}
            onChange={handlePeriodChange}
            dropdownPosition="bottom"
            displayValue={displayValue}
          />
          <button
            type="button"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-rotate-left"></i>
            {t('common.labels.clearFilters')}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
            {t('reports.income')}
          </div>
          <div
            className="text-3xl font-black text-emerald-600 truncate"
            title={`${stats.totalIncome.toFixed(2)} ${currency}`}
          >
            {stats.totalIncome.toLocaleString()}{' '}
            <span className="text-lg opacity-60 text-emerald-400">{currency}</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
            {t('reports.expenses')}
          </div>
          <div
            className="text-3xl font-black text-red-500 truncate"
            title={`${stats.totalExpenses.toFixed(2)} ${currency}`}
          >
            {stats.totalExpenses.toLocaleString()}{' '}
            <span className="text-lg opacity-60 text-red-300">{currency}</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
            {t('reports.netProfit')}
          </div>
          <div
            className={`text-3xl font-black truncate ${stats.netProfit >= 0 ? 'text-praetor' : 'text-red-600'}`}
            title={`${stats.netProfit.toFixed(2)} ${currency}`}
          >
            {stats.netProfit.toLocaleString()}{' '}
            <span className="text-lg opacity-60">{currency}</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
            {t('reports.accountsReceivable')}
          </div>
          <div
            className="text-3xl font-black text-amber-500 truncate"
            title={`${stats.accountsReceivable.toFixed(2)} ${currency}`}
          >
            {stats.accountsReceivable.toLocaleString()}{' '}
            <span className="text-lg opacity-60 text-amber-300">{currency}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Monthly Performance Chart (Visual Representation using CSS bars for simplicity) */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-black text-slate-800 mb-6">{t('reports.cashFlow')}</h3>
          <div
            className="flex items-end justify-between h-64 gap-4 custom-horizontal-scrollbar"
            style={{ paddingBottom: '8px' }}
          >
            {/* Added horizontal scroll for many months */}
            {stats.monthlyData.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm italic">
                {t('reports.noData')}
              </div>
            ) : (
              stats.monthlyData.map((data, index) => {
                const maxVal = Math.max(
                  ...stats.monthlyData.map((d) => Math.max(d.income, d.expense, 100)),
                ); // Avoid div by zero
                const incomeHeight = (data.income / maxVal) * 100;
                const expenseHeight = (data.expense / maxVal) * 100;

                return (
                  <div
                    key={`${data.month}-${data.year}-${index}`}
                    className="flex-1 min-w-[30px] flex flex-col items-center gap-2 group relative"
                  >
                    <div className="w-full flex justify-center gap-1 items-end h-full">
                      {/* Income Bar */}
                      <div
                        className="w-3 md:w-6 bg-emerald-400 rounded-t-lg transition-all hover:bg-emerald-500 relative"
                        style={{ height: `${Math.max(incomeHeight, 2)}%` }} // min height for visibility
                      >
                        <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] py-1 px-2 rounded font-bold whitespace-nowrap z-10 transition-opacity pointer-events-none">
                          +{data.income.toFixed(0)}
                        </div>
                      </div>
                      {/* Expense Bar */}
                      <div
                        className="w-3 md:w-6 bg-red-400 rounded-t-lg transition-all hover:bg-red-500 relative"
                        style={{ height: `${Math.max(expenseHeight, 2)}%` }}
                      >
                        <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] py-1 px-2 rounded font-bold whitespace-nowrap z-10 transition-opacity pointer-events-none">
                          -{data.expense.toFixed(0)}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs font-bold text-slate-400 whitespace-nowrap">
                      {data.month}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-center gap-6 mt-6">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <span className="w-3 h-3 rounded-full bg-emerald-400"></span> {t('reports.income')}
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <span className="w-3 h-3 rounded-full bg-red-400"></span> {t('reports.expenses')}
            </div>
          </div>
        </div>

        {/* Expenses Breakdown */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-black text-slate-800 mb-6">
            {t('reports.expenseBreakdown')}
          </h3>
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
            {Object.entries(stats.expenseCategories)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .map(([category, amount]) => {
                const numAmount = amount as number;
                const percentage =
                  stats.totalExpenses > 0 ? (numAmount / stats.totalExpenses) * 100 : 0;
                return (
                  <div key={category}>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="capitalize text-slate-600">
                        {category.replace('_', ' ')}
                      </span>
                      <span className="text-slate-800">
                        {numAmount.toFixed(0)} {currency} ({percentage.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-praetor rounded-full"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            {Object.keys(stats.expenseCategories).length === 0 && (
              <div className="text-slate-400 text-sm italic text-center py-8">
                {t('reports.noData')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Range Selection Modal */}
      {isRangeModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-calendar-range text-praetor"></i>
                {t('reports.selectRange')}
              </h3>
              <p className="text-xs text-slate-500 mt-1">{t('reports.pickRange')}</p>
            </div>
            <div className="p-6 flex flex-col items-center">
              <Calendar
                selectionMode="range"
                startDate={customRange.start || undefined}
                endDate={customRange.end || undefined}
                onRangeSelect={(s, e) => setCustomRange({ start: s, end: e })}
              />
              <div className="mt-4 flex gap-4 w-full text-center text-sm">
                <div className="flex-1 bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <div className="text-xs font-bold text-slate-400 uppercase">
                    {t('reports.start')}
                  </div>
                  <div className="font-bold text-slate-700">{customRange.start || '-'}</div>
                </div>
                <div className="flex-1 bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <div className="text-xs font-bold text-slate-400 uppercase">
                    {t('reports.end')}
                  </div>
                  <div className="font-bold text-slate-700">{customRange.end || '-'}</div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3 rounded-b-2xl">
              <button
                onClick={() => setIsRangeModalOpen(false)}
                className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 rounded-xl transition-colors"
              >
                {t('common.buttons.cancel')}
              </button>
              <button
                onClick={handleRangeConfirm}
                disabled={!customRange.start || !customRange.end}
                className="flex-1 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('reports.applyRange')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity Mini-Tables can go here if needed, but keeping it clean for now */}
    </div>
  );
};

export default FinancialReportsView;
