import {
  Check,
  Clock,
  Globe,
  Loader2,
  Palette,
  Plus,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type React from 'react';
import { useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import type {
  AppBranding,
  GeneralSettings as IGeneralSettings,
  RilNoteOption,
  TimeEntryLocation,
} from '../../types';
import {
  DEFAULT_RIL_EXIT_TIME,
  DEFAULT_RIL_START_TIME,
  normalizeRilNoteOptions,
  normalizeRilTransferOptions,
} from '../../utils/ril';
import SelectControl, { type Option } from '../shared/SelectControl';
import Toggle from '../shared/Toggle';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import BrandingSettings from './BrandingSettings';

export interface GeneralSettingsProps {
  settings: IGeneralSettings;
  onUpdate: (updates: Partial<IGeneralSettings>) => void;
  branding: AppBranding;
  onBrandingChange: (branding: AppBranding) => void;
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
  { id: 'ai', Icon: Sparkles, labelKey: 'general.tabs.ai' },
  { id: 'branding', Icon: Palette, labelKey: 'general.tabs.branding' },
] as const;

type TabId = (typeof TABS)[number]['id'];
type EditableRilNoteOption = RilNoteOption & { draftId: string };
type EditableRilTransferOption = { draftId: string; value: string };

let rilDraftIdSequence = 0;

const createRilDraftId = (prefix: string) => {
  rilDraftIdSequence += 1;
  return `${prefix}-${rilDraftIdSequence}`;
};

const toEditableRilNoteOptions = (value: unknown): EditableRilNoteOption[] =>
  normalizeRilNoteOptions(value).map((option) => ({
    ...option,
    draftId: `note-${option.value}`,
  }));

const toPersistedRilNoteOptions = (options: EditableRilNoteOption[]): RilNoteOption[] =>
  options.map(({ value, label }) => ({ value, label }));

const toEditableRilTransferOptions = (value: unknown): EditableRilTransferOption[] =>
  normalizeRilTransferOptions(value).map((option) => ({
    value: option,
    draftId: `transfer-${option}`,
  }));

const toPersistedRilTransferOptions = (options: EditableRilTransferOption[]): string[] =>
  options.map((option) => option.value);

const areRilNoteOptionsEqual = (left: RilNoteOption[], right: unknown): boolean =>
  JSON.stringify(normalizeRilNoteOptions(left)) === JSON.stringify(normalizeRilNoteOptions(right));

const areRilTransferOptionsEqual = (left: string[], right: unknown): boolean =>
  JSON.stringify(normalizeRilTransferOptions(left)) ===
  JSON.stringify(normalizeRilTransferOptions(right));

interface GeneralSettingsState {
  currency: string;
  dailyLimit: number;
  startOfWeek: IGeneralSettings['startOfWeek'];
  treatSaturdayAsHoliday: boolean;
  allowWeekendSelection: boolean;
  defaultLocation: TimeEntryLocation;
  rilCompanyName: string;
  rilDefaultStartTime: string;
  rilDefaultExitTime: string;
  rilLunchBreakMinutes: number;
  rilNoteOptions: EditableRilNoteOption[];
  rilTransferOptions: EditableRilTransferOption[];
  enableAiReporting: boolean;
  geminiApiKey: string;
  aiProvider: AiProvider;
  openrouterApiKey: string;
  geminiModelId: string;
  openrouterModelId: string;
  modelCheck: { state: ModelCheckState; message?: string };
  activeTab: TabId;
  tabDirection: 'left' | 'right';
  isSaving: boolean;
  isSaved: boolean;
}

const INITIAL_GENERAL_SETTINGS_STATE: GeneralSettingsState = {
  currency: '',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: false,
  allowWeekendSelection: true,
  defaultLocation: 'remote',
  rilCompanyName: '',
  rilDefaultStartTime: DEFAULT_RIL_START_TIME,
  rilDefaultExitTime: DEFAULT_RIL_EXIT_TIME,
  rilLunchBreakMinutes: 60,
  rilNoteOptions: toEditableRilNoteOptions(undefined),
  rilTransferOptions: toEditableRilTransferOptions(undefined),
  enableAiReporting: false,
  geminiApiKey: '',
  aiProvider: 'gemini',
  openrouterApiKey: '',
  geminiModelId: '',
  openrouterModelId: '',
  modelCheck: { state: 'idle' },
  activeTab: 'localization',
  tabDirection: 'right',
  isSaving: false,
  isSaved: false,
};

type GeneralSettingsAction =
  | { type: 'merge'; patch: Partial<GeneralSettingsState> }
  | {
      type: 'setRilNoteOptions';
      updater: (prev: EditableRilNoteOption[]) => EditableRilNoteOption[];
    }
  | {
      type: 'setRilTransferOptions';
      updater: (prev: EditableRilTransferOption[]) => EditableRilTransferOption[];
    };

const generalSettingsReducer = (
  state: GeneralSettingsState,
  action: GeneralSettingsAction,
): GeneralSettingsState => {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.patch };
    case 'setRilNoteOptions':
      return { ...state, rilNoteOptions: action.updater(state.rilNoteOptions) };
    case 'setRilTransferOptions':
      return { ...state, rilTransferOptions: action.updater(state.rilTransferOptions) };
    default:
      return state;
  }
};

interface ToggleSettingRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  contentClassName?: string;
}

const ToggleSettingRow: React.FC<ToggleSettingRowProps> = ({
  label,
  description,
  checked,
  onChange,
  contentClassName,
}) => (
  <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 p-4">
    <div className={contentClassName}>
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} />
  </div>
);

const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  onUpdate,
  branding,
  onBrandingChange,
}) => {
  const { t } = useTranslation('settings');
  const AI_PROVIDER_OPTIONS: Option[] = [
    { id: 'gemini', name: t('general.aiProviders.gemini') },
    { id: 'openrouter', name: t('general.aiProviders.openrouter') },
  ];
  const [state, dispatch] = useReducer(generalSettingsReducer, INITIAL_GENERAL_SETTINGS_STATE);
  const {
    currency,
    dailyLimit,
    startOfWeek,
    treatSaturdayAsHoliday,
    allowWeekendSelection,
    defaultLocation,
    rilCompanyName,
    rilDefaultStartTime,
    rilDefaultExitTime,
    rilLunchBreakMinutes,
    rilNoteOptions,
    rilTransferOptions,
    enableAiReporting,
    geminiApiKey,
    aiProvider,
    openrouterApiKey,
    geminiModelId,
    openrouterModelId,
    modelCheck,
    activeTab,
    tabDirection,
    isSaving,
    isSaved,
  } = state;
  const loadedSettingsRef = useRef<IGeneralSettings | null>(null);

  const handleTabChange = (id: TabId) => {
    if (id === activeTab) return;
    const nextIndex = TABS.findIndex((tab) => tab.id === id);
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    dispatch({
      type: 'merge',
      patch: { tabDirection: nextIndex > currentIndex ? 'right' : 'left', activeTab: id },
    });
  };

  const sectionAnimationClass =
    tabDirection === 'right'
      ? 'animate-in fade-in slide-in-from-right-4 duration-300'
      : 'animate-in fade-in slide-in-from-left-4 duration-300';

  if (loadedSettingsRef.current !== settings) {
    loadedSettingsRef.current = settings;
    dispatch({
      type: 'merge',
      patch: {
        currency: settings.currency,
        dailyLimit: settings.dailyLimit,
        startOfWeek: settings.startOfWeek,
        treatSaturdayAsHoliday: settings.treatSaturdayAsHoliday,
        allowWeekendSelection: settings.allowWeekendSelection ?? true,
        defaultLocation: settings.defaultLocation || 'remote',
        rilCompanyName: settings.rilCompanyName || '',
        rilDefaultStartTime: settings.rilDefaultStartTime || DEFAULT_RIL_START_TIME,
        rilDefaultExitTime: settings.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME,
        rilLunchBreakMinutes: settings.rilLunchBreakMinutes ?? 60,
        rilNoteOptions: toEditableRilNoteOptions(settings.rilNoteOptions),
        rilTransferOptions: toEditableRilTransferOptions(settings.rilTransferOptions),
        enableAiReporting: settings.enableAiReporting,
        geminiApiKey: settings.geminiApiKey || '',
        aiProvider: settings.aiProvider || 'gemini',
        openrouterApiKey: settings.openrouterApiKey || '',
        geminiModelId: settings.geminiModelId || '',
        openrouterModelId: settings.openrouterModelId || '',
        modelCheck: { state: 'idle' },
      },
    });
  }

  const currentApiKey = aiProvider === 'gemini' ? geminiApiKey : openrouterApiKey;
  const currentModelId = aiProvider === 'gemini' ? geminiModelId : openrouterModelId;

  const handleApiKeyChange = (value: string) => {
    dispatch({
      type: 'merge',
      patch: {
        ...(aiProvider === 'gemini' ? { geminiApiKey: value } : { openrouterApiKey: value }),
        modelCheck: { state: 'idle' },
      },
    });
  };

  const handleModelIdChange = (value: string) => {
    dispatch({
      type: 'merge',
      patch: {
        ...(aiProvider === 'gemini' ? { geminiModelId: value } : { openrouterModelId: value }),
        modelCheck: { state: 'idle' },
      },
    });
  };

  const isAnyAiEnabled = enableAiReporting;
  const isApiKeyMissing = () => isAnyAiEnabled && !currentApiKey.trim();
  const isModelMissing = () => isAnyAiEnabled && !currentModelId.trim();
  const isModelNotFound = isAnyAiEnabled && modelCheck.state === 'not_found';

  const handleCheckModel = async () => {
    if (!currentApiKey.trim() || !currentModelId.trim()) return;
    dispatch({ type: 'merge', patch: { modelCheck: { state: 'checking' } } });
    try {
      const res = await api.ai.validateModel({
        provider: aiProvider,
        modelId: currentModelId,
        apiKey: currentApiKey,
      });
      if (res.ok) {
        dispatch({ type: 'merge', patch: { modelCheck: { state: 'ok' } } });
      } else if (res.code === 'NOT_FOUND') {
        dispatch({
          type: 'merge',
          patch: { modelCheck: { state: 'not_found', message: res.message || '' } },
        });
      } else {
        dispatch({
          type: 'merge',
          patch: { modelCheck: { state: 'error', message: res.message || '' } },
        });
      }
    } catch (err) {
      dispatch({
        type: 'merge',
        patch: { modelCheck: { state: 'error', message: (err as Error).message } },
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isApiKeyMissing() || isModelMissing() || isModelNotFound) return;
    dispatch({ type: 'merge', patch: { isSaving: true } });
    try {
      await onUpdate({
        currency,
        dailyLimit,
        startOfWeek,
        treatSaturdayAsHoliday,
        allowWeekendSelection,
        defaultLocation,
        rilCompanyName,
        rilDefaultStartTime,
        rilDefaultExitTime,
        rilLunchBreakMinutes,
        rilNoteOptions: normalizeRilNoteOptions(toPersistedRilNoteOptions(rilNoteOptions)),
        rilTransferOptions: normalizeRilTransferOptions(
          toPersistedRilTransferOptions(rilTransferOptions),
        ),
        enableAiReporting,
        geminiApiKey,
        aiProvider,
        openrouterApiKey,
        geminiModelId,
        openrouterModelId,
      });
      dispatch({ type: 'merge', patch: { isSaved: true } });
      setTimeout(() => dispatch({ type: 'merge', patch: { isSaved: false } }), 3000);
    } catch (err) {
      console.error('Failed to save general settings:', err);
    } finally {
      dispatch({ type: 'merge', patch: { isSaving: false } });
    }
  };

  const hasChanges =
    currency !== settings.currency ||
    dailyLimit !== settings.dailyLimit ||
    startOfWeek !== settings.startOfWeek ||
    treatSaturdayAsHoliday !== settings.treatSaturdayAsHoliday ||
    allowWeekendSelection !== (settings.allowWeekendSelection ?? true) ||
    defaultLocation !== (settings.defaultLocation || 'remote') ||
    rilCompanyName !== (settings.rilCompanyName || '') ||
    rilDefaultStartTime !== (settings.rilDefaultStartTime || DEFAULT_RIL_START_TIME) ||
    rilDefaultExitTime !== (settings.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME) ||
    rilLunchBreakMinutes !== (settings.rilLunchBreakMinutes ?? 60) ||
    !areRilNoteOptionsEqual(toPersistedRilNoteOptions(rilNoteOptions), settings.rilNoteOptions) ||
    !areRilTransferOptionsEqual(
      toPersistedRilTransferOptions(rilTransferOptions),
      settings.rilTransferOptions,
    ) ||
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

  const updateRilNoteOption = (index: number, field: keyof RilNoteOption, value: string) => {
    dispatch({
      type: 'setRilNoteOptions',
      updater: (prev) =>
        prev.map((option, optionIndex) =>
          optionIndex === index ? { ...option, [field]: value } : option,
        ),
    });
  };

  const addRilNoteOption = () => {
    dispatch({
      type: 'setRilNoteOptions',
      updater: (prev) => [...prev, { value: '', label: '', draftId: createRilDraftId('note') }],
    });
  };

  const removeRilNoteOption = (index: number) => {
    dispatch({
      type: 'setRilNoteOptions',
      updater: (prev) =>
        prev.length > 1 ? prev.filter((_, optionIndex) => optionIndex !== index) : prev,
    });
  };

  const updateRilTransferOption = (index: number, value: string) => {
    dispatch({
      type: 'setRilTransferOptions',
      updater: (prev) =>
        prev.map((option, optionIndex) => (optionIndex === index ? { ...option, value } : option)),
    });
  };

  const addRilTransferOption = () => {
    dispatch({
      type: 'setRilTransferOptions',
      updater: (prev) => [...prev, { value: '', draftId: createRilDraftId('transfer') }],
    });
  };

  const removeRilTransferOption = (index: number) => {
    dispatch({
      type: 'setRilTransferOptions',
      updater: (prev) =>
        prev.length > 1 ? prev.filter((_, optionIndex) => optionIndex !== index) : prev,
    });
  };

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
              onClick={() => handleTabChange(id)}
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
          <Card
            className={cn(
              'gap-0 overflow-hidden rounded-lg border-border bg-background py-0',
              sectionAnimationClass,
            )}
          >
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Globe aria-hidden="true" className="size-4 text-praetor" />
                {t('general.localizationDisplay')}
              </CardTitle>
              <CardDescription>{t('general.localizationDisplayDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <Field className="max-w-xs">
                <FieldLabel htmlFor="general-currency">{t('general.currencyLabel')}</FieldLabel>
                <SelectControl
                  id="general-currency"
                  options={CURRENCY_OPTIONS}
                  value={currency}
                  onChange={(val) =>
                    dispatch({ type: 'merge', patch: { currency: val as string } })
                  }
                  searchable={true}
                  placeholder={t('general.currencyLabel')}
                />
                <FieldDescription>{t('general.currencyDescription')}</FieldDescription>
              </Field>
            </CardContent>
          </Card>
        )}

        {activeTab === 'tracking' && (
          <Card
            className={cn(
              'gap-0 overflow-hidden rounded-lg border-border bg-background py-0',
              sectionAnimationClass,
            )}
          >
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Clock aria-hidden="true" className="size-4 text-praetor" />
                {t('general.globalTrackingPreferences')}
              </CardTitle>
              <CardDescription>{t('general.globalTrackingPreferencesDescription')}</CardDescription>
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
                      dispatch({
                        type: 'merge',
                        patch: { dailyLimit: value === '' || Number.isNaN(parsed) ? 0 : parsed },
                      });
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
                    onChange={(val) =>
                      dispatch({
                        type: 'merge',
                        patch: { startOfWeek: val as 'Monday' | 'Sunday' },
                      })
                    }
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
                    onChange={(val) =>
                      dispatch({
                        type: 'merge',
                        patch: { defaultLocation: val as TimeEntryLocation },
                      })
                    }
                  />
                  <FieldDescription>{t('general.defaultLocationDescription')}</FieldDescription>
                </Field>
              </div>

              <ToggleSettingRow
                label={t('general.treatSaturdayAsHolidayLabel')}
                description={t('general.treatSaturdayAsHolidayDescription')}
                checked={treatSaturdayAsHoliday}
                onChange={(checked) =>
                  dispatch({ type: 'merge', patch: { treatSaturdayAsHoliday: checked } })
                }
              />

              <ToggleSettingRow
                label={t('general.allowWeekendSelectionLabel')}
                description={t('general.allowWeekendSelectionDescription')}
                checked={allowWeekendSelection}
                onChange={(checked) =>
                  dispatch({ type: 'merge', patch: { allowWeekendSelection: checked } })
                }
              />

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {t('general.rilSettingsTitle')}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('general.rilSettingsDescription')}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                  <Field>
                    <FieldLabel htmlFor="general-ril-company-name">
                      {t('general.rilCompanyNameLabel')}
                    </FieldLabel>
                    <Input
                      id="general-ril-company-name"
                      value={rilCompanyName}
                      onChange={(event) =>
                        dispatch({ type: 'merge', patch: { rilCompanyName: event.target.value } })
                      }
                    />
                    <FieldDescription>{t('general.rilCompanyNameDescription')}</FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="general-ril-default-start-time">
                      {t('general.rilDefaultStartTimeLabel')}
                    </FieldLabel>
                    <Input
                      id="general-ril-default-start-time"
                      type="time"
                      value={rilDefaultStartTime}
                      onChange={(event) =>
                        dispatch({
                          type: 'merge',
                          patch: { rilDefaultStartTime: event.target.value },
                        })
                      }
                    />
                    <FieldDescription>
                      {t('general.rilDefaultStartTimeDescription')}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="general-ril-default-exit-time">
                      {t('general.rilDefaultExitTimeLabel')}
                    </FieldLabel>
                    <Input
                      id="general-ril-default-exit-time"
                      type="time"
                      value={rilDefaultExitTime}
                      onChange={(event) =>
                        dispatch({
                          type: 'merge',
                          patch: { rilDefaultExitTime: event.target.value },
                        })
                      }
                    />
                    <FieldDescription>
                      {t('general.rilDefaultExitTimeDescription')}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="general-ril-lunch-break-minutes">
                      {t('general.rilLunchBreakMinutesLabel')}
                    </FieldLabel>
                    <ValidatedNumberInput
                      id="general-ril-lunch-break-minutes"
                      step="1"
                      min={0}
                      max={240}
                      value={rilLunchBreakMinutes}
                      onValueChange={(value) => {
                        const parsed = parseInt(value, 10);
                        dispatch({
                          type: 'merge',
                          patch: {
                            rilLunchBreakMinutes: value === '' || Number.isNaN(parsed) ? 0 : parsed,
                          },
                        });
                      }}
                    />
                    <FieldDescription>
                      {t('general.rilLunchBreakMinutesDescription')}
                    </FieldDescription>
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel id="general-ril-note-options-label">
                        {t('general.rilNoteOptionsLabel')}
                      </FieldLabel>
                      <Button type="button" variant="outline" size="sm" onClick={addRilNoteOption}>
                        <Plus aria-hidden="true" />
                        {t('general.rilAddNoteOption')}
                      </Button>
                    </div>
                    <fieldset
                      aria-labelledby="general-ril-note-options-label"
                      className="space-y-2"
                    >
                      <div className="grid grid-cols-[5rem_minmax(0,1fr)_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
                        <span>{t('general.rilOptionCodeLabel')}</span>
                        <span>{t('general.rilOptionNameLabel')}</span>
                        <span className="sr-only">{t('general.actions')}</span>
                      </div>
                      {rilNoteOptions.map((option, index) => (
                        <div
                          key={option.draftId}
                          className="grid grid-cols-[5rem_minmax(0,1fr)_2rem] items-center gap-2"
                        >
                          <Input
                            aria-label={`${t('general.rilOptionCodeLabel')} ${index + 1}`}
                            value={option.value}
                            onChange={(event) =>
                              updateRilNoteOption(index, 'value', event.target.value)
                            }
                            className="h-8 font-mono text-xs"
                          />
                          <Input
                            aria-label={`${t('general.rilOptionNameLabel')} ${index + 1}`}
                            value={option.label}
                            onChange={(event) =>
                              updateRilNoteOption(index, 'label', event.target.value)
                            }
                            className="h-8 text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeRilNoteOption(index)}
                            disabled={rilNoteOptions.length <= 1}
                            aria-label={`${t('general.rilRemoveNoteOption')} ${index + 1}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </fieldset>
                  </Field>

                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel id="general-ril-transfer-options-label">
                        {t('general.rilTransferOptionsLabel')}
                      </FieldLabel>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addRilTransferOption}
                      >
                        <Plus aria-hidden="true" />
                        {t('general.rilAddTransferOption')}
                      </Button>
                    </div>
                    <fieldset
                      aria-labelledby="general-ril-transfer-options-label"
                      className="space-y-2"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
                        <span>{t('general.rilOptionNameLabel')}</span>
                        <span className="sr-only">{t('general.actions')}</span>
                      </div>
                      {rilTransferOptions.map((option, index) => (
                        <div
                          key={option.draftId}
                          className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2"
                        >
                          <Input
                            aria-label={`${t('general.rilTransferOptionNameLabel')} ${index + 1}`}
                            value={option.value}
                            onChange={(event) => updateRilTransferOption(index, event.target.value)}
                            className="h-8 text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeRilTransferOption(index)}
                            disabled={rilTransferOptions.length <= 1}
                            aria-label={`${t('general.rilRemoveTransferOption')} ${index + 1}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </fieldset>
                  </Field>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'ai' && (
          <Card
            className={cn(
              'gap-0 overflow-hidden rounded-lg border-border bg-background py-0',
              sectionAnimationClass,
            )}
          >
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Sparkles aria-hidden="true" className="size-4 text-praetor" />
                {t('general.aiCapabilities')}
              </CardTitle>
              <CardDescription>{t('general.aiCapabilitiesDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-6">
              <ToggleSettingRow
                label={t('general.enableAiReportingLabel')}
                description={t('general.enableAiReportingDescription')}
                checked={enableAiReporting}
                onChange={(checked) =>
                  dispatch({ type: 'merge', patch: { enableAiReporting: checked } })
                }
                contentClassName="max-w-md"
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
                      onChange={(val) =>
                        dispatch({
                          type: 'merge',
                          patch: { aiProvider: val as AiProvider, modelCheck: { state: 'idle' } },
                        })
                      }
                    />
                    <FieldDescription>{t('general.aiProviderDescription')}</FieldDescription>
                  </Field>

                  <Field data-invalid={isApiKeyMissing() ? 'true' : undefined}>
                    <FieldLabel htmlFor="general-ai-api-key" required>
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
                    <FieldLabel htmlFor="general-ai-model" required>
                      {t('general.modelIdLabel')}
                    </FieldLabel>
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

        {activeTab !== 'branding' && (
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={submitDisabled}>
              <SubmitIcon aria-hidden="true" className={submitIconClass} />
              {submitLabel}
            </Button>
          </div>
        )}
      </form>

      {activeTab === 'branding' && (
        <BrandingSettings
          branding={branding}
          onChange={onBrandingChange}
          animationClass={sectionAnimationClass}
        />
      )}
    </div>
  );
};

export default GeneralSettings;
