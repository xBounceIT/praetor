import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GeneralSettings as IGeneralSettings, TimeEntryLocation } from '../../types';
import CustomSelect, { Option } from '../shared/CustomSelect';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

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
  const { t } = useTranslation('settings');
  const [currency, setCurrency] = useState(settings.currency);
  const [dailyLimit, setDailyLimit] = useState(settings.dailyLimit);
  const [startOfWeek, setStartOfWeek] = useState(settings.startOfWeek);
  const [treatSaturdayAsHoliday, setTreatSaturdayAsHoliday] = useState(
    settings.treatSaturdayAsHoliday,
  );
  const [allowWeekendSelection, setAllowWeekendSelection] = useState(
    settings.allowWeekendSelection ?? true,
  );
  const [defaultLocation, setDefaultLocation] = useState<TimeEntryLocation>(
    settings.defaultLocation || 'remote',
  );
  const [enableAiInsights, setEnableAiInsights] = useState(settings.enableAiInsights);
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey || '');
  const [activeTab, setActiveTab] = useState<'localization' | 'tracking' | 'ai'>('localization');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setCurrency(settings.currency);
    setDailyLimit(settings.dailyLimit);
    setStartOfWeek(settings.startOfWeek);
    setTreatSaturdayAsHoliday(settings.treatSaturdayAsHoliday);
    setAllowWeekendSelection(settings.allowWeekendSelection ?? true);
    setDefaultLocation(settings.defaultLocation || 'remote');
    setEnableAiInsights(settings.enableAiInsights);
    setGeminiApiKey(settings.geminiApiKey || '');
  }, [settings]);

  const isApiKeyMissing = () => enableAiInsights && !geminiApiKey.trim();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isApiKeyMissing()) return;
    setIsSaving(true);
    try {
      await onUpdate({
        currency,
        dailyLimit,
        startOfWeek,
        treatSaturdayAsHoliday,
        allowWeekendSelection,
        defaultLocation,
        enableAiInsights,
        geminiApiKey,
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save general settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    currency !== settings.currency ||
    dailyLimit !== settings.dailyLimit ||
    startOfWeek !== settings.startOfWeek ||
    treatSaturdayAsHoliday !== settings.treatSaturdayAsHoliday ||
    allowWeekendSelection !== (settings.allowWeekendSelection ?? true) ||
    defaultLocation !== (settings.defaultLocation || 'remote') ||
    enableAiInsights !== settings.enableAiInsights ||
    geminiApiKey !== (settings.geminiApiKey || '');

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{t('general.pageTitle')}</h2>
          <p className="text-sm text-slate-500 mt-1">{t('general.pageSubtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-8">
        <button
          onClick={() => setActiveTab('localization')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'localization' ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
        >
          {t('general.tabs.localization')}
          {activeTab === 'localization' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('tracking')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'tracking' ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
        >
          {t('general.tabs.tracking')}
          {activeTab === 'tracking' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'ai' ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
        >
          {t('general.tabs.ai')}
          {activeTab === 'ai' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {activeTab === 'localization' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-left-4 duration-300">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
              <i className="fa-solid fa-globe text-praetor"></i>
              <h3 className="font-bold text-slate-800">{t('general.localizationDisplay')}</h3>
            </div>

            <div className="p-6 space-y-6">
              <div className="max-w-xs">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {t('general.currencyLabel')}
                </label>
                <CustomSelect
                  options={CURRENCY_OPTIONS}
                  value={currency}
                  onChange={(val) => setCurrency(val as string)}
                  searchable={true}
                  placeholder={t('general.currencyLabel')}
                />
                <p className="mt-2 text-xs text-slate-500 italic">
                  {t('general.currencyDescription')}
                </p>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'tracking' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
              <i className="fa-solid fa-clock text-praetor"></i>
              <h3 className="font-bold text-slate-800">{t('general.globalTrackingPreferences')}</h3>
            </div>

            <div className="p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {t('general.dailyHourLimit')}
                  </label>
                  <div className="flex items-center gap-3">
                    <ValidatedNumberInput
                      step="0.5"
                      value={dailyLimit}
                      onValueChange={(value) => {
                        const parsed = parseFloat(value);
                        setDailyLimit(value === '' || Number.isNaN(parsed) ? 0 : parsed);
                      }}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-bold"
                    />
                    <span className="text-xs font-bold text-slate-400 uppercase whitespace-nowrap">
                      {t('general.hoursPerDay')}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">
                    {t('general.dailyLimitDescription')}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {t('general.startOfWeek')}
                  </label>
                  <CustomSelect
                    options={[
                      { id: 'Monday', name: t('general.monday') },
                      { id: 'Sunday', name: t('general.sunday') },
                    ]}
                    value={startOfWeek}
                    onChange={(val) => setStartOfWeek(val as 'Monday' | 'Sunday')}
                  />
                  <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">
                    {t('general.startOfWeekDescription')}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {t('general.treatSaturdayAsHolidayLabel')}
                  </p>
                  <p className="text-xs text-slate-500 italic">
                    {t('general.treatSaturdayAsHolidayDescription')}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={treatSaturdayAsHoliday}
                    onChange={(e) => setTreatSaturdayAsHoliday(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-praetor"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {t('general.allowWeekendSelectionLabel')}
                  </p>
                  <p className="text-xs text-slate-500 italic">
                    {t('general.allowWeekendSelectionDescription')}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowWeekendSelection}
                    onChange={(e) => setAllowWeekendSelection(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-praetor"></div>
                </label>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {t('general.defaultLocationLabel')}
                </label>
                <CustomSelect
                  options={[
                    { id: 'office', name: t('general.locationTypes.office') },
                    { id: 'customer_premise', name: t('general.locationTypes.customerPremise') },
                    { id: 'remote', name: t('general.locationTypes.remote') },
                    { id: 'transfer', name: t('general.locationTypes.transfer') },
                  ]}
                  value={defaultLocation}
                  onChange={(val) => setDefaultLocation(val as TimeEntryLocation)}
                />
                <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">
                  {t('general.defaultLocationDescription')}
                </p>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'ai' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
              <i className="fa-solid fa-wand-magic-sparkles text-praetor"></i>
              <h3 className="font-bold text-slate-800">{t('general.aiCapabilities')}</h3>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="max-w-md">
                  <p className="text-sm font-bold text-slate-800">
                    {t('general.enableAiCoachLabel')}
                  </p>
                  <p className="text-xs text-slate-500 italic leading-relaxed">
                    {t('general.enableAiCoachDescription')}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableAiInsights}
                    onChange={(e) => setEnableAiInsights(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-praetor"></div>
                </label>
              </div>

              {enableAiInsights && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in slide-in-from-top-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {t('general.geminiApiKey')}
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder={t('general.apiKeyPlaceholder')}
                      className={`w-full px-4 py-2 bg-white border rounded-lg focus:ring-2 outline-none transition-all text-sm font-semibold pr-10 ${isApiKeyMissing() ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                      <i className="fa-brands fa-google"></i>
                    </div>
                  </div>
                  {isApiKeyMissing() && (
                    <p className="text-red-500 text-[10px] font-bold mt-1">
                      {t('general.apiKeyRequired')}
                    </p>
                  )}
                  <p
                    className={`mt-2 text-[10px] italic leading-relaxed ${isApiKeyMissing() ? 'text-red-400' : 'text-slate-500'}`}
                  >
                    {t('general.apiKeyDescription')}{' '}
                    <a
                      href="https://makersuite.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        isApiKeyMissing()
                          ? 'text-red-400 hover:underline'
                          : 'text-praetor hover:underline'
                      }
                    >
                      {t('general.googleAiStudio')}
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={isSaving || isApiKeyMissing() || (!hasChanges && !isSaved)}
            className={`px-8 py-3 rounded-xl font-bold text-sm transition-all duration-300 ease-in-out active:scale-95 flex items-center gap-2 ${
              isSaved
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                : isSaving || isApiKeyMissing() || !hasChanges
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                  : 'bg-praetor text-white shadow-lg shadow-slate-200 hover:bg-slate-700'
            }`}
          >
            {isSaving ? (
              <i className="fa-solid fa-circle-notch fa-spin"></i>
            ) : isSaved ? (
              <i className="fa-solid fa-check"></i>
            ) : (
              <i className="fa-solid fa-save"></i>
            )}
            {isSaving
              ? t('general.saving')
              : isSaved
                ? t('general.changesSaved')
                : t('general.saveConfiguration')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GeneralSettings;
