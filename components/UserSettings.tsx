import { REGEXP_ONLY_DIGITS } from 'input-otp';
import {
  AlertCircle,
  CalendarDays,
  Check,
  CircleHelp,
  Contrast,
  Globe,
  KeyRound,
  Languages,
  Loader2,
  Lock,
  type LucideIcon,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  Sun,
  SunMoon,
  Trash2,
  User,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siModelcontextprotocol } from 'simple-icons';
import TotpSetupWizard from '@/components/TotpSetupWizard';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api/client';
import praetorFaviconUrl from '../praetor-favicon.png';
import type {
  CreatedMcpToken,
  McpToken,
  McpTokenScope,
  PersonalAccessToken,
  RilWeekday,
  RilWeekdayTransferDefaults,
  Settings,
} from '../services/api';
import type { UserAuthMethod } from '../types';
import { downloadTextFile } from '../utils/download';
import { applyLanguagePreference } from '../utils/language';
import { applyTheme, getTheme, THEMES, type Theme } from '../utils/theme';

export interface UserSettingsProps {
  settings: Settings;
  authMethod?: UserAuthMethod;
  authProviderName?: string | null;
  isLoading?: boolean;
  // Available RIL "Trasferta" values (from general settings). Empty hides the RIL tab — e.g. for
  // users without RIL access or when no options are configured.
  rilTransferOptions?: string[];
  onUpdate: (updates: Partial<Settings>) => void;
  onUpdatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  // Takes the account password for step-up re-auth (a logged-in caller must re-confirm their
  // identity before enrolling a second factor). The enroll-token path in Login.tsx does not use
  // this prop.
  onTotpSetup: (password: string) => Promise<{
    secret: string;
    otpauthUri: string;
    qrDataUri: string;
    backupCodes: string[];
  }>;
  onTotpConfirm: (code: string) => Promise<void>;
  onTotpDisable: (payload: { password?: string; code?: string }) => Promise<void>;
  onRegenerateTotpBackupCodes: (code: string) => Promise<{ backupCodes: string[] }>;
  onGetTotpStatus: () => Promise<{
    enabled: boolean;
    applicable: boolean;
    featureEnabled: boolean;
    required: boolean;
  }>;
  onListMcpTokens: () => Promise<McpToken[]>;
  onCreateMcpToken: (name: string, scope: McpTokenScope) => Promise<CreatedMcpToken>;
  onRevokeMcpToken: (id: string) => Promise<unknown>;
  onGetPersonalAccessToken: () => Promise<PersonalAccessToken>;
  onRenewPersonalAccessToken: () => Promise<PersonalAccessToken>;
}

const TOTP_CODE_LENGTH = 6;

type LanguagePreference = NonNullable<Settings['language']>;
type ThemeSwatchVariant = 'default' | 'praetor';

const THEME_OPTION_META: Record<
  Theme,
  {
    swatchClassName: string;
    Icon?: LucideIcon;
    swatchVariant: ThemeSwatchVariant;
  }
> = {
  light: {
    swatchClassName:
      'bg-white border border-zinc-200 shadow-sm flex items-center justify-center text-praetor',
    Icon: Sun,
    swatchVariant: 'default',
  },
  dark: {
    swatchClassName:
      'bg-zinc-900 border border-zinc-700 shadow-sm flex items-center justify-center text-white',
    Icon: Moon,
    swatchVariant: 'default',
  },
  zebra: {
    swatchClassName:
      'bg-white border border-zinc-200 shadow-sm flex items-center justify-center text-praetor',
    Icon: Contrast,
    swatchVariant: 'default',
  },
  praetor: {
    swatchClassName: 'bg-white border border-zinc-200 shadow-sm flex items-center justify-center',
    swatchVariant: 'praetor',
  },
  auto: {
    swatchClassName:
      'bg-white border border-zinc-200 shadow-sm flex items-center justify-center text-praetor',
    Icon: SunMoon,
    swatchVariant: 'default',
  },
};

const ThemeSwatchContent: React.FC<{ option: (typeof THEME_OPTION_META)[Theme] }> = ({
  option,
}) => {
  if (option.swatchVariant === 'praetor') {
    return <img src={praetorFaviconUrl} alt="" className="size-12 max-w-none object-cover" />;
  }

  const Icon = option.Icon;
  return Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={2.25} /> : null;
};

const McpRevokeIcon: React.FC<{ isRevoking: boolean }> = ({ isRevoking }) =>
  isRevoking ? (
    <i className="fa-solid fa-circle-notch fa-spin"></i>
  ) : (
    <Trash2 aria-hidden="true" className="size-3.5" />
  );

const mcpTokenDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const formatMcpTokenDate = (value: number | null) => {
  if (!value) return 'Never';
  return mcpTokenDateFormatter.format(new Date(value));
};

const getMcpEndpointUrl = () => {
  if (typeof window === 'undefined') return '/api/mcp';
  const origin = window.location.origin;
  if (!origin || origin === 'null') return '/api/mcp';
  try {
    return new URL('/api/mcp', origin).toString();
  } catch {
    return '/api/mcp';
  }
};

const McpIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" className={className} role="img" viewBox="0 0 24 24" fill="currentColor">
    <path d={siModelcontextprotocol.path} />
  </svg>
);

const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: LanguagePreference;
  icon: React.ReactNode;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    value: 'auto',
    icon: <Globe aria-hidden="true" className="size-5" />,
    titleKey: 'language.auto',
    descriptionKey: 'language.autoDesc',
  },
  {
    value: 'en',
    icon: <span aria-hidden="true" className="fi fi-gb text-xl" />,
    titleKey: 'language.english',
    descriptionKey: 'language.englishDesc',
  },
  {
    value: 'it',
    icon: <span aria-hidden="true" className="fi fi-it text-xl" />,
    titleKey: 'language.italian',
    descriptionKey: 'language.italianDesc',
  },
];

// Stable empty default for the optional rilTransferOptions prop — a fresh `[]` literal as the
// default would change identity each render and defeat downstream memoization.
const EMPTY_RIL_TRANSFER_OPTIONS: string[] = [];

// Radix Select forbids an empty-string item value, so "no default" gets a sentinel.
const RIL_NONE_TRANSFER_VALUE = '__none__';
// Ordered weekday keys (match the stored preference). Labels are derived per-locale at render.
const RIL_WEEKDAY_KEYS: readonly RilWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
];

type UserSettingsTab = 'profile' | 'appearance' | 'language' | 'security' | 'mcp' | 'ril';

type TotpStatus = {
  enabled: boolean;
  applicable: boolean;
  featureEnabled: boolean;
  required: boolean;
};

type StateUpdate<T> = T | ((prev: T) => T);

type UserSettingsState = {
  fullName: string;
  email: string;
  language: LanguagePreference;
  currentTheme: Theme;
  activeTab: UserSettingsTab;
  rilWeekdayTransferDefaults: RilWeekdayTransferDefaults;
  isSaving: boolean;
  isSaved: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  isSavingPassword: boolean;
  passwordError: string;
  passwordSuccess: boolean;
  mcpTokens: McpToken[];
  mcpTokenName: string;
  mcpTokenScope: McpTokenScope;
  rawMcpToken: string;
  mcpError: string;
  isLoadingMcpTokens: boolean;
  isCreatingMcpToken: boolean;
  revokingMcpTokenId: string | null;
  personalAccessToken: PersonalAccessToken | null;
  isLoadingToken: boolean;
  isRenewingToken: boolean;
  tokenError: string;
  totpStatus: TotpStatus | null;
  isLoadingTotpStatus: boolean;
  totpStatusError: string;
  isTotpSetupOpen: boolean;
  totpSetupPassword: string;
  totpSetupReauthDone: boolean;
  isDisableDialogOpen: boolean;
  disablePassword: string;
  disableCode: string;
  isDisablingTotp: boolean;
  disableError: string;
  isRegenerateDialogOpen: boolean;
  regenerateCode: string;
  isRegeneratingCodes: boolean;
  regenerateError: string;
  regeneratedBackupCodes: string[] | null;
};

type UserSettingsStateValue = UserSettingsState[keyof UserSettingsState];
type UserSettingsStateUpdater = StateUpdate<UserSettingsStateValue>;

type UserSettingsAction =
  | {
      type: 'setField';
      field: keyof UserSettingsState;
      update: UserSettingsStateUpdater;
    }
  | { type: 'patch'; values: Partial<UserSettingsState> };

type TwoFactorViewState = {
  isFeatureDisabled: boolean;
  isIdpManagedTotp: boolean;
  isTotpEnabled: boolean;
  isTotpRequired: boolean;
};

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const createUserSettingsInitialState = (settings: Settings): UserSettingsState => ({
  fullName: settings.fullName,
  email: settings.email,
  language: settings.language || 'auto',
  currentTheme: getTheme(),
  activeTab: 'profile',
  rilWeekdayTransferDefaults: settings.rilWeekdayTransferDefaults ?? {},
  isSaving: false,
  isSaved: false,
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  isSavingPassword: false,
  passwordError: '',
  passwordSuccess: false,
  mcpTokens: [],
  mcpTokenName: '',
  mcpTokenScope: 'full',
  rawMcpToken: '',
  mcpError: '',
  isLoadingMcpTokens: false,
  isCreatingMcpToken: false,
  revokingMcpTokenId: null,
  personalAccessToken: null,
  isLoadingToken: false,
  isRenewingToken: false,
  tokenError: '',
  totpStatus: null,
  isLoadingTotpStatus: false,
  totpStatusError: '',
  isTotpSetupOpen: false,
  totpSetupPassword: '',
  totpSetupReauthDone: false,
  isDisableDialogOpen: false,
  disablePassword: '',
  disableCode: '',
  isDisablingTotp: false,
  disableError: '',
  isRegenerateDialogOpen: false,
  regenerateCode: '',
  isRegeneratingCodes: false,
  regenerateError: '',
  regeneratedBackupCodes: null,
});

const userSettingsReducer = (
  state: UserSettingsState,
  action: UserSettingsAction,
): UserSettingsState => {
  switch (action.type) {
    case 'setField':
      return {
        ...state,
        [action.field]: resolveStateUpdate(
          state[action.field],
          action.update as StateUpdate<(typeof state)[typeof action.field]>,
        ),
      };
    case 'patch':
      return { ...state, ...action.values };
  }
};

const useUserSettingsController = ({
  settings,
  authMethod = 'local',
  authProviderName = null,
  isLoading = false,
  rilTransferOptions = EMPTY_RIL_TRANSFER_OPTIONS,
  onUpdate,
  onUpdatePassword,
  onTotpSetup,
  onTotpConfirm,
  onTotpDisable,
  onRegenerateTotpBackupCodes,
  onGetTotpStatus,
  onListMcpTokens,
  onCreateMcpToken,
  onRevokeMcpToken,
  onGetPersonalAccessToken,
  onRenewPersonalAccessToken,
}: UserSettingsProps) => {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const translateRef = useRef(t);
  const isLocalAuth = authMethod === 'local';
  const identityProviderLabel = isLocalAuth
    ? ''
    : authProviderName || t(`settings:identityProviders.${authMethod}`);

  const [userSettingsState, dispatchUserSettings] = useReducer(
    userSettingsReducer,
    settings,
    createUserSettingsInitialState,
  );
  const setUserSettingsField = useCallback(
    <K extends keyof UserSettingsState>(field: K, update: StateUpdate<UserSettingsState[K]>) => {
      dispatchUserSettings({ type: 'setField', field, update: update as UserSettingsStateUpdater });
    },
    [],
  );
  const {
    fullName,
    email,
    language,
    currentTheme,
    activeTab,
    rilWeekdayTransferDefaults,
    isSaving,
    isSaved,
    currentPassword,
    newPassword,
    confirmPassword,
    isSavingPassword,
    passwordError,
    passwordSuccess,
    mcpTokens,
    mcpTokenName,
    mcpTokenScope,
    rawMcpToken,
    mcpError,
    isLoadingMcpTokens,
    isCreatingMcpToken,
    revokingMcpTokenId,
    personalAccessToken,
    isLoadingToken,
    isRenewingToken,
    tokenError,
    totpStatus,
    isLoadingTotpStatus,
    totpStatusError,
    isTotpSetupOpen,
    totpSetupPassword,
    totpSetupReauthDone,
    isDisableDialogOpen,
    disablePassword,
    disableCode,
    isDisablingTotp,
    disableError,
    isRegenerateDialogOpen,
    regenerateCode,
    isRegeneratingCodes,
    regenerateError,
    regeneratedBackupCodes,
  } = userSettingsState;
  const setFullName = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('fullName', update),
    [setUserSettingsField],
  );
  const setEmail = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('email', update),
    [setUserSettingsField],
  );
  const setLanguage = useCallback(
    (update: StateUpdate<LanguagePreference>) => setUserSettingsField('language', update),
    [setUserSettingsField],
  );
  const setCurrentTheme = useCallback(
    (update: StateUpdate<Theme>) => setUserSettingsField('currentTheme', update),
    [setUserSettingsField],
  );
  const setActiveTab = useCallback(
    (update: StateUpdate<UserSettingsTab>) => setUserSettingsField('activeTab', update),
    [setUserSettingsField],
  );
  const setRilWeekdayTransferDefaults = useCallback(
    (update: StateUpdate<RilWeekdayTransferDefaults>) =>
      setUserSettingsField('rilWeekdayTransferDefaults', update),
    [setUserSettingsField],
  );
  const setIsSaving = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isSaving', update),
    [setUserSettingsField],
  );
  const setIsSaved = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isSaved', update),
    [setUserSettingsField],
  );
  const setCurrentPassword = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('currentPassword', update),
    [setUserSettingsField],
  );
  const setNewPassword = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('newPassword', update),
    [setUserSettingsField],
  );
  const setConfirmPassword = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('confirmPassword', update),
    [setUserSettingsField],
  );
  const setIsSavingPassword = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isSavingPassword', update),
    [setUserSettingsField],
  );
  const setPasswordError = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('passwordError', update),
    [setUserSettingsField],
  );
  const setPasswordSuccess = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('passwordSuccess', update),
    [setUserSettingsField],
  );
  const setMcpTokens = useCallback(
    (update: StateUpdate<McpToken[]>) => setUserSettingsField('mcpTokens', update),
    [setUserSettingsField],
  );
  const setMcpTokenName = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('mcpTokenName', update),
    [setUserSettingsField],
  );
  const setMcpTokenScope = useCallback(
    (update: StateUpdate<McpTokenScope>) => setUserSettingsField('mcpTokenScope', update),
    [setUserSettingsField],
  );
  const setRawMcpToken = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('rawMcpToken', update),
    [setUserSettingsField],
  );
  const setMcpError = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('mcpError', update),
    [setUserSettingsField],
  );
  const setIsLoadingMcpTokens = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isLoadingMcpTokens', update),
    [setUserSettingsField],
  );
  const setIsCreatingMcpToken = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isCreatingMcpToken', update),
    [setUserSettingsField],
  );
  const setRevokingMcpTokenId = useCallback(
    (update: StateUpdate<string | null>) => setUserSettingsField('revokingMcpTokenId', update),
    [setUserSettingsField],
  );
  const setPersonalAccessToken = useCallback(
    (update: StateUpdate<PersonalAccessToken | null>) =>
      setUserSettingsField('personalAccessToken', update),
    [setUserSettingsField],
  );
  const setIsLoadingToken = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isLoadingToken', update),
    [setUserSettingsField],
  );
  const setIsRenewingToken = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isRenewingToken', update),
    [setUserSettingsField],
  );
  const setTokenError = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('tokenError', update),
    [setUserSettingsField],
  );
  const setTotpStatus = useCallback(
    (update: StateUpdate<TotpStatus | null>) => setUserSettingsField('totpStatus', update),
    [setUserSettingsField],
  );
  const setIsLoadingTotpStatus = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isLoadingTotpStatus', update),
    [setUserSettingsField],
  );
  const setTotpStatusError = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('totpStatusError', update),
    [setUserSettingsField],
  );
  const setIsTotpSetupOpen = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isTotpSetupOpen', update),
    [setUserSettingsField],
  );
  const setTotpSetupPassword = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('totpSetupPassword', update),
    [setUserSettingsField],
  );
  const setTotpSetupReauthDone = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('totpSetupReauthDone', update),
    [setUserSettingsField],
  );
  const setIsDisableDialogOpen = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isDisableDialogOpen', update),
    [setUserSettingsField],
  );
  const setDisablePassword = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('disablePassword', update),
    [setUserSettingsField],
  );
  const setDisableCode = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('disableCode', update),
    [setUserSettingsField],
  );
  const setIsDisablingTotp = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isDisablingTotp', update),
    [setUserSettingsField],
  );
  const setDisableError = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('disableError', update),
    [setUserSettingsField],
  );
  const setIsRegenerateDialogOpen = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isRegenerateDialogOpen', update),
    [setUserSettingsField],
  );
  const setRegenerateCode = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('regenerateCode', update),
    [setUserSettingsField],
  );
  const setIsRegeneratingCodes = useCallback(
    (update: StateUpdate<boolean>) => setUserSettingsField('isRegeneratingCodes', update),
    [setUserSettingsField],
  );
  const setRegenerateError = useCallback(
    (update: StateUpdate<string>) => setUserSettingsField('regenerateError', update),
    [setUserSettingsField],
  );
  const setRegeneratedBackupCodes = useCallback(
    (update: StateUpdate<string[] | null>) =>
      setUserSettingsField('regeneratedBackupCodes', update),
    [setUserSettingsField],
  );

  const showRilPreferences = rilTransferOptions.length > 0;
  // Tail of the weekday-default save chain: each update waits for the previous one so two quick
  // edits can't land out of order and overwrite the server with a stale map.
  const rilWeekdaySaveRef = useRef<Promise<unknown> | null>(null);
  // Synchronous mirror of the weekday defaults. A queued save reads this at send time (not a map
  // captured before the prior save settled), so a write chained behind a failed save won't re-send
  // a value the UI already rolled back.
  const rilWeekdayMapRef = useRef<RilWeekdayTransferDefaults>(rilWeekdayTransferDefaults);
  const rilWeekdayDefs = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language?.startsWith('it') ? 'it-IT' : 'en-US', {
      weekday: 'long',
    });
    // 2024-01-01 is a Monday, so +0..+4 yields Monday..Friday in the active locale.
    return RIL_WEEKDAY_KEYS.map((key, index) => {
      const label = formatter.format(new Date(2024, 0, 1 + index));
      return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
  }, [i18n.language]);
  const mcpEndpointUrl = useMemo(getMcpEndpointUrl, []);
  const mcpSetupPrompt = useMemo(
    () =>
      [
        'Configure Praetor as a remote MCP server for this AI agent.',
        '',
        `MCP server URL: ${mcpEndpointUrl}`,
        `Authorization bearer token: ${rawMcpToken || '<paste your Praetor MCP token here>'}`,
        'Transport: Streamable HTTP',
        'Server name: praetor',
        '',
        'Use the bearer token only for the MCP server connection. Do not send it in chat messages, logs, or tool arguments.',
        'After configuring the server, initialize the MCP connection and list tools to verify that Praetor is available.',
      ].join('\n'),
    [mcpEndpointUrl, rawMcpToken],
  );

  const tokenLoadInFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  // Two-factor authentication state. Status is loaded lazily when the Security
  // tab opens (mirroring the PAT loader below).
  const totpStatusInFlightRef = useRef(false);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    if (activeTab !== 'security' || personalAccessToken || tokenLoadInFlightRef.current) return;

    const loadToken = async () => {
      tokenLoadInFlightRef.current = true;
      setIsLoadingToken(true);
      setTokenError('');
      try {
        const tokenMetadata = await onGetPersonalAccessToken();
        if (isMountedRef.current) setPersonalAccessToken(tokenMetadata);
      } catch (err: unknown) {
        console.error('Failed to load personal access token:', err);
        if (isMountedRef.current) {
          setTokenError((err as Error).message || translateRef.current('security.tokenLoadFailed'));
        }
      } finally {
        tokenLoadInFlightRef.current = false;
        if (isMountedRef.current) setIsLoadingToken(false);
      }
    };

    void loadToken();
  }, [
    activeTab,
    onGetPersonalAccessToken,
    personalAccessToken,
    setIsLoadingToken,
    setPersonalAccessToken,
    setTokenError,
  ]);

  const loadTotpStatus = useCallback(async () => {
    if (totpStatusInFlightRef.current) return;
    totpStatusInFlightRef.current = true;
    setIsLoadingTotpStatus(true);
    setTotpStatusError('');
    try {
      const status = await onGetTotpStatus();
      if (isMountedRef.current) setTotpStatus(status);
    } catch (err: unknown) {
      console.error('Failed to load two-factor status:', err);
      if (isMountedRef.current) {
        setTotpStatusError(
          (err as Error).message || translateRef.current('security.tokenLoadFailed'),
        );
      }
    } finally {
      totpStatusInFlightRef.current = false;
      if (isMountedRef.current) setIsLoadingTotpStatus(false);
    }
  }, [onGetTotpStatus, setIsLoadingTotpStatus, setTotpStatus, setTotpStatusError]);

  // Lazily load the 2FA status the first time the Security tab is opened.
  useEffect(() => {
    if (activeTab !== 'security' || totpStatus || totpStatusInFlightRef.current) return;
    void loadTotpStatus();
  }, [activeTab, totpStatus, loadTotpStatus]);

  const handleTotpSetupFinished = useCallback(() => {
    setIsTotpSetupOpen(false);
    setTotpStatus((prev) => (prev ? { ...prev, enabled: true } : prev));
    void loadTotpStatus();
  }, [loadTotpStatus, setIsTotpSetupOpen, setTotpStatus]);

  const handleDisableTotp = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (isDisablingTotp) return;
      setIsDisablingTotp(true);
      setDisableError('');
      const payload: { password?: string; code?: string } = {};
      const trimmedPassword = disablePassword.trim();
      const trimmedCode = disableCode.trim();
      if (trimmedPassword) payload.password = trimmedPassword;
      if (trimmedCode) payload.code = trimmedCode;
      void onTotpDisable(payload)
        .then(() => {
          if (!isMountedRef.current) return;
          setIsDisableDialogOpen(false);
          setDisablePassword('');
          setDisableCode('');
          setTotpStatus((prev) => (prev ? { ...prev, enabled: false } : prev));
          void loadTotpStatus();
        })
        .catch((err: unknown) => {
          console.error('Failed to disable two-factor authentication:', err);
          if (!isMountedRef.current) return;
          const isInvalidCode = err instanceof ApiError && err.errorCode === 'invalid_totp_code';
          setDisableError(
            isInvalidCode
              ? t('twoFactor.invalidCode')
              : (err as Error).message || t('common:messages.errorOccurred'),
          );
        })
        .finally(() => {
          if (isMountedRef.current) setIsDisablingTotp(false);
        });
    },
    [
      disableCode,
      disablePassword,
      isDisablingTotp,
      loadTotpStatus,
      onTotpDisable,
      setDisableCode,
      setDisableError,
      setDisablePassword,
      setIsDisableDialogOpen,
      setIsDisablingTotp,
      setTotpStatus,
      t,
    ],
  );

  const handleRegenerateBackupCodes = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (isRegeneratingCodes) return;
      if (regenerateCode.length !== TOTP_CODE_LENGTH) return;
      setIsRegeneratingCodes(true);
      setRegenerateError('');
      try {
        const result = await onRegenerateTotpBackupCodes(regenerateCode);
        if (isMountedRef.current) setRegeneratedBackupCodes(result.backupCodes);
      } catch (err: unknown) {
        console.error('Failed to regenerate backup codes:', err);
        if (!isMountedRef.current) return;
        const isInvalidCode = err instanceof ApiError && err.errorCode === 'invalid_totp_code';
        setRegenerateError(
          isInvalidCode
            ? t('twoFactor.invalidCode')
            : (err as Error).message || t('common:messages.errorOccurred'),
        );
        setRegenerateCode('');
      } finally {
        if (isMountedRef.current) setIsRegeneratingCodes(false);
      }
    },
    [
      isRegeneratingCodes,
      onRegenerateTotpBackupCodes,
      regenerateCode,
      setIsRegeneratingCodes,
      setRegenerateCode,
      setRegeneratedBackupCodes,
      setRegenerateError,
      t,
    ],
  );

  const downloadBackupCodes = useCallback((codes: string[]) => {
    if (codes.length === 0) return;
    downloadTextFile('praetor-backup-codes.txt', `${codes.join('\n')}\n`);
  }, []);

  const handleThemeChange = (theme: Theme) => {
    if (theme === currentTheme) return;
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Profile fields are mastered by the identity provider for non-local users.
    if (!isLocalAuth) return;
    // Prevent double-submission when the user mashes Enter / clicks Save twice
    // in quick succession — `onUpdate` is async and a second call would race.
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onUpdate({
        fullName,
        email,
        language,
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLanguageChange = async (lang: LanguagePreference) => {
    if (lang === language) return;
    const previousLang = language;
    applyLanguagePreference(lang);
    setLanguage(lang);
    try {
      // Send only the language so this still works for non-local users
      // (the backend rejects fullName/email updates for them).
      await onUpdate({ language: lang });
    } catch (err) {
      console.error('Failed to update language:', err);
      // Roll the optimistic update back so the user can retry the same option.
      applyLanguagePreference(previousLang);
      setLanguage(previousLang);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError(t('password.passwordsDoNotMatch'));
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError(t('password.sameAsCurrent'));
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t('password.passwordMinLength'));
      return;
    }

    setIsSavingPassword(true);
    try {
      await onUpdatePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err: unknown) {
      console.error('Failed to update password:', err);
      setPasswordError((err as Error).message || 'Failed to update password');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const loadMcpTokens = useCallback(async () => {
    setIsLoadingMcpTokens(true);
    setMcpError('');
    try {
      setMcpTokens(await onListMcpTokens());
    } catch (err) {
      console.error('Failed to load MCP tokens:', err);
      setMcpError(translateRef.current('mcp.loadFailed'));
    } finally {
      setIsLoadingMcpTokens(false);
    }
  }, [onListMcpTokens, setIsLoadingMcpTokens, setMcpError, setMcpTokens]);

  const handleTabChange = useCallback(
    (tab: UserSettingsTab) => {
      setActiveTab(tab);
      if (tab === 'mcp') void loadMcpTokens();
    },
    [loadMcpTokens, setActiveTab],
  );

  // Persist the per-weekday default optimistically (same UX as the language picker): apply
  // locally, push to the backend, and roll back on failure.
  const handleWeekdayTransferChange = (day: RilWeekday, value: string) => {
    const previousValue = rilWeekdayMapRef.current[day];
    const next = { ...rilWeekdayMapRef.current };
    if (value === RIL_NONE_TRANSFER_VALUE) delete next[day];
    else next[day] = value;
    rilWeekdayMapRef.current = next;
    setRilWeekdayTransferDefaults(next);
    // Serialize the save behind any in-flight one so two quick edits can't complete out of order
    // and overwrite the server with a stale map. The PUT reads the live map at send time, so the
    // last edit wins and a write queued behind a failed save drops the rolled-back day.
    const prior = rilWeekdaySaveRef.current;
    const run = (async () => {
      if (prior) {
        try {
          await prior;
        } catch {
          // A failed prior save shouldn't block this one.
        }
      }
      try {
        await onUpdate({ rilWeekdayTransferDefaults: rilWeekdayMapRef.current });
      } catch (err) {
        console.error('Failed to update RIL transfer defaults:', err);
        // Roll back only this day (in the live map and rendered state) before this run settles, so
        // the next queued save reads the reverted map and won't re-send the failed value. Other
        // weekday edits are preserved.
        const reverted = { ...rilWeekdayMapRef.current };
        if (previousValue === undefined) delete reverted[day];
        else reverted[day] = previousValue;
        rilWeekdayMapRef.current = reverted;
        setRilWeekdayTransferDefaults(reverted);
      }
    })();
    rilWeekdaySaveRef.current = run;
    void run.finally(() => {
      if (rilWeekdaySaveRef.current === run) rilWeekdaySaveRef.current = null;
    });
  };

  const handleCreateMcpToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = mcpTokenName.trim();
    if (!name) return;
    setIsCreatingMcpToken(true);
    setMcpError('');
    setRawMcpToken('');
    try {
      const created = await onCreateMcpToken(name, mcpTokenScope);
      setMcpTokens((prev) => [created.token, ...prev]);
      setRawMcpToken(created.rawToken);
      setMcpTokenName('');
      setMcpTokenScope('full');
    } catch (err) {
      console.error('Failed to create MCP token:', err);
      setMcpError(t('mcp.createFailed'));
    } finally {
      setIsCreatingMcpToken(false);
    }
  };

  const handleRevokeMcpToken = async (id: string) => {
    setRevokingMcpTokenId(id);
    setMcpError('');
    try {
      await onRevokeMcpToken(id);
      setMcpTokens((prev) => prev.filter((token) => token.id !== id));
    } catch (err) {
      console.error('Failed to revoke MCP token:', err);
      setMcpError(t('mcp.revokeFailed'));
    } finally {
      setRevokingMcpTokenId(null);
    }
  };

  const handleRenewPersonalAccessToken = async () => {
    setIsRenewingToken(true);
    setTokenError('');
    try {
      const renewed = await onRenewPersonalAccessToken();
      setPersonalAccessToken(renewed);
    } catch (err: unknown) {
      console.error('Failed to renew personal access token:', err);
      setTokenError((err as Error).message || t('security.tokenRenewFailed'));
    } finally {
      setIsRenewingToken(false);
    }
  };

  const formatPersonalAccessTokenDate = (value: string | null) =>
    value ? new Date(value).toLocaleString() : t('security.neverUsed');

  const tokenDisplayValue = personalAccessToken
    ? (personalAccessToken.token ?? `${personalAccessToken.tokenPrefix}********`)
    : '';

  const hasChanges =
    fullName !== settings.fullName ||
    email !== settings.email ||
    language !== (settings.language || 'auto');

  return {
    activeTab,
    authMethod,
    confirmPassword,
    currentPassword,
    currentTheme,
    disableCode,
    disableError,
    disablePassword,
    downloadBackupCodes,
    email,
    formatPersonalAccessTokenDate,
    fullName,
    handleCreateMcpToken,
    handleDisableTotp,
    handleLanguageChange,
    handlePasswordUpdate,
    handleRegenerateBackupCodes,
    handleRenewPersonalAccessToken,
    handleRevokeMcpToken,
    handleSave,
    handleTabChange,
    handleThemeChange,
    handleTotpSetupFinished,
    handleWeekdayTransferChange,
    hasChanges,
    identityProviderLabel,
    isCreatingMcpToken,
    isDisableDialogOpen,
    isDisablingTotp,
    isLoading,
    isLoadingMcpTokens,
    isLoadingToken,
    isLoadingTotpStatus,
    isLocalAuth,
    isRegenerateDialogOpen,
    isRegeneratingCodes,
    isRenewingToken,
    isSaved,
    isSaving,
    isSavingPassword,
    isTotpSetupOpen,
    language,
    loadTotpStatus,
    mcpEndpointUrl,
    mcpError,
    mcpSetupPrompt,
    mcpTokenName,
    mcpTokenScope,
    mcpTokens,
    newPassword,
    onTotpConfirm,
    onTotpSetup,
    passwordError,
    passwordSuccess,
    personalAccessToken,
    rawMcpToken,
    regenerateCode,
    regenerateError,
    regeneratedBackupCodes,
    revokingMcpTokenId,
    rilTransferOptions,
    rilWeekdayDefs,
    rilWeekdayTransferDefaults,
    setConfirmPassword,
    setCurrentPassword,
    setDisableCode,
    setDisableError,
    setDisablePassword,
    setEmail,
    setFullName,
    setIsDisableDialogOpen,
    setIsRegenerateDialogOpen,
    setIsTotpSetupOpen,
    setMcpTokenName,
    setMcpTokenScope,
    setNewPassword,
    setRegenerateCode,
    setRegenerateError,
    setRegeneratedBackupCodes,
    setTokenError,
    setTotpSetupPassword,
    setTotpSetupReauthDone,
    showRilPreferences,
    t,
    tokenDisplayValue,
    tokenError,
    totpSetupPassword,
    totpSetupReauthDone,
    totpStatus,
    totpStatusError,
  };
};

type UserSettingsController = ReturnType<typeof useUserSettingsController>;

const UserSettings: React.FC<UserSettingsProps> = (props) => {
  const controller = useUserSettingsController(props);
  return <UserSettingsLayout controller={controller} />;
};

const UserSettingsLayout: React.FC<{ controller: UserSettingsController }> = ({ controller }) => {
  if (controller.isLoading) {
    return <UserSettingsLoading controller={controller} />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <UserSettingsHeader controller={controller} />
      <UserSettingsTabs controller={controller} />
      <UserSettingsActivePanel controller={controller} />
    </div>
  );
};

const UserSettingsLoading: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
    <div className="text-center">
      <i className="fa-solid fa-circle-notch fa-spin text-praetor text-3xl mb-3"></i>
      <p className="text-zinc-500 font-medium">{controller.t('common:states.loading')}</p>
    </div>
  </div>
);

const UserSettingsHeader: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="flex justify-between items-center">
    <div>
      <h2 className="text-2xl font-semibold text-zinc-800">{controller.t('title')}</h2>
      <p className="text-sm text-zinc-500 mt-1">{controller.t('subtitle')}</p>
    </div>
  </div>
);

const UserSettingsTabs: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="flex border-b border-zinc-200 gap-8">
    <UserSettingsTabButton controller={controller} tab="profile" iconClass="fa-solid fa-user">
      {controller.t('userProfile.title')}
    </UserSettingsTabButton>
    <UserSettingsTabButton controller={controller} tab="appearance" iconClass="fa-solid fa-palette">
      {controller.t('appearance.title')}
    </UserSettingsTabButton>
    <UserSettingsTabButton controller={controller} tab="language" iconClass="fa-solid fa-language">
      {controller.t('language.title')}
    </UserSettingsTabButton>
    <UserSettingsTabButton controller={controller} tab="security" iconClass="fa-solid fa-lock">
      {controller.t('security.title')}
    </UserSettingsTabButton>
    <UserSettingsTabButton
      controller={controller}
      tab="mcp"
      icon={<McpIcon className="inline size-4 mr-2 align-[-2px]" />}
    >
      {controller.t('mcp.title')}
    </UserSettingsTabButton>
    {controller.showRilPreferences && (
      <UserSettingsTabButton
        controller={controller}
        tab="ril"
        icon={<CalendarDays aria-hidden="true" className="inline size-4 mr-2 align-[-2px]" />}
      >
        {controller.t('ril.title')}
      </UserSettingsTabButton>
    )}
  </div>
);

const UserSettingsTabButton: React.FC<{
  controller: UserSettingsController;
  tab: UserSettingsTab;
  children: React.ReactNode;
  iconClass?: string;
  icon?: React.ReactNode;
}> = ({ controller, tab, children, iconClass, icon }) => {
  const isActive = controller.activeTab === tab;
  return (
    <button
      type="button"
      onClick={() => controller.handleTabChange(tab)}
      className={`pb-4 text-sm font-bold transition-all relative ${
        isActive ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'
      }`}
    >
      {icon ?? <i className={`${iconClass} mr-2`}></i>}
      {children}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
      )}
    </button>
  );
};

const UserSettingsActivePanel: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => {
  if (controller.activeTab === 'profile') return <ProfileSettingsPanel controller={controller} />;
  if (controller.activeTab === 'appearance') {
    return <AppearanceSettingsPanel controller={controller} />;
  }
  if (controller.activeTab === 'language') return <LanguageSettingsPanel controller={controller} />;
  if (controller.activeTab === 'security') return <SecuritySettingsPanel controller={controller} />;
  if (controller.activeTab === 'mcp') return <McpSettingsPanel controller={controller} />;
  if (controller.activeTab === 'ril' && controller.showRilPreferences) {
    return <RilSettingsPanel controller={controller} />;
  }
  return null;
};

const ProfileSettingsPanel: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <User aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('userProfile.title')}
      </CardTitle>
      <CardDescription>{controller.t('userProfile.description')}</CardDescription>
    </CardHeader>
    <form onSubmit={controller.handleSave}>
      <CardContent className="space-y-6 p-6">
        {!controller.isLocalAuth && (
          <LockedSettingsBanner
            icon={<Lock aria-hidden="true" className="size-4" />}
            message={controller.t('userProfile.lockedBanner', {
              provider: controller.identityProviderLabel,
            })}
          />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field>
            <FieldLabel htmlFor="profile-full-name" required={controller.isLocalAuth}>
              {controller.t('userProfile.fullName')}
            </FieldLabel>
            <Input
              id="profile-full-name"
              type="text"
              value={controller.fullName}
              onChange={(event) => controller.setFullName(event.target.value)}
              disabled={!controller.isLocalAuth}
              readOnly={!controller.isLocalAuth}
              aria-readonly={!controller.isLocalAuth}
              required={controller.isLocalAuth}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-email" required={controller.isLocalAuth}>
              {controller.t('userProfile.email')}
            </FieldLabel>
            <Input
              id="profile-email"
              type="email"
              value={controller.email}
              onChange={(event) => controller.setEmail(event.target.value)}
              disabled={!controller.isLocalAuth}
              readOnly={!controller.isLocalAuth}
              aria-readonly={!controller.isLocalAuth}
              required={controller.isLocalAuth}
            />
          </Field>
        </div>
      </CardContent>
      {controller.isLocalAuth && (
        <CardFooter className="justify-end border-t border-border px-6 py-4 [.border-t]:pt-4">
          <ProfileSaveButton controller={controller} />
        </CardFooter>
      )}
    </form>
  </Card>
);

const LockedSettingsBanner: React.FC<{ icon: React.ReactNode; message: string }> = ({
  icon,
  message,
}) => (
  <output
    aria-live="polite"
    className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-4 text-sm font-medium text-muted-foreground"
  >
    {icon}
    {message}
  </output>
);

const ProfileSaveButton: React.FC<{ controller: UserSettingsController }> = ({ controller }) => {
  const state = controller.isSaving
    ? { Icon: Loader2, iconClass: 'animate-spin', label: controller.t('general.saving') }
    : controller.isSaved
      ? { Icon: Check, iconClass: undefined, label: controller.t('general.changesSaved') }
      : { Icon: Save, iconClass: undefined, label: controller.t('general.saveChanges') };
  return (
    <Button type="submit" disabled={controller.isSaving || !controller.hasChanges}>
      <state.Icon aria-hidden="true" className={state.iconClass} />
      {state.label}
    </Button>
  );
};

const AppearanceSettingsPanel: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <Card className="gap-0 overflow-hidden rounded-lg bg-background py-0">
    <CardHeader className="border-b bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <Palette aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('appearance.title')}
      </CardTitle>
      <CardDescription>{controller.t('appearance.description')}</CardDescription>
    </CardHeader>
    <CardContent className="p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {THEMES.map((theme) => (
          <ThemeOptionCard key={theme} controller={controller} theme={theme} />
        ))}
      </div>
    </CardContent>
  </Card>
);

const ThemeOptionCard: React.FC<{ controller: UserSettingsController; theme: Theme }> = ({
  controller,
  theme,
}) => {
  const isSelected = controller.currentTheme === theme;
  const option = THEME_OPTION_META[theme];
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => controller.handleThemeChange(theme)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          controller.handleThemeChange(theme);
        }
      }}
      className={cn(
        'flex-row items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'border-primary ring-2 ring-primary/40',
      )}
    >
      <div className="relative shrink-0">
        <div className={cn('size-10 overflow-hidden rounded-full', option.swatchClassName)}>
          <ThemeSwatchContent option={option} />
        </div>
        {isSelected && <SelectedOptionCheck />}
      </div>
      <div className="min-w-0">
        <h4 className="font-semibold text-foreground">
          {controller.t(`appearance.${theme}.name`)}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {controller.t(`appearance.${theme}.description`)}
        </p>
      </div>
    </Card>
  );
};

const SelectedOptionCheck: React.FC = () => (
  <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
    <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
  </span>
);

const LanguageSettingsPanel: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <Card className="gap-0 overflow-hidden rounded-lg bg-background py-0">
    <CardHeader className="border-b bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <Languages aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('language.title')}
      </CardTitle>
      <CardDescription>{controller.t('language.description')}</CardDescription>
    </CardHeader>
    <CardContent className="p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {LANGUAGE_OPTIONS.map((option) => (
          <LanguageOptionCard key={option.value} controller={controller} option={option} />
        ))}
      </div>
    </CardContent>
  </Card>
);

const LanguageOptionCard: React.FC<{
  controller: UserSettingsController;
  option: (typeof LANGUAGE_OPTIONS)[number];
}> = ({ controller, option }) => {
  const active = controller.language === option.value;
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => controller.handleLanguageChange(option.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          controller.handleLanguageChange(option.value);
        }
      }}
      className={cn(
        'flex-row items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-primary ring-2 ring-primary/40',
      )}
    >
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {option.icon}
        {active && <SelectedOptionCheck />}
      </div>
      <div className="min-w-0">
        <h4 className="font-semibold text-foreground">{controller.t(option.titleKey)}</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {controller.t(option.descriptionKey)}
        </p>
      </div>
    </Card>
  );
};

const SecuritySettingsPanel: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <div className="space-y-6">
    <PasswordSettingsCard controller={controller} />
    <TwoFactorSettingsCard controller={controller} />
    <PersonalAccessTokenCard controller={controller} />
  </div>
);

const PasswordSettingsCard: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <Lock aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('password.title')}
      </CardTitle>
      <CardDescription>{controller.t('password.description')}</CardDescription>
    </CardHeader>
    {controller.isLocalAuth ? (
      <form onSubmit={controller.handlePasswordUpdate}>
        <CardContent className="space-y-6 p-6">
          {controller.passwordError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive animate-in fade-in slide-in-from-top-2">
              <AlertCircle aria-hidden="true" className="size-4" />
              {controller.passwordError}
            </div>
          )}
          <PasswordFields controller={controller} />
        </CardContent>
        <CardFooter className="justify-end border-t border-border px-6 py-4 [.border-t]:pt-4">
          <PasswordSubmitButton controller={controller} />
        </CardFooter>
      </form>
    ) : (
      <CardContent className="p-6">
        <LockedSettingsBanner
          icon={<Lock aria-hidden="true" className="size-4" />}
          message={controller.t('password.lockedBanner', {
            provider: controller.identityProviderLabel,
          })}
        />
      </CardContent>
    )}
  </Card>
);

const PasswordFields: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    <Field>
      <FieldLabel htmlFor="security-current-password" required>
        {controller.t('password.currentPassword')}
      </FieldLabel>
      <Input
        id="security-current-password"
        type="password"
        value={controller.currentPassword}
        onChange={(event) => controller.setCurrentPassword(event.target.value)}
        placeholder="••••••••"
        required
      />
    </Field>
    <Field className="md:col-start-1">
      <FieldLabel htmlFor="security-new-password" required>
        {controller.t('password.newPassword')}
      </FieldLabel>
      <Input
        id="security-new-password"
        type="password"
        value={controller.newPassword}
        onChange={(event) => controller.setNewPassword(event.target.value)}
        placeholder="••••••••"
        required
      />
    </Field>
    <Field>
      <FieldLabel htmlFor="security-confirm-password" required>
        {controller.t('password.confirmNewPassword')}
      </FieldLabel>
      <Input
        id="security-confirm-password"
        type="password"
        value={controller.confirmPassword}
        onChange={(event) => controller.setConfirmPassword(event.target.value)}
        placeholder="••••••••"
        required
      />
    </Field>
  </div>
);

const PasswordSubmitButton: React.FC<{ controller: UserSettingsController }> = ({ controller }) => {
  const state = controller.isSavingPassword
    ? { Icon: Loader2, iconClass: 'animate-spin', label: controller.t('password.updating') }
    : controller.passwordSuccess
      ? { Icon: Check, iconClass: undefined, label: controller.t('password.passwordUpdated') }
      : { Icon: KeyRound, iconClass: undefined, label: controller.t('password.updatePassword') };
  return (
    <Button
      type="submit"
      disabled={
        controller.isSavingPassword ||
        !controller.currentPassword ||
        !controller.newPassword ||
        !controller.confirmPassword
      }
    >
      <state.Icon aria-hidden="true" className={state.iconClass} />
      {state.label}
    </Button>
  );
};

const TwoFactorSettingsCard: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => {
  const twoFactorView: TwoFactorViewState = {
    isIdpManagedTotp:
      controller.authMethod === 'oidc' ||
      controller.authMethod === 'saml' ||
      controller.totpStatus?.applicable === false,
    isTotpEnabled: controller.totpStatus?.enabled === true,
    isFeatureDisabled: controller.totpStatus?.featureEnabled === false,
    isTotpRequired: controller.totpStatus?.required === true,
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <ShieldCheck aria-hidden="true" className="size-4 text-praetor" />
          {controller.t('twoFactor.title')}
        </CardTitle>
        <CardDescription>{controller.t('twoFactor.description')}</CardDescription>
        {controller.totpStatus &&
          !twoFactorView.isIdpManagedTotp &&
          !twoFactorView.isFeatureDisabled && (
            <CardAction>
              <Badge variant={twoFactorView.isTotpEnabled ? 'default' : 'secondary'}>
                {twoFactorView.isTotpEnabled
                  ? controller.t('twoFactor.statusEnabled')
                  : controller.t('twoFactor.statusDisabled')}
              </Badge>
            </CardAction>
          )}
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        <TwoFactorCardContent controller={controller} view={twoFactorView} />
      </CardContent>
    </Card>
  );
};

const TwoFactorCardContent: React.FC<{
  controller: UserSettingsController;
  view: TwoFactorViewState;
}> = ({ controller, view }) => {
  if (view.isIdpManagedTotp) return <TwoFactorInfo controller={controller} kind="idp" />;
  if (controller.isLoadingTotpStatus && !controller.totpStatus) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {controller.t('common:states.loading')}
      </div>
    );
  }
  if (controller.totpStatusError) return <TwoFactorStatusError controller={controller} />;
  if (view.isFeatureDisabled) return <TwoFactorInfo controller={controller} kind="disabled" />;
  if (view.isTotpEnabled) {
    return <TwoFactorEnabledActions controller={controller} isTotpRequired={view.isTotpRequired} />;
  }
  return <TwoFactorSetupAction controller={controller} isTotpRequired={view.isTotpRequired} />;
};

const TwoFactorInfo: React.FC<{ controller: UserSettingsController; kind: 'idp' | 'disabled' }> = ({
  controller,
  kind,
}) => (
  <output
    aria-live="polite"
    className="flex w-full items-start gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
  >
    <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <div className="space-y-1">
      <p className="font-medium text-foreground">
        {kind === 'idp'
          ? controller.t('twoFactor.idpManagedTitle')
          : controller.t('twoFactor.disabledByAdminTitle', 'Two-factor authentication is off')}
      </p>
      <p>
        {kind === 'idp'
          ? controller.t('twoFactor.idpManagedDescription')
          : controller.t(
              'twoFactor.disabledByAdminDescription',
              'Two-factor authentication is currently turned off for your organization. It cannot be set up until an administrator enables it.',
            )}
      </p>
    </div>
  </output>
);

const TwoFactorStatusError: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="space-y-3">
    <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
      {controller.totpStatusError}
    </div>
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void controller.loadTotpStatus()}
      disabled={controller.isLoadingTotpStatus}
    >
      <RefreshCw
        aria-hidden="true"
        className={controller.isLoadingTotpStatus ? 'animate-spin' : undefined}
      />
      {controller.t('common:buttons.retry', { defaultValue: 'Retry' })}
    </Button>
  </div>
);

const TwoFactorEnabledActions: React.FC<{
  controller: UserSettingsController;
  isTotpRequired: boolean;
}> = ({ controller, isTotpRequired }) => (
  <div className="space-y-4">
    {isTotpRequired && (
      <p className="text-sm text-muted-foreground">
        {controller.t(
          'twoFactor.requiredByOrg',
          'Two-factor authentication is required for your role. You can regenerate backup codes, but it cannot be turned off.',
        )}
      </p>
    )}
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {!isTotpRequired && <DisableTotpDialog controller={controller} />}
      <RegenerateBackupCodesDialog controller={controller} />
    </div>
  </div>
);

const DisableTotpDialog: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Dialog
    open={controller.isDisableDialogOpen}
    onOpenChange={(open) => {
      controller.setIsDisableDialogOpen(open);
      if (!open) {
        controller.setDisablePassword('');
        controller.setDisableCode('');
        controller.setDisableError('');
      }
    }}
  >
    <DialogTrigger asChild>
      <Button type="button" variant="destructive">
        <Lock aria-hidden="true" />
        {controller.t('twoFactor.disable')}
      </Button>
    </DialogTrigger>
    <DialogContent>
      <form onSubmit={controller.handleDisableTotp}>
        <DialogHeader>
          <DialogTitle>{controller.t('twoFactor.disableTitle')}</DialogTitle>
          <DialogDescription>{controller.t('twoFactor.disableDescription')}</DialogDescription>
        </DialogHeader>
        <DisableTotpFields controller={controller} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={controller.isDisablingTotp}>
              {controller.t('twoFactor.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            variant="destructive"
            disabled={
              controller.isDisablingTotp ||
              !controller.disableCode.trim() ||
              (controller.isLocalAuth && !controller.disablePassword.trim())
            }
          >
            {controller.isDisablingTotp ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                {controller.t('twoFactor.verifying')}
              </>
            ) : (
              controller.t('twoFactor.confirmDisable')
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);

const DisableTotpFields: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="space-y-4 py-4">
    {controller.disableError && (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{controller.disableError}</AlertTitle>
      </Alert>
    )}
    {controller.isLocalAuth && (
      <Field>
        <FieldLabel htmlFor="totp-disable-password" required>
          {controller.t('twoFactor.disablePasswordLabel')}
        </FieldLabel>
        <Input
          id="totp-disable-password"
          type="password"
          value={controller.disablePassword}
          onChange={(event) => {
            controller.setDisablePassword(event.target.value);
            if (controller.disableError) controller.setDisableError('');
          }}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </Field>
    )}
    <Field>
      <FieldLabel htmlFor="totp-disable-code" required>
        {controller.t('twoFactor.disableCodeLabel')}
      </FieldLabel>
      <Input
        id="totp-disable-code"
        autoComplete="one-time-code"
        value={controller.disableCode}
        onChange={(event) => {
          controller.setDisableCode(event.target.value);
          if (controller.disableError) controller.setDisableError('');
        }}
        placeholder="123456"
        className="font-mono tracking-[0.3em]"
      />
    </Field>
  </div>
);

const RegenerateBackupCodesDialog: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <Dialog
    open={controller.isRegenerateDialogOpen}
    onOpenChange={(open) => {
      controller.setIsRegenerateDialogOpen(open);
      if (!open) {
        controller.setRegenerateCode('');
        controller.setRegenerateError('');
        controller.setRegeneratedBackupCodes(null);
      }
    }}
  >
    <DialogTrigger asChild>
      <Button type="button" variant="outline">
        <RefreshCw aria-hidden="true" />
        {controller.t('twoFactor.regenerateBackupCodes')}
      </Button>
    </DialogTrigger>
    <DialogContent>
      {controller.regeneratedBackupCodes ? (
        <RegeneratedBackupCodes controller={controller} />
      ) : (
        <RegenerateBackupCodesForm controller={controller} />
      )}
    </DialogContent>
  </Dialog>
);

const RegeneratedBackupCodes: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => {
  const codes = controller.regeneratedBackupCodes ?? [];
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
          {controller.t('twoFactor.backupTitle')}
        </DialogTitle>
        <DialogDescription>{controller.t('twoFactor.backupInstructions')}</DialogDescription>
      </DialogHeader>
      <ul className="my-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-4">
        {codes.map((backupCode) => (
          <li
            key={backupCode}
            className="rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-sm tracking-[0.15em] text-foreground"
          >
            {backupCode}
          </li>
        ))}
      </ul>
      <DialogFooter>
        <CopyButton
          variant="outline"
          value={codes.join('\n')}
          label={controller.t('twoFactor.copyCodes')}
          copiedLabel={controller.t('twoFactor.copyCodes')}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => controller.downloadBackupCodes(codes)}
        >
          {controller.t('twoFactor.downloadCodes')}
        </Button>
        <DialogClose asChild>
          <Button type="button">{controller.t('twoFactor.done')}</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
};

const RegenerateBackupCodesForm: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <form onSubmit={controller.handleRegenerateBackupCodes}>
    <DialogHeader>
      <DialogTitle>{controller.t('twoFactor.regenerateBackupCodes')}</DialogTitle>
      <DialogDescription>{controller.t('twoFactor.enterCodeLabel')}</DialogDescription>
    </DialogHeader>
    <div className="flex flex-col items-center gap-4 py-4">
      <InputOTP
        maxLength={TOTP_CODE_LENGTH}
        value={controller.regenerateCode}
        onChange={(value) => {
          controller.setRegenerateCode(value);
          if (controller.regenerateError) controller.setRegenerateError('');
        }}
        pattern={REGEXP_ONLY_DIGITS}
        disabled={controller.isRegeneratingCodes}
        aria-invalid={controller.regenerateError ? true : undefined}
        aria-label={controller.t('twoFactor.enterCodeLabel')}
        containerClassName="justify-center"
      >
        <InputOTPGroup>
          {Array.from({ length: TOTP_CODE_LENGTH }, (_, index) => (
            <InputOTPSlot
              key={index}
              index={index}
              aria-invalid={controller.regenerateError ? true : undefined}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {controller.regenerateError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{controller.regenerateError}</AlertTitle>
        </Alert>
      )}
    </div>
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="outline" disabled={controller.isRegeneratingCodes}>
          {controller.t('twoFactor.cancel')}
        </Button>
      </DialogClose>
      <Button
        type="submit"
        disabled={
          controller.isRegeneratingCodes || controller.regenerateCode.length !== TOTP_CODE_LENGTH
        }
      >
        {controller.isRegeneratingCodes ? (
          <>
            <Loader2 aria-hidden="true" className="animate-spin" />
            {controller.t('twoFactor.verifying')}
          </>
        ) : (
          controller.t('twoFactor.regenerate')
        )}
      </Button>
    </DialogFooter>
  </form>
);

const TwoFactorSetupAction: React.FC<{
  controller: UserSettingsController;
  isTotpRequired: boolean;
}> = ({ controller, isTotpRequired }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-sm text-muted-foreground">
      {isTotpRequired
        ? controller.t(
            'twoFactor.requiredByOrgSetup',
            'Two-factor authentication is required for your role. Set it up now — you will be asked to complete it at your next sign-in otherwise.',
          )
        : controller.t('twoFactor.scanInstructions')}
    </p>
    <TotpSetupDialog controller={controller} />
  </div>
);

const TotpSetupDialog: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Dialog
    open={controller.isTotpSetupOpen}
    onOpenChange={(open) => {
      controller.setIsTotpSetupOpen(open);
      if (!open) {
        controller.setTotpSetupPassword('');
        controller.setTotpSetupReauthDone(false);
      }
    }}
  >
    <DialogTrigger asChild>
      <Button type="button">
        <ShieldCheck aria-hidden="true" />
        {controller.t('twoFactor.setUp')}
      </Button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-md">
      {controller.isTotpSetupOpen && !controller.totpSetupReauthDone ? (
        <TotpSetupReauthForm controller={controller} />
      ) : (
        <TotpSetupWizardPane controller={controller} />
      )}
    </DialogContent>
  </Dialog>
);

const TotpSetupReauthForm: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      if (!controller.totpSetupPassword.trim()) return;
      controller.setTotpSetupReauthDone(true);
    }}
  >
    <DialogHeader>
      <DialogTitle>{controller.t('twoFactor.reauthTitle')}</DialogTitle>
      <DialogDescription>{controller.t('twoFactor.reauthDescription')}</DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-4">
      <Field>
        <FieldLabel htmlFor="totp-setup-password" required>
          {controller.t('twoFactor.reauthPasswordLabel')}
        </FieldLabel>
        <Input
          id="totp-setup-password"
          type="password"
          value={controller.totpSetupPassword}
          onChange={(event) => controller.setTotpSetupPassword(event.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </Field>
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => controller.setIsTotpSetupOpen(false)}>
        {controller.t('twoFactor.cancel')}
      </Button>
      <Button type="submit" disabled={!controller.totpSetupPassword.trim()}>
        {controller.t('twoFactor.continue')}
      </Button>
    </DialogFooter>
  </form>
);

const TotpSetupWizardPane: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <>
    <DialogHeader className="sr-only">
      <DialogTitle>{controller.t('twoFactor.setupTitle')}</DialogTitle>
      <DialogDescription>{controller.t('twoFactor.scanInstructions')}</DialogDescription>
    </DialogHeader>
    {controller.isTotpSetupOpen && (
      <TotpSetupWizard
        onSetup={() => controller.onTotpSetup(controller.totpSetupPassword)}
        onConfirm={controller.onTotpConfirm}
        onFinished={controller.handleTotpSetupFinished}
        onCancel={() => controller.setIsTotpSetupOpen(false)}
      />
    )}
  </>
);

const PersonalAccessTokenCard: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <Shield aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('security.personalAccessToken.title')}
      </CardTitle>
      <CardDescription>{controller.t('security.personalAccessToken.description')}</CardDescription>
      <CardAction>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={controller.handleRenewPersonalAccessToken}
          disabled={controller.isLoadingToken || controller.isRenewingToken}
        >
          <RefreshCw
            aria-hidden="true"
            className={controller.isRenewingToken ? 'animate-spin' : undefined}
          />
          {controller.isRenewingToken
            ? controller.t('security.personalAccessToken.renewing')
            : controller.t('security.personalAccessToken.renew')}
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent className="space-y-4 p-6">
      {controller.tokenError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {controller.tokenError}
        </div>
      )}
      <PersonalAccessTokenField controller={controller} />
      <PersonalAccessTokenMetadata controller={controller} />
    </CardContent>
  </Card>
);

const PersonalAccessTokenField: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => (
  <Field>
    <FieldLabel htmlFor="security-pat-token">
      {controller.t('security.personalAccessToken.tokenLabel')}
    </FieldLabel>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        id="security-pat-token"
        value={
          controller.isLoadingToken
            ? controller.t('security.personalAccessToken.loading')
            : controller.tokenDisplayValue
        }
        readOnly
        className="font-mono text-sm"
      />
      <CopyButton
        variant="secondary"
        value={controller.personalAccessToken?.token ?? ''}
        disabled={!controller.personalAccessToken?.token}
        label={controller.t('security.personalAccessToken.copy')}
        copiedLabel={controller.t('security.personalAccessToken.copied')}
        onCopyError={() => controller.setTokenError(controller.t('security.copyFailed'))}
      />
    </div>
    <FieldDescription>
      {controller.personalAccessToken?.token
        ? controller.t('security.personalAccessToken.visibleOnce')
        : controller.t('security.personalAccessToken.masked')}
    </FieldDescription>
  </Field>
);

const PersonalAccessTokenMetadata: React.FC<{ controller: UserSettingsController }> = ({
  controller,
}) => {
  if (!controller.personalAccessToken) return null;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
      {(['createdAt', 'updatedAt', 'lastUsedAt'] as const).map((field) => (
        <div key={field}>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {controller.t(`security.personalAccessToken.${field}`)}
          </dt>
          <dd className="mt-1 text-foreground">
            {controller.formatPersonalAccessTokenDate(
              controller.personalAccessToken?.[field] ?? null,
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const McpSettingsPanel: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
    <div className="border-b border-border bg-muted/40 px-6 py-4">
      <div className="flex items-center gap-3">
        <McpIcon className="size-4 text-praetor" />
        <h3 className="font-semibold text-foreground">{controller.t('mcp.title')}</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{controller.t('mcp.description')}</p>
    </div>
    <div className="p-6 space-y-6">
      {controller.mcpError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
          <i className="fa-solid fa-circle-exclamation"></i>
          {controller.mcpError}
        </div>
      )}
      <McpEndpointField controller={controller} />
      <McpSetupPromptField controller={controller} />
      <McpTokenCreateForm controller={controller} />
      <McpRawTokenNotice controller={controller} />
      <McpTokenList controller={controller} />
    </div>
  </section>
);

const McpEndpointField: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Field>
    <FieldLabel htmlFor="mcp-endpoint-url">{controller.t('mcp.urlLabel')}</FieldLabel>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
      <Input id="mcp-endpoint-url" readOnly value={controller.mcpEndpointUrl} />
      <CopyButton
        variant="outline"
        value={controller.mcpEndpointUrl}
        label={controller.t('mcp.copyUrl')}
        copiedLabel={controller.t('mcp.copyUrlCopied')}
      />
    </div>
    <FieldDescription>{controller.t('mcp.urlDescription')}</FieldDescription>
  </Field>
);

const McpSetupPromptField: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Field>
    <FieldLabel htmlFor="mcp-setup-prompt">{controller.t('mcp.promptLabel')}</FieldLabel>
    <Textarea
      id="mcp-setup-prompt"
      readOnly
      value={controller.mcpSetupPrompt}
      className="min-h-44 resize-y font-mono text-xs"
    />
    <div className="flex justify-end">
      <CopyButton
        variant="outline"
        value={controller.mcpSetupPrompt}
        label={controller.t('mcp.copyPrompt')}
        copiedLabel={controller.t('mcp.copyPromptCopied')}
      />
    </div>
    <FieldDescription>{controller.t('mcp.promptDescription')}</FieldDescription>
  </Field>
);

const McpTokenCreateForm: React.FC<{ controller: UserSettingsController }> = ({ controller }) => {
  const [isScopeHelpOpen, setIsScopeHelpOpen] = useState(false);
  const scopeDescription =
    controller.mcpTokenScope === 'read_only'
      ? controller.t('mcp.scopeReadOnlyDescription')
      : controller.t('mcp.scopeFullDescription');

  return (
    <form
      onSubmit={controller.handleCreateMcpToken}
      className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_auto]"
    >
      <Field>
        <FieldLabel htmlFor="mcp-token-name" className="min-h-6" required>
          {controller.t('mcp.nameLabel')}
        </FieldLabel>
        <Input
          id="mcp-token-name"
          type="text"
          value={controller.mcpTokenName}
          onChange={(event) => controller.setMcpTokenName(event.target.value)}
          placeholder={controller.t('mcp.namePlaceholder')}
          maxLength={120}
        />
      </Field>
      <Field>
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor="mcp-token-scope">{controller.t('mcp.scopeLabel')}</FieldLabel>
          <Popover open={isScopeHelpOpen} onOpenChange={setIsScopeHelpOpen}>
            <Tooltip disabled={isScopeHelpOpen}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={scopeDescription}
                  >
                    <CircleHelp aria-hidden="true" className="size-3.5" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{scopeDescription}</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-72 p-3 text-sm">
              {scopeDescription}
            </PopoverContent>
          </Popover>
        </div>
        <Select
          value={controller.mcpTokenScope}
          onValueChange={(value) => controller.setMcpTokenScope(value as McpTokenScope)}
        >
          <SelectTrigger id="mcp-token-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">{controller.t('mcp.scopeFull')}</SelectItem>
            <SelectItem value="read_only">{controller.t('mcp.scopeReadOnly')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Button
        type="submit"
        disabled={controller.isCreatingMcpToken || !controller.mcpTokenName.trim()}
        className="self-end"
      >
        {controller.isCreatingMcpToken ? (
          <i className="fa-solid fa-circle-notch fa-spin"></i>
        ) : (
          <McpIcon className="size-4" />
        )}
        {controller.t('mcp.create')}
      </Button>
    </form>
  );
};

const McpRawTokenNotice: React.FC<{ controller: UserSettingsController }> = ({ controller }) => {
  if (!controller.rawMcpToken) return null;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {controller.t('mcp.rawTokenTitle')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {controller.t('mcp.rawTokenDescription')}
          </p>
        </div>
        <CopyButton
          variant="outline"
          size="sm"
          value={controller.rawMcpToken}
          label={controller.t('mcp.copy')}
          copiedLabel={controller.t('mcp.copied')}
          className="shrink-0"
        />
      </div>
      <code className="mt-3 block rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground break-all">
        {controller.rawMcpToken}
      </code>
    </div>
  );
};

const McpTokenList: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <div className="space-y-3">
    {controller.isLoadingMcpTokens ? (
      <div className="text-sm text-zinc-500 font-medium flex items-center gap-2">
        <i className="fa-solid fa-circle-notch fa-spin"></i>
        {controller.t('mcp.loading')}
      </div>
    ) : controller.mcpTokens.length === 0 ? (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        {controller.t('mcp.empty')}
      </div>
    ) : (
      controller.mcpTokens.map((token) => (
        <McpTokenRow key={token.id} controller={controller} token={token} />
      ))
    )}
  </div>
);

const McpTokenRow: React.FC<{ controller: UserSettingsController; token: McpToken }> = ({
  controller,
  token,
}) => {
  const isRevoking = controller.revokingMcpTokenId === token.id;
  return (
    <div className="flex flex-col justify-between gap-4 rounded-md border border-border p-4 md:flex-row md:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground">{token.name}</p>
          <span
            className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            data-scope={token.scope}
          >
            {token.scope === 'read_only'
              ? controller.t('mcp.scopeReadOnly')
              : controller.t('mcp.scopeFull')}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {token.tokenPrefix}... · {controller.t('mcp.created')}{' '}
          {formatMcpTokenDate(token.createdAt)} · {controller.t('mcp.lastUsed')}{' '}
          {formatMcpTokenDate(token.lastUsedAt)}
        </p>
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" size="sm" disabled={isRevoking}>
            <McpRevokeIcon isRevoking={isRevoking} />
            {controller.t('mcp.revoke')}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{controller.t('mcp.revokeDialogTitle')}</DialogTitle>
            <DialogDescription>
              {controller.t('mcp.revokeDialogDescription', { name: token.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isRevoking}>
                {controller.t('common:buttons.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void controller.handleRevokeMcpToken(token.id)}
              disabled={isRevoking}
            >
              <McpRevokeIcon isRevoking={isRevoking} />
              {controller.t('mcp.revokeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const RilSettingsPanel: React.FC<{ controller: UserSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg bg-background py-0">
    <CardHeader className="border-b bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <CalendarDays aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('ril.title')}
      </CardTitle>
      <CardDescription>{controller.t('ril.description')}</CardDescription>
    </CardHeader>
    <CardContent className="p-6">
      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {controller.rilWeekdayDefs.map(({ key, label }) => (
          <RilWeekdayTransferField key={key} controller={controller} dayKey={key} label={label} />
        ))}
      </fieldset>
      <FieldDescription className="mt-4">
        {controller.t('ril.weekdayDefaultsHint')}
      </FieldDescription>
    </CardContent>
  </Card>
);

const RilWeekdayTransferField: React.FC<{
  controller: UserSettingsController;
  dayKey: RilWeekday;
  label: string;
}> = ({ controller, dayKey, label }) => {
  const current = controller.rilWeekdayTransferDefaults[dayKey];
  const options =
    current && !controller.rilTransferOptions.includes(current)
      ? [current, ...controller.rilTransferOptions]
      : controller.rilTransferOptions;

  return (
    <Field>
      <FieldLabel htmlFor={`ril-transfer-${dayKey}`}>{label}</FieldLabel>
      <Select
        value={current ?? RIL_NONE_TRANSFER_VALUE}
        onValueChange={(value) => void controller.handleWeekdayTransferChange(dayKey, value)}
      >
        <SelectTrigger id={`ril-transfer-${dayKey}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={RIL_NONE_TRANSFER_VALUE}>{controller.t('ril.noDefault')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
};

export default UserSettings;
