import React, { useState, useEffect } from 'react';
import { GeneralSettings as IGeneralSettings } from '../types';
import CustomSelect, { Option } from './CustomSelect';

interface GeneralSettingsProps {
    settings: IGeneralSettings;
    onUpdate: (updates: Partial<IGeneralSettings>) => void;
}

const CURRENCY_OPTIONS: Option[] = [
    { id: 'USD', name: 'US Dollar ($)' },
    { id: '€', name: 'Euro (€)' },
    { id: '£', name: 'British Pound (£)' },
    { id: '¥', name: 'Japanese Yen (¥)' },
    { id: 'CHF', name: 'Swiss Franc (CHF)' },
    { id: 'A$', name: 'Australian Dollar (A$)' },
    { id: 'C$', name: 'Canadian Dollar (C$)' },
    { id: 'kr', name: 'Swedish Krona (kr)' },
    { id: 'NZ$', name: 'New Zealand Dollar (NZ$)' },
    { id: 'R$', name: 'Brazilian Real (R$)' },
    { id: '₹', name: 'Indian Rupee (₹)' },
    { id: '₽', name: 'Russian Ruble (₽)' },
    { id: 'R', name: 'South African Rand (R)' },
    { id: '₩', name: 'South Korean Won (₩)' },
    { id: '₺', name: 'Turkish Lira (₺)' },
    { id: '₫', name: 'Vietnamese Dong (₫)' },
    { id: '฿', name: 'Thai Baht (฿)' },
    { id: '₪', name: 'Israeli New Shekel (₪)' },
    { id: '₱', name: 'Philippine Peso (₱)' },
    { id: 'zł', name: 'Polish Zloty (zł)' },
];

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdate }) => {
    const [currency, setCurrency] = useState(settings.currency);
    const [dailyLimit, setDailyLimit] = useState(settings.dailyLimit);
    const [activeTab, setActiveTab] = useState<'localization' | 'limits'>('localization');
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        setCurrency(settings.currency);
        setDailyLimit(settings.dailyLimit);
    }, [settings]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onUpdate({ currency, dailyLimit });
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 3000);
        } catch (err) {
            console.error('Failed to save general settings:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const hasChanges = currency !== settings.currency || dailyLimit !== settings.dailyLimit;

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">General Administration</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure global application settings</p>
                </div>
                {isSaved && (
                    <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
                        <i className="fa-solid fa-check"></i> Changes Saved
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 gap-8">
                <button
                    onClick={() => setActiveTab('localization')}
                    className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'localization' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Localization
                    {activeTab === 'localization' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"></div>}
                </button>
                <button
                    onClick={() => setActiveTab('limits')}
                    className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'limits' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Work Limits
                    {activeTab === 'limits' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"></div>}
                </button>
            </div>

            <form onSubmit={handleSave} className="space-y-8">
                {activeTab === 'localization' && (
                    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-left-4 duration-300">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
                            <i className="fa-solid fa-globe text-indigo-500"></i>
                            <h3 className="font-bold text-slate-800">Localization & Display</h3>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="max-w-xs">
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Application Currency</label>
                                <CustomSelect
                                    options={CURRENCY_OPTIONS}
                                    value={currency}
                                    onChange={setCurrency}
                                    searchable={true}
                                    placeholder="Select currency..."
                                />
                                <p className="mt-2 text-xs text-slate-500 italic">This currency symbol will be used globally in reports and user management.</p>
                            </div>
                        </div>
                    </section>
                )}

                {activeTab === 'limits' && (
                    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
                            <i className="fa-solid fa-clock text-indigo-500"></i>
                            <h3 className="font-bold text-slate-800">Global Work Limits</h3>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="max-w-xs">
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Daily Hour Limit</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={dailyLimit}
                                        onChange={e => setDailyLimit(parseFloat(e.target.value))}
                                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-bold"
                                    />
                                    <span className="text-xs font-bold text-slate-400 uppercase whitespace-nowrap">hrs / day</span>
                                </div>
                                <p className="mt-2 text-xs text-slate-500 italic">This limit applies to all users. It defines the target hours to track and the threshold for visual highlights in the calendar.</p>
                            </div>
                        </div>
                    </section>
                )}

                <div className="flex justify-end pt-4">
                    <button
                        type="submit"
                        disabled={isSaving || !hasChanges}
                        className={`px-8 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center gap-2 ${isSaving || !hasChanges
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            : 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700'
                            }`}
                    >
                        {isSaving ? (
                            <i className="fa-solid fa-circle-notch fa-spin"></i>
                        ) : (
                            <i className="fa-solid fa-check"></i>
                        )}
                        {isSaving ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default GeneralSettings;
