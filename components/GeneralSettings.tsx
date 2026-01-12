import React, { useState, useEffect } from 'react';
import { GeneralSettings as IGeneralSettings } from '../types';
import CustomSelect, { Option } from './CustomSelect';

interface GeneralSettingsProps {
    settings: IGeneralSettings;
    onUpdate: (updates: Partial<IGeneralSettings>) => void;
}

const CURRENCY_OPTIONS: Option[] = [
    { id: '$', name: 'US Dollar ($)' },
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
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        setCurrency(settings.currency);
    }, [settings]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onUpdate({ currency });
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 3000);
        } catch (err) {
            console.error('Failed to save general settings:', err);
        } finally {
            setIsSaving(false);
        }
    };

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

            <form onSubmit={handleSave} className="space-y-8">
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
                        <i className="fa-solid fa-globe text-indigo-500"></i>
                        <h3 className="font-bold text-slate-800">Localization & Display</h3>
                    </div>

                    <div className="p-6 space-y-6">
                        <div className="max-w-md">
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

                <div className="flex justify-end pt-4">
                    <button
                        type="submit"
                        disabled={isSaving || currency === settings.currency}
                        className={`px-8 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center gap-2 ${isSaving || currency === settings.currency
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                                : 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700'
                            }`}
                    >
                        {isSaving ? (
                            <i className="fa-solid fa-circle-notch fa-spin"></i>
                        ) : (
                            <i className="fa-solid fa-check"></i>
                        )}
                        Save Configuration
                    </button>
                </div>
            </form>
        </div>
    );
};

export default GeneralSettings;
