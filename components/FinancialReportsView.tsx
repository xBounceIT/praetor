import React, { useMemo } from 'react';
import { Invoice, Expense, Payment } from '../types';

interface FinancialReportsViewProps {
    invoices: Invoice[];
    expenses: Expense[];
    payments: Payment[];
    currency: string;
}

const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({ invoices, expenses, payments, currency }) => {

    const stats = useMemo(() => {
        // Income (from paid invoices and payments)
        // We can use payment records for actual cash flow
        const totalIncome = payments.reduce((sum, p) => sum + p.amount, 0);

        // Expenses
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

        // Net Profit
        const netProfit = totalIncome - totalExpenses;

        // Accounts Receivable (Unpaid Invoices)
        const accountsReceivable = invoices
            .filter(i => i.status !== 'cancelled' && i.status !== 'draft')
            .reduce((sum, i) => sum + ((i.total ?? 0) - (i.amountPaid ?? 0)), 0);

        // Expense Categories
        const expenseCategories = expenses.reduce((acc, e) => {
            acc[e.category] = (acc[e.category] || 0) + e.amount;
            return acc;
        }, {} as Record<string, number>);

        // Monthly Data (Last 6 months)
        const last6Months = Array.from({ length: 6 }, (_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            return {
                month: d.toLocaleString('default', { month: 'short' }),
                year: d.getFullYear(),
                key: `${d.getFullYear()}-${d.getMonth()}`
            };
        }).reverse();

        const monthlyData = last6Months.map(({ month, year, key }) => {
            const income = payments.filter(p => {
                const d = new Date(p.paymentDate);
                return `${d.getFullYear()}-${d.getMonth()}` === key;
            }).reduce((sum, p) => sum + p.amount, 0);

            const expense = expenses.filter(e => {
                const d = new Date(e.expenseDate);
                return `${d.getFullYear()}-${d.getMonth()}` === key;
            }).reduce((sum, e) => sum + e.amount, 0);

            return { month, year, income, expense, profit: income - expense };
        });

        return {
            totalIncome,
            totalExpenses,
            netProfit,
            accountsReceivable,
            expenseCategories,
            monthlyData
        };
    }, [invoices, expenses, payments]);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <h2 className="text-2xl font-black text-slate-800">Financial Reports</h2>
                <p className="text-slate-500 text-sm">Overview of your business performance</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Total Income</div>
                    <div className="text-3xl font-black text-emerald-600 truncate" title={`${stats.totalIncome.toFixed(2)} ${currency}`}>
                        {stats.totalIncome.toLocaleString()} <span className="text-lg opacity-60 text-emerald-400">{currency}</span>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Total Expenses</div>
                    <div className="text-3xl font-black text-red-500 truncate" title={`${stats.totalExpenses.toFixed(2)} ${currency}`}>
                        {stats.totalExpenses.toLocaleString()} <span className="text-lg opacity-60 text-red-300">{currency}</span>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Net Profit</div>
                    <div className={`text-3xl font-black truncate ${stats.netProfit >= 0 ? 'text-praetor' : 'text-red-600'}`} title={`${stats.netProfit.toFixed(2)} ${currency}`}>
                        {stats.netProfit.toLocaleString()} <span className="text-lg opacity-60">{currency}</span>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Accounts Receivable</div>
                    <div className="text-3xl font-black text-amber-500 truncate" title={`${stats.accountsReceivable.toFixed(2)} ${currency}`}>
                        {stats.accountsReceivable.toLocaleString()} <span className="text-lg opacity-60 text-amber-300">{currency}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Monthly Performance Chart (Visual Representation using CSS bars for simplicity) */}
                <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
                    <h3 className="text-lg font-black text-slate-800 mb-6">Cash Flow (Last 6 Months)</h3>
                    <div className="flex items-end justify-between h-64 gap-4">
                        {stats.monthlyData.map((data, index) => {
                            const maxVal = Math.max(...stats.monthlyData.map(d => Math.max(d.income, d.expense, 100))); // Avoid div by zero
                            const incomeHeight = (data.income / maxVal) * 100;
                            const expenseHeight = (data.expense / maxVal) * 100;

                            return (
                                <div key={index} className="flex-1 flex flex-col items-center gap-2 group relative">
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
                                    <div className="text-xs font-bold text-slate-400">{data.month}</div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex justify-center gap-6 mt-6">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                            <span className="w-3 h-3 rounded-full bg-emerald-400"></span> Income
                        </div>
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                            <span className="w-3 h-3 rounded-full bg-red-400"></span> Expenses
                        </div>
                    </div>
                </div>

                {/* Expenses Breakdown */}
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
                    <h3 className="text-lg font-black text-slate-800 mb-6">Expenses Breakdown</h3>
                    <div className="space-y-4">
                        {Object.entries(stats.expenseCategories).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([category, amount]) => {
                            const numAmount = amount as number;
                            const percentage = stats.totalExpenses > 0 ? (numAmount / stats.totalExpenses) * 100 : 0;
                            return (
                                <div key={category}>
                                    <div className="flex justify-between text-xs font-bold mb-1">
                                        <span className="capitalize text-slate-600">{category.replace('_', ' ')}</span>
                                        <span className="text-slate-800">{numAmount.toFixed(0)} {currency} ({percentage.toFixed(0)}%)</span>
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
                            <div className="text-slate-400 text-sm italic text-center py-8">No expenses recorded</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Recent Activity Mini-Tables can go here if needed, but keeping it clean for now */}
        </div>
    );
};

export default FinancialReportsView;
