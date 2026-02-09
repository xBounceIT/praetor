import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import type { GeneralSettings as IGeneralSettings, TimeEntryLocation } from '../../types';
import CustomSelect, { type Option } from '../shared/CustomSelect';
import Toggle from '../shared/Toggle';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface GeneralSettingsProps {
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

type ModelCheckState = 'idle' | 'checking' | 'ok' | 'not_found' | 'error';

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdate }) => {
  const { t } = useTranslation('settings');
  const AI_PROVIDER_OPTIONS: Option[] = [
    { id: 'gemini', name: t('general.aiProviders.gemini') },
    { id: 'openrouter', name: t('general.aiProviders.openrouter') },
  ];
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
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openrouter'>(
    settings.aiProvider || 'gemini',
  );
  const [openrouterApiKey, setOpenrouterApiKey] = useState(settings.openrouterApiKey || '');
  const [geminiModelId, setGeminiModelId] = useState(settings.geminiModelId || '');
  const [openrouterModelId, setOpenrouterModelId] = useState(settings.openrouterModelId || '');
  const [modelCheck, setModelCheck] = useState<{ state: ModelCheckState; message?: string }>({
    state: 'idle',
  });
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
    setAiProvider(settings.aiProvider || 'gemini');
    setOpenrouterApiKey(settings.openrouterApiKey || '');
    setGeminiModelId(settings.geminiModelId || '');
    setOpenrouterModelId(settings.openrouterModelId || '');
    setModelCheck({ state: 'idle' });
  }, [settings]);

  const currentApiKey = aiProvider === 'gemini' ? geminiApiKey : openrouterApiKey;
  const currentModelId = aiProvider === 'gemini' ? geminiModelId : openrouterModelId;

  const isApiKeyMissing = () => enableAiInsights && !currentApiKey.trim();
  const isModelMissing = () => enableAiInsights && !currentModelId.trim();
  const isModelNotFound = enableAiInsights && modelCheck.state === 'not_found';

  const handleCheckModel = async () => {
    if (!currentApiKey.trim() || !currentModelId.trim()) return;
    setModelCheck({ state: 'checking' });
    try {
      const res = await api.ai.validateModel({
        provider: aiProvider,
        modelId: currentModelId,
        apiKey: currentApiKey,
      });
      if (res.ok) {
        setModelCheck({ state: 'ok' });
      } else if (res.code === 'NOT_FOUND') {
        setModelCheck({ state: 'not_found', message: res.message || '' });
      } else {
        setModelCheck({ state: 'error', message: res.message || '' });
      }
    } catch (err) {
      setModelCheck({ state: 'error', message: (err as Error).message });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isApiKeyMissing() || isModelMissing() || isModelNotFound) return;
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
        aiProvider,
        openrouterApiKey,
        geminiModelId,
        openrouterModelId,
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
    geminiApiKey !== (settings.geminiApiKey || '') ||
    aiProvider !== (settings.aiProvider || 'gemini') ||
    openrouterApiKey !== (settings.openrouterApiKey || '') ||
    geminiModelId !== (settings.geminiModelId || '') ||
    openrouterModelId !== (settings.openrouterModelId || '');

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
          <i className="fa-solid fa-globe mr-2"></i>
          {t('general.tabs.localization')}
          {activeTab === 'localization' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('tracking')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'tracking' ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fa-solid fa-clock mr-2"></i>
          {t('general.tabs.tracking')}
          {activeTab === 'tracking' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'ai' ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fa-solid fa-wand-magic-sparkles mr-2"></i>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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

                <div>
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

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {t('general.treatSaturdayAsHolidayLabel')}
                  </p>
                  <p className="text-xs text-slate-500 italic">
                    {t('general.treatSaturdayAsHolidayDescription')}
                  </p>
                </div>
                <Toggle checked={treatSaturdayAsHoliday} onChange={setTreatSaturdayAsHoliday} />
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
                <Toggle checked={allowWeekendSelection} onChange={setAllowWeekendSelection} />
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
                <Toggle checked={enableAiInsights} onChange={setEnableAiInsights} />
              </div>

              {enableAiInsights && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in slide-in-from-top-2">
                  {/* Provider */}
                  <div className="max-w-md">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      {t('general.aiProviderLabel')}
                    </label>
                    <CustomSelect
                      options={AI_PROVIDER_OPTIONS}
                      value={aiProvider}
                      onChange={(val) => {
                        setAiProvider(val as 'gemini' | 'openrouter');
                        setModelCheck({ state: 'idle' });
                      }}
                    />
                    <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">
                      {t('general.aiProviderDescription')}
                    </p>
                  </div>

                  {/* API Key */}
                  <div className="mt-6">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      {aiProvider === 'gemini'
                        ? t('general.geminiApiKey')
                        : t('general.openrouterApiKey')}
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        value={aiProvider === 'gemini' ? geminiApiKey : openrouterApiKey}
                        onChange={(e) => {
                          if (aiProvider === 'gemini') {
                            setGeminiApiKey(e.target.value);
                          } else {
                            setOpenrouterApiKey(e.target.value);
                          }
                          setModelCheck({ state: 'idle' });
                        }}
                        placeholder={
                          aiProvider === 'gemini'
                            ? t('general.apiKeyPlaceholder')
                            : t('general.openrouterApiKeyPlaceholder')
                        }
                        className={`w-full px-4 py-2 bg-white border rounded-lg focus:ring-2 outline-none transition-all text-sm font-semibold pr-10 ${
                          isApiKeyMissing()
                            ? 'border-red-500 bg-red-50 focus:ring-red-200'
                            : 'border-slate-200 focus:ring-praetor'
                        }`}
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                        {aiProvider === 'gemini' ? (
                          <i className="fa-brands fa-google"></i>
                        ) : (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 512 512"
                            fill="currentColor"
                            xmlns="http://www.w3.org/2000/svg"
                            role="img"
                            aria-label="OpenRouter"
                          >
                            <path
                              d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
                              stroke="currentColor"
                              strokeWidth="90"
                              fill="none"
                            />
                            <path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" />
                            <path
                              d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
                              stroke="currentColor"
                              strokeWidth="90"
                              fill="none"
                            />
                            <path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" />
                          </svg>
                        )}
                      </div>
                    </div>
                    {isApiKeyMissing() && (
                      <p className="text-red-500 text-[10px] font-bold mt-1">
                        {t('general.apiKeyRequired')}
                      </p>
                    )}
                    <p
                      className={`mt-2 text-[10px] italic leading-relaxed ${
                        isApiKeyMissing() ? 'text-red-400' : 'text-slate-500'
                      }`}
                    >
                      {aiProvider === 'gemini'
                        ? t('general.apiKeyDescription')
                        : t('general.openrouterApiKeyDescription')}{' '}
                      <a
                        href={
                          aiProvider === 'gemini'
                            ? 'https://makersuite.google.com/app/apikey'
                            : 'https://openrouter.ai/keys'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className={
                          isApiKeyMissing()
                            ? 'text-red-400 hover:underline'
                            : 'text-praetor hover:underline'
                        }
                      >
                        {aiProvider === 'gemini'
                          ? t('general.googleAiStudio')
                          : t('general.openrouterDashboard')}
                      </a>
                      .
                    </p>
                  </div>

                  {/* Model */}
                  <div className="mt-6">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      {t('general.modelIdLabel')}
                    </label>
                    <div className="flex items-stretch gap-2">
                      <input
                        type="text"
                        value={currentModelId}
                        onChange={(e) => {
                          if (aiProvider === 'gemini') {
                            setGeminiModelId(e.target.value);
                          } else {
                            setOpenrouterModelId(e.target.value);
                          }
                          setModelCheck({ state: 'idle' });
                        }}
                        placeholder={t('general.modelIdPlaceholder')}
                        className={`flex-1 px-4 py-2 bg-white border rounded-lg focus:ring-2 outline-none transition-all text-sm font-semibold ${
                          isModelMissing()
                            ? 'border-red-500 bg-red-50 focus:ring-red-200'
                            : modelCheck.state === 'ok'
                              ? 'border-emerald-400 bg-emerald-50 focus:ring-emerald-200'
                              : modelCheck.state === 'not_found'
                                ? 'border-red-500 bg-red-50 focus:ring-red-200'
                                : modelCheck.state === 'error'
                                  ? 'border-amber-500 bg-amber-50 focus:ring-amber-200'
                                  : 'border-slate-200 focus:ring-praetor'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleCheckModel}
                        disabled={
                          modelCheck.state === 'checking' ||
                          !currentApiKey.trim() ||
                          !currentModelId.trim()
                        }
                        className={`px-4 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                          modelCheck.state === 'checking' ||
                          !currentApiKey.trim() ||
                          !currentModelId.trim()
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            : 'bg-white text-praetor border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {modelCheck.state === 'checking'
                          ? t('general.checkingModel')
                          : t('general.checkModel')}
                      </button>
                    </div>
                    {isModelMissing() && (
                      <p className="text-red-500 text-[10px] font-bold mt-1">
                        {t('general.modelIdRequired')}
                      </p>
                    )}
                    {modelCheck.state === 'ok' && (
                      <p className="text-emerald-600 text-[10px] font-bold mt-1">
                        {t('general.modelVerified')}
                      </p>
                    )}
                    {modelCheck.state === 'not_found' && (
                      <p className="text-red-500 text-[10px] font-bold mt-1">
                        {t('general.modelNotFound')}
                      </p>
                    )}
                    {modelCheck.state === 'error' && (
                      <p className="text-amber-600 text-[10px] font-bold mt-1">
                        {t('general.modelCheckError')}
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">
                      {t('general.modelIdDescription')}{' '}
                      <a
                        href={
                          aiProvider === 'gemini'
                            ? 'https://ai.google.dev/gemini-api/docs/models/gemini'
                            : 'https://openrouter.ai/models'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-praetor hover:underline"
                      >
                        {t('general.modelIdHelpLink')}
                      </a>
                      .
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={
              isSaving ||
              isApiKeyMissing() ||
              isModelMissing() ||
              isModelNotFound ||
              (!hasChanges && !isSaved)
            }
            className={`px-8 py-3 rounded-xl font-bold text-sm transition-all duration-300 ease-in-out active:scale-95 flex items-center gap-2 ${
              isSaved
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                : isSaving ||
                    isApiKeyMissing() ||
                    isModelMissing() ||
                    isModelNotFound ||
                    !hasChanges
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
