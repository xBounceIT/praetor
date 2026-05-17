import {
  Check,
  Clock,
  Globe,
  Loader2,
  Save,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import type { GeneralSettings as IGeneralSettings, TimeEntryLocation } from '../../types';
import SelectControl, { type Option } from '../shared/SelectControl';
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

type AiProvider = 'gemini' | 'openrouter';

const TABS = [
  { id: 'localization', Icon: Globe, labelKey: 'general.tabs.localization' },
  { id: 'tracking', Icon: Clock, labelKey: 'general.tabs.tracking' },
  { id: 'ai', Icon: WandSparkles, labelKey: 'general.tabs.ai' },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface ToggleSettingRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const ToggleSettingRow: React.FC<ToggleSettingRowProps> = ({
  label,
  description,
  checked,
  onChange,
}) => (
  <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 p-4">
    <div>
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} />
  </div>
);

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
  const [enableAiReporting, setEnableAiReporting] = useState(settings.enableAiReporting);
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey || '');
  const [aiProvider, setAiProvider] = useState<AiProvider>(settings.aiProvider || 'gemini');
  const [openrouterApiKey, setOpenrouterApiKey] = useState(settings.openrouterApiKey || '');
  const [geminiModelId, setGeminiModelId] = useState(settings.geminiModelId || '');
  const [openrouterModelId, setOpenrouterModelId] = useState(settings.openrouterModelId || '');
  const [modelCheck, setModelCheck] = useState<{ state: ModelCheckState; message?: string }>({
    state: 'idle',
  });
  const [activeTab, setActiveTab] = useState<TabId>('localization');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setCurrency(settings.currency);
    setDailyLimit(settings.dailyLimit);
    setStartOfWeek(settings.startOfWeek);
    setTreatSaturdayAsHoliday(settings.treatSaturdayAsHoliday);
    setAllowWeekendSelection(settings.allowWeekendSelection ?? true);
    setDefaultLocation(settings.defaultLocation || 'remote');
    setEnableAiReporting(settings.enableAiReporting);
    setGeminiApiKey(settings.geminiApiKey || '');
    setAiProvider(settings.aiProvider || 'gemini');
    setOpenrouterApiKey(settings.openrouterApiKey || '');
    setGeminiModelId(settings.geminiModelId || '');
    setOpenrouterModelId(settings.openrouterModelId || '');
    setModelCheck({ state: 'idle' });
  }, [settings]);

  const currentApiKey = aiProvider === 'gemini' ? geminiApiKey : openrouterApiKey;
  const currentModelId = aiProvider === 'gemini' ? geminiModelId : openrouterModelId;

  const handleApiKeyChange = (value: string) => {
    (aiProvider === 'gemini' ? setGeminiApiKey : setOpenrouterApiKey)(value);
    setModelCheck({ state: 'idle' });
  };

  const handleModelIdChange = (value: string) => {
    (aiProvider === 'gemini' ? setGeminiModelId : setOpenrouterModelId)(value);
    setModelCheck({ state: 'idle' });
  };

  const isAnyAiEnabled = enableAiReporting;
  const isApiKeyMissing = () => isAnyAiEnabled && !currentApiKey.trim();
  const isModelMissing = () => isAnyAiEnabled && !currentModelId.trim();
  const isModelNotFound = isAnyAiEnabled && modelCheck.state === 'not_found';

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
        enableAiReporting,
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
    enableAiReporting !== settings.enableAiReporting ||
    geminiApiKey !== (settings.geminiApiKey || '') ||
    aiProvider !== (settings.aiProvider || 'gemini') ||
    openrouterApiKey !== (settings.openrouterApiKey || '') ||
    geminiModelId !== (settings.geminiModelId || '') ||
    openrouterModelId !== (settings.openrouterModelId || '');

  const submitDisabled =
    isSaving ||
    isApiKeyMissing() ||
    isModelMissing() ||
    isModelNotFound ||
    (!hasChanges && !isSaved);

  const {
    Icon: SubmitIcon,
    iconClass: submitIconClass,
    label: submitLabel,
  } = isSaving
    ? { Icon: Loader2, iconClass: 'animate-spin', label: t('general.saving') }
    : isSaved
      ? { Icon: Check, iconClass: undefined, label: t('general.changesSaved') }
      : { Icon: Save, iconClass: undefined, label: t('general.saveConfiguration') };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{t('general.pageTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('general.pageSubtitle')}</p>
        </div>
      </div>

      <div className="flex border-b border-border gap-8">
        {TABS.map(({ id, Icon, labelKey }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'pb-4 text-sm font-bold transition-all relative inline-flex items-center gap-2',
                isActive ? 'text-praetor' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {t(labelKey)}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {activeTab === 'localization' && (
          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0 animate-in fade-in slide-in-from-left-4 duration-300">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Globe aria-hidden="true" className="size-4 text-praetor" />
                {t('general.localizationDisplay')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <Field className="max-w-xs">
                <FieldLabel htmlFor="general-currency">{t('general.currencyLabel')}</FieldLabel>
                <SelectControl
                  id="general-currency"
                  options={CURRENCY_OPTIONS}
                  value={currency}
                  onChange={(val) => setCurrency(val as string)}
                  searchable={true}
                  placeholder={t('general.currencyLabel')}
                />
                <FieldDescription>{t('general.currencyDescription')}</FieldDescription>
              </Field>
            </CardContent>
          </Card>
        )}

        {activeTab === 'tracking' && (
          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Clock aria-hidden="true" className="size-4 text-praetor" />
                {t('general.globalTrackingPreferences')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-8 p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Field>
                  <FieldLabel htmlFor="general-daily-limit">
                    {t('general.dailyHourLimit')}
                  </FieldLabel>
                  <ValidatedNumberInput
                    id="general-daily-limit"
                    step="0.5"
                    value={dailyLimit}
                    onValueChange={(value) => {
                      const parsed = parseFloat(value);
                      setDailyLimit(value === '' || Number.isNaN(parsed) ? 0 : parsed);
                    }}
                  />
                  <FieldDescription>{t('general.dailyLimitDescription')}</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="general-start-of-week">
                    {t('general.startOfWeek')}
                  </FieldLabel>
                  <SelectControl
                    id="general-start-of-week"
                    options={[
                      { id: 'Monday', name: t('general.monday') },
                      { id: 'Sunday', name: t('general.sunday') },
                    ]}
                    value={startOfWeek}
                    onChange={(val) => setStartOfWeek(val as 'Monday' | 'Sunday')}
                  />
                  <FieldDescription>{t('general.startOfWeekDescription')}</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="general-default-location">
                    {t('general.defaultLocationLabel')}
                  </FieldLabel>
                  <SelectControl
                    id="general-default-location"
                    options={[
                      { id: 'office', name: t('general.locationTypes.office') },
                      { id: 'customer_premise', name: t('general.locationTypes.customerPremise') },
                      { id: 'remote', name: t('general.locationTypes.remote') },
                      { id: 'transfer', name: t('general.locationTypes.transfer') },
                    ]}
                    value={defaultLocation}
                    onChange={(val) => setDefaultLocation(val as TimeEntryLocation)}
                  />
                  <FieldDescription>{t('general.defaultLocationDescription')}</FieldDescription>
                </Field>
              </div>

              <ToggleSettingRow
                label={t('general.treatSaturdayAsHolidayLabel')}
                description={t('general.treatSaturdayAsHolidayDescription')}
                checked={treatSaturdayAsHoliday}
                onChange={setTreatSaturdayAsHoliday}
              />

              <ToggleSettingRow
                label={t('general.allowWeekendSelectionLabel')}
                description={t('general.allowWeekendSelectionDescription')}
                checked={allowWeekendSelection}
                onChange={setAllowWeekendSelection}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'ai' && (
          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0 animate-in fade-in slide-in-from-right-4 duration-300">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <WandSparkles aria-hidden="true" className="size-4 text-praetor" />
                {t('general.aiCapabilities')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 p-6">
              <ToggleSettingRow
                label={t('general.enableAiReportingLabel')}
                description={t('general.enableAiReportingDescription')}
                checked={enableAiReporting}
                onChange={setEnableAiReporting}
              />

              {isAnyAiEnabled && (
                <div className="space-y-6 rounded-md border border-border bg-muted/40 p-4 animate-in fade-in slide-in-from-top-2">
                  <Field className="max-w-md">
                    <FieldLabel htmlFor="general-ai-provider">
                      {t('general.aiProviderLabel')}
                    </FieldLabel>
                    <SelectControl
                      id="general-ai-provider"
                      options={AI_PROVIDER_OPTIONS}
                      value={aiProvider}
                      onChange={(val) => {
                        setAiProvider(val as AiProvider);
                        setModelCheck({ state: 'idle' });
                      }}
                    />
                    <FieldDescription>{t('general.aiProviderDescription')}</FieldDescription>
                  </Field>

                  <Field data-invalid={isApiKeyMissing() ? 'true' : undefined}>
                    <FieldLabel htmlFor="general-ai-api-key">
                      {aiProvider === 'gemini'
                        ? t('general.geminiApiKey')
                        : t('general.openrouterApiKey')}
                    </FieldLabel>
                    <Input
                      id="general-ai-api-key"
                      type="password"
                      value={currentApiKey}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      placeholder={
                        aiProvider === 'gemini'
                          ? t('general.apiKeyPlaceholder')
                          : t('general.openrouterApiKeyPlaceholder')
                      }
                      aria-invalid={isApiKeyMissing() || undefined}
                      className={
                        isApiKeyMissing()
                          ? 'border-destructive focus-visible:ring-destructive/30'
                          : undefined
                      }
                    />
                    {isApiKeyMissing() && (
                      <p className="text-xs font-medium text-destructive">
                        {t('general.apiKeyRequired')}
                      </p>
                    )}
                    <FieldDescription>
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
                        className="text-praetor hover:underline"
                      >
                        {aiProvider === 'gemini'
                          ? t('general.googleAiStudio')
                          : t('general.openrouterDashboard')}
                      </a>
                      .
                    </FieldDescription>
                  </Field>

                  <Field data-invalid={isModelMissing() || isModelNotFound ? 'true' : undefined}>
                    <FieldLabel htmlFor="general-ai-model">{t('general.modelIdLabel')}</FieldLabel>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="general-ai-model"
                        type="text"
                        value={currentModelId}
                        onChange={(e) => handleModelIdChange(e.target.value)}
                        placeholder={t('general.modelIdPlaceholder')}
                        aria-invalid={isModelMissing() || isModelNotFound || undefined}
                        className={cn(
                          (isModelMissing() || modelCheck.state === 'not_found') &&
                            'border-destructive focus-visible:ring-destructive/30',
                          modelCheck.state === 'ok' &&
                            'border-emerald-500 focus-visible:ring-emerald-500/30',
                          modelCheck.state === 'error' &&
                            'border-amber-500 focus-visible:ring-amber-500/30',
                        )}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCheckModel}
                        disabled={
                          modelCheck.state === 'checking' ||
                          !currentApiKey.trim() ||
                          !currentModelId.trim()
                        }
                      >
                        {modelCheck.state === 'checking' ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : (
                          <Sparkles aria-hidden="true" />
                        )}
                        {modelCheck.state === 'checking'
                          ? t('general.checkingModel')
                          : t('general.checkModel')}
                      </Button>
                    </div>
                    {isModelMissing() && (
                      <p className="text-xs font-medium text-destructive">
                        {t('general.modelIdRequired')}
                      </p>
                    )}
                    {modelCheck.state === 'ok' && (
                      <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <Check aria-hidden="true" className="size-3.5" />
                        {t('general.modelVerified')}
                      </p>
                    )}
                    {modelCheck.state === 'not_found' && (
                      <p className="text-xs font-medium text-destructive">
                        {t('general.modelNotFound')}
                      </p>
                    )}
                    {modelCheck.state === 'error' && (
                      <p className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                        <TriangleAlert aria-hidden="true" className="size-3.5" />
                        {t('general.modelCheckError')}
                      </p>
                    )}
                    <FieldDescription>
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
                    </FieldDescription>
                  </Field>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={submitDisabled}>
            <SubmitIcon aria-hidden="true" className={submitIconClass} />
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default GeneralSettings;
