import { REGEXP_ONLY_DIGITS } from 'input-otp';
import {
  AlertCircle,
  Check,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api/client';
import praetorFaviconUrl from '../praetor-favicon.png';
import type {
  CreatedMcpToken,
  McpToken,
  McpTokenScope,
  PersonalAccessToken,
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
  onUpdate: (updates: Partial<Settings>) => void;
  onUpdatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onTotpSetup: () => Promise<{
    secret: string;
    otpauthUri: string;
    qrDataUri: string;
    backupCodes: string[];
  }>;
  onTotpConfirm: (code: string) => Promise<void>;
  onTotpDisable: (payload: { password?: string; code?: string }) => Promise<void>;
  onRegenerateTotpBackupCodes: (code: string) => Promise<{ backupCodes: string[] }>;
  onGetTotpStatus: () => Promise<{ enabled: boolean; applicable: boolean }>;
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

const renderThemeSwatchContent = (option: (typeof THEME_OPTION_META)[Theme]) => {
  if (option.swatchVariant === 'praetor') {
    return <img src={praetorFaviconUrl} alt="" className="size-12 max-w-none object-cover" />;
  }

  const Icon = option.Icon;
  return Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={2.25} /> : null;
};

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

const UserSettings: React.FC<UserSettingsProps> = ({
  settings,
  authMethod = 'local',
  authProviderName = null,
  isLoading = false,
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
}) => {
  const { t } = useTranslation(['settings', 'common']);
  const translateRef = useRef(t);
  const isLocalAuth = authMethod === 'local';
  const identityProviderLabel = isLocalAuth
    ? ''
    : authProviderName || t(`settings:identityProviders.${authMethod}`);

  // Initialize the editable fields from `settings` once at mount. We deliberately
  // do not re-sync on later `settings` prop changes: the parent re-creates the
  // settings object on unrelated re-renders, and re-syncing would clobber the
  // user's in-progress edits. When the form should be reset (e.g. after a logout
  // or user switch), the parent unmounts/remounts this component.
  const [fullName, setFullName] = useState(settings.fullName);
  const [email, setEmail] = useState(settings.email);
  const [language, setLanguage] = useState(settings.language || 'auto');
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme());

  const [activeTab, setActiveTab] = useState<
    'profile' | 'appearance' | 'language' | 'security' | 'mcp'
  >('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [mcpTokens, setMcpTokens] = useState<McpToken[]>([]);
  const [mcpTokenName, setMcpTokenName] = useState('');
  const [mcpTokenScope, setMcpTokenScope] = useState<McpTokenScope>('full');
  const [rawMcpToken, setRawMcpToken] = useState('');
  const [mcpError, setMcpError] = useState('');
  const [isLoadingMcpTokens, setIsLoadingMcpTokens] = useState(false);
  const [isCreatingMcpToken, setIsCreatingMcpToken] = useState(false);
  const [revokingMcpTokenId, setRevokingMcpTokenId] = useState<string | null>(null);
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

  const [personalAccessToken, setPersonalAccessToken] = useState<PersonalAccessToken | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [isRenewingToken, setIsRenewingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const tokenLoadInFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  // Two-factor authentication state. Status is loaded lazily when the Security
  // tab opens (mirroring the PAT loader below).
  const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; applicable: boolean } | null>(
    null,
  );
  const [isLoadingTotpStatus, setIsLoadingTotpStatus] = useState(false);
  const [totpStatusError, setTotpStatusError] = useState('');
  const totpStatusInFlightRef = useRef(false);
  const [isTotpSetupOpen, setIsTotpSetupOpen] = useState(false);

  // Disable flow (re-auth dialog collecting password and/or a current code).
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [isDisablingTotp, setIsDisablingTotp] = useState(false);
  const [disableError, setDisableError] = useState('');

  // Regenerate-backup-codes flow (collect a current code, then show new codes).
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState('');
  const [isRegeneratingCodes, setIsRegeneratingCodes] = useState(false);
  const [regenerateError, setRegenerateError] = useState('');
  const [regeneratedBackupCodes, setRegeneratedBackupCodes] = useState<string[] | null>(null);

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
  }, [activeTab, onGetPersonalAccessToken, personalAccessToken]);

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
  }, [onGetTotpStatus]);

  // Lazily load the 2FA status the first time the Security tab is opened.
  useEffect(() => {
    if (activeTab !== 'security' || totpStatus || totpStatusInFlightRef.current) return;
    void loadTotpStatus();
  }, [activeTab, totpStatus, loadTotpStatus]);

  const handleTotpSetupFinished = useCallback(() => {
    setIsTotpSetupOpen(false);
    setTotpStatus((prev) => (prev ? { ...prev, enabled: true } : prev));
    void loadTotpStatus();
  }, [loadTotpStatus]);

  const handleDisableTotp = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (isDisablingTotp) return;
      setIsDisablingTotp(true);
      setDisableError('');
      const payload: { password?: string; code?: string } = {};
      const trimmedPassword = disablePassword.trim();
      const trimmedCode = disableCode.trim();
      if (trimmedPassword) payload.password = trimmedPassword;
      if (trimmedCode) payload.code = trimmedCode;
      try {
        await onTotpDisable(payload);
        if (!isMountedRef.current) return;
        setIsDisableDialogOpen(false);
        setDisablePassword('');
        setDisableCode('');
        setTotpStatus((prev) => (prev ? { ...prev, enabled: false } : prev));
        void loadTotpStatus();
      } catch (err: unknown) {
        console.error('Failed to disable two-factor authentication:', err);
        if (!isMountedRef.current) return;
        const isInvalidCode = err instanceof ApiError && err.errorCode === 'invalid_totp_code';
        setDisableError(
          isInvalidCode
            ? t('twoFactor.invalidCode')
            : (err as Error).message || t('common:messages.errorOccurred'),
        );
      } finally {
        if (isMountedRef.current) setIsDisablingTotp(false);
      }
    },
    [disableCode, disablePassword, isDisablingTotp, loadTotpStatus, onTotpDisable, t],
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
    [isRegeneratingCodes, onRegenerateTotpBackupCodes, regenerateCode, t],
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
  }, [onListMcpTokens]);

  useEffect(() => {
    if (activeTab === 'mcp') void loadMcpTokens();
  }, [activeTab, loadMcpTokens]);

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

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-praetor text-3xl mb-3"></i>
          <p className="text-zinc-500 font-medium">{t('common:states.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-800">{t('title')}</h2>
          <p className="text-sm text-zinc-500 mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 gap-8">
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'profile' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <i className="fa-solid fa-user mr-2"></i>
          {t('userProfile.title')}
          {activeTab === 'profile' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('appearance')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'appearance' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <i className="fa-solid fa-palette mr-2"></i>
          {t('appearance.title')}
          {activeTab === 'appearance' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('language')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'language' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <i className="fa-solid fa-language mr-2"></i>
          {t('language.title')}
          {activeTab === 'language' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'security' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <i className="fa-solid fa-lock mr-2"></i>
          {t('security.title')}
          {activeTab === 'security' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mcp')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'mcp' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <McpIcon className="inline size-4 mr-2 align-[-2px]" />
          {t('mcp.title')}
          {activeTab === 'mcp' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
      </div>

      {activeTab === 'profile' && (
        <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0 animate-in fade-in slide-in-from-left-4 duration-300">
          <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
            <CardTitle className="flex items-center gap-3 text-base">
              <User aria-hidden="true" className="size-4 text-praetor" />
              {t('userProfile.title')}
            </CardTitle>
            <CardDescription>{t('userProfile.description')}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSave}>
            <CardContent className="space-y-6 p-6">
              {!isLocalAuth && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-4 text-sm font-medium text-muted-foreground"
                >
                  <Lock aria-hidden="true" className="size-4" />
                  {t('userProfile.lockedBanner', { provider: identityProviderLabel })}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Field>
                  <FieldLabel htmlFor="profile-full-name">{t('userProfile.fullName')}</FieldLabel>
                  <Input
                    id="profile-full-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={!isLocalAuth}
                    readOnly={!isLocalAuth}
                    aria-readonly={!isLocalAuth}
                    required={isLocalAuth}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-email">{t('userProfile.email')}</FieldLabel>
                  <Input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!isLocalAuth}
                    readOnly={!isLocalAuth}
                    aria-readonly={!isLocalAuth}
                    required={isLocalAuth}
                  />
                </Field>
              </div>
            </CardContent>
            {isLocalAuth && (
              <CardFooter className="justify-end border-t border-border px-6 py-4 [.border-t]:pt-4">
                {(() => {
                  const { Icon, iconClass, label } = isSaving
                    ? { Icon: Loader2, iconClass: 'animate-spin', label: t('general.saving') }
                    : isSaved
                      ? { Icon: Check, iconClass: undefined, label: t('general.changesSaved') }
                      : { Icon: Save, iconClass: undefined, label: t('general.saveChanges') };
                  return (
                    <Button type="submit" disabled={isSaving || !hasChanges}>
                      <Icon aria-hidden="true" className={iconClass} />
                      {label}
                    </Button>
                  );
                })()}
              </CardFooter>
            )}
          </form>
        </Card>
      )}

      {activeTab === 'appearance' && (
        <Card className="gap-0 overflow-hidden rounded-lg bg-background py-0">
          <CardHeader className="border-b bg-muted/40 px-6 py-4 [.border-b]:pb-4">
            <CardTitle className="flex items-center gap-3 text-base">
              <Palette aria-hidden="true" className="size-4 text-praetor" />
              {t('appearance.title')}
            </CardTitle>
            <CardDescription>{t('appearance.description')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {THEMES.map((theme) => {
                const isSelected = currentTheme === theme;
                const option = THEME_OPTION_META[theme];

                return (
                  <Card
                    key={theme}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => handleThemeChange(theme)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleThemeChange(theme);
                      }
                    }}
                    className={cn(
                      'flex-row items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected && 'border-primary ring-2 ring-primary/40',
                    )}
                  >
                    <div className="relative shrink-0">
                      <div
                        className={cn(
                          'size-10 overflow-hidden rounded-full',
                          option.swatchClassName,
                        )}
                      >
                        {renderThemeSwatchContent(option)}
                      </div>
                      {isSelected && (
                        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                          <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-foreground">
                        {t(`appearance.${theme}.name`)}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t(`appearance.${theme}.description`)}
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'language' && (
        <Card className="gap-0 overflow-hidden rounded-lg bg-background py-0">
          <CardHeader className="border-b bg-muted/40 px-6 py-4 [.border-b]:pb-4">
            <CardTitle className="flex items-center gap-3 text-base">
              <Languages aria-hidden="true" className="size-4 text-praetor" />
              {t('language.title')}
            </CardTitle>
            <CardDescription>{t('language.description')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {LANGUAGE_OPTIONS.map((option) => {
                const active = language === option.value;
                return (
                  <Card
                    key={option.value}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => handleLanguageChange(option.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleLanguageChange(option.value);
                      }
                    }}
                    className={cn(
                      'flex-row items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active && 'border-primary ring-2 ring-primary/40',
                    )}
                  >
                    <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {option.icon}
                      {active && (
                        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                          <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-foreground">{t(option.titleKey)}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t(option.descriptionKey)}
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'security' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Lock aria-hidden="true" className="size-4 text-praetor" />
                {t('password.title')}
              </CardTitle>
              <CardDescription>{t('password.description')}</CardDescription>
            </CardHeader>
            {isLocalAuth ? (
              <form onSubmit={handlePasswordUpdate}>
                <CardContent className="space-y-6 p-6">
                  {passwordError && (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive animate-in fade-in slide-in-from-top-2">
                      <AlertCircle aria-hidden="true" className="size-4" />
                      {passwordError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Field>
                      <FieldLabel htmlFor="security-current-password">
                        {t('password.currentPassword')}
                      </FieldLabel>
                      <Input
                        id="security-current-password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                      />
                    </Field>
                    <Field className="md:col-start-1">
                      <FieldLabel htmlFor="security-new-password">
                        {t('password.newPassword')}
                      </FieldLabel>
                      <Input
                        id="security-new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="security-confirm-password">
                        {t('password.confirmNewPassword')}
                      </FieldLabel>
                      <Input
                        id="security-confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                      />
                    </Field>
                  </div>
                </CardContent>
                <CardFooter className="justify-end border-t border-border px-6 py-4 [.border-t]:pt-4">
                  {(() => {
                    const { Icon, iconClass, label } = isSavingPassword
                      ? { Icon: Loader2, iconClass: 'animate-spin', label: t('password.updating') }
                      : passwordSuccess
                        ? {
                            Icon: Check,
                            iconClass: undefined,
                            label: t('password.passwordUpdated'),
                          }
                        : {
                            Icon: KeyRound,
                            iconClass: undefined,
                            label: t('password.updatePassword'),
                          };
                    return (
                      <Button
                        type="submit"
                        disabled={
                          isSavingPassword || !currentPassword || !newPassword || !confirmPassword
                        }
                      >
                        <Icon aria-hidden="true" className={iconClass} />
                        {label}
                      </Button>
                    );
                  })()}
                </CardFooter>
              </form>
            ) : (
              <CardContent className="p-6">
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-4 text-sm font-medium text-muted-foreground"
                >
                  <Lock aria-hidden="true" className="size-4" />
                  {t('password.lockedBanner', { provider: identityProviderLabel })}
                </div>
              </CardContent>
            )}
          </Card>

          {(() => {
            const isIdpManagedTotp =
              authMethod === 'oidc' || authMethod === 'saml' || totpStatus?.applicable === false;
            const isTotpEnabled = totpStatus?.enabled === true;

            return (
              <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
                <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
                  <CardTitle className="flex items-center gap-3 text-base">
                    <ShieldCheck aria-hidden="true" className="size-4 text-praetor" />
                    {t('twoFactor.title')}
                  </CardTitle>
                  <CardDescription>{t('twoFactor.description')}</CardDescription>
                  {totpStatus && !isIdpManagedTotp && (
                    <CardAction>
                      <Badge variant={isTotpEnabled ? 'default' : 'secondary'}>
                        {isTotpEnabled
                          ? t('twoFactor.statusEnabled')
                          : t('twoFactor.statusDisabled')}
                      </Badge>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="space-y-4 p-6">
                  {isIdpManagedTotp ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
                    >
                      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {t('twoFactor.idpManagedTitle')}
                        </p>
                        <p>{t('twoFactor.idpManagedDescription')}</p>
                      </div>
                    </div>
                  ) : isLoadingTotpStatus && !totpStatus ? (
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      {t('common:states.loading')}
                    </div>
                  ) : totpStatusError ? (
                    <div className="space-y-3">
                      <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                        {totpStatusError}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void loadTotpStatus()}
                        disabled={isLoadingTotpStatus}
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={isLoadingTotpStatus ? 'animate-spin' : undefined}
                        />
                        {t('common:buttons.retry', { defaultValue: 'Retry' })}
                      </Button>
                    </div>
                  ) : isTotpEnabled ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      {/* Disable: re-auth dialog collecting password and/or a current code. */}
                      <Dialog
                        open={isDisableDialogOpen}
                        onOpenChange={(open) => {
                          setIsDisableDialogOpen(open);
                          if (!open) {
                            setDisablePassword('');
                            setDisableCode('');
                            setDisableError('');
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button type="button" variant="destructive">
                            <Lock aria-hidden="true" />
                            {t('twoFactor.disable')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <form onSubmit={handleDisableTotp}>
                            <DialogHeader>
                              <DialogTitle>{t('twoFactor.disableTitle')}</DialogTitle>
                              <DialogDescription>
                                {t('twoFactor.disableDescription')}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              {disableError && (
                                <Alert variant="destructive">
                                  <AlertCircle aria-hidden="true" />
                                  <AlertTitle>{disableError}</AlertTitle>
                                </Alert>
                              )}
                              {isLocalAuth && (
                                <Field>
                                  <FieldLabel htmlFor="totp-disable-password">
                                    {t('twoFactor.disablePasswordLabel')}
                                  </FieldLabel>
                                  <Input
                                    id="totp-disable-password"
                                    type="password"
                                    value={disablePassword}
                                    onChange={(e) => {
                                      setDisablePassword(e.target.value);
                                      if (disableError) setDisableError('');
                                    }}
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                  />
                                </Field>
                              )}
                              <Field>
                                <FieldLabel htmlFor="totp-disable-code">
                                  {t('twoFactor.disableCodeLabel')}
                                </FieldLabel>
                                <Input
                                  id="totp-disable-code"
                                  inputMode="numeric"
                                  autoComplete="one-time-code"
                                  value={disableCode}
                                  onChange={(e) => {
                                    setDisableCode(
                                      e.target.value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH),
                                    );
                                    if (disableError) setDisableError('');
                                  }}
                                  placeholder="123456"
                                  className="font-mono tracking-[0.3em]"
                                />
                              </Field>
                            </div>
                            <DialogFooter>
                              <DialogClose asChild>
                                <Button type="button" variant="outline" disabled={isDisablingTotp}>
                                  {t('twoFactor.cancel')}
                                </Button>
                              </DialogClose>
                              <Button
                                type="submit"
                                variant="destructive"
                                disabled={
                                  isDisablingTotp ||
                                  (!disablePassword.trim() &&
                                    disableCode.length !== TOTP_CODE_LENGTH)
                                }
                              >
                                {isDisablingTotp ? (
                                  <>
                                    <Loader2 aria-hidden="true" className="animate-spin" />
                                    {t('twoFactor.verifying')}
                                  </>
                                ) : (
                                  t('twoFactor.confirmDisable')
                                )}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>

                      {/* Regenerate backup codes: collect a current code, then display new codes. */}
                      <Dialog
                        open={isRegenerateDialogOpen}
                        onOpenChange={(open) => {
                          setIsRegenerateDialogOpen(open);
                          if (!open) {
                            setRegenerateCode('');
                            setRegenerateError('');
                            setRegeneratedBackupCodes(null);
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button type="button" variant="outline">
                            <RefreshCw aria-hidden="true" />
                            {t('twoFactor.regenerateBackupCodes')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          {regeneratedBackupCodes ? (
                            <>
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
                                  {t('twoFactor.backupTitle')}
                                </DialogTitle>
                                <DialogDescription>
                                  {t('twoFactor.backupInstructions')}
                                </DialogDescription>
                              </DialogHeader>
                              <ul className="my-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-4">
                                {regeneratedBackupCodes.map((backupCode) => (
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
                                  value={regeneratedBackupCodes.join('\n')}
                                  label={t('twoFactor.copyCodes')}
                                  copiedLabel={t('twoFactor.copyCodes')}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => downloadBackupCodes(regeneratedBackupCodes)}
                                >
                                  {t('twoFactor.downloadCodes')}
                                </Button>
                                <DialogClose asChild>
                                  <Button type="button">{t('twoFactor.done')}</Button>
                                </DialogClose>
                              </DialogFooter>
                            </>
                          ) : (
                            <form onSubmit={handleRegenerateBackupCodes}>
                              <DialogHeader>
                                <DialogTitle>{t('twoFactor.regenerateBackupCodes')}</DialogTitle>
                                <DialogDescription>
                                  {t('twoFactor.enterCodeLabel')}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="flex flex-col items-center gap-4 py-4">
                                <InputOTP
                                  maxLength={TOTP_CODE_LENGTH}
                                  value={regenerateCode}
                                  onChange={(value) => {
                                    setRegenerateCode(value);
                                    if (regenerateError) setRegenerateError('');
                                  }}
                                  pattern={REGEXP_ONLY_DIGITS}
                                  disabled={isRegeneratingCodes}
                                  aria-invalid={regenerateError ? true : undefined}
                                  aria-label={t('twoFactor.enterCodeLabel')}
                                  containerClassName="justify-center"
                                >
                                  <InputOTPGroup>
                                    {Array.from({ length: TOTP_CODE_LENGTH }, (_, index) => (
                                      <InputOTPSlot
                                        key={index}
                                        index={index}
                                        aria-invalid={regenerateError ? true : undefined}
                                      />
                                    ))}
                                  </InputOTPGroup>
                                </InputOTP>
                                {regenerateError && (
                                  <Alert variant="destructive">
                                    <AlertCircle aria-hidden="true" />
                                    <AlertTitle>{regenerateError}</AlertTitle>
                                  </Alert>
                                )}
                              </div>
                              <DialogFooter>
                                <DialogClose asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isRegeneratingCodes}
                                  >
                                    {t('twoFactor.cancel')}
                                  </Button>
                                </DialogClose>
                                <Button
                                  type="submit"
                                  disabled={
                                    isRegeneratingCodes ||
                                    regenerateCode.length !== TOTP_CODE_LENGTH
                                  }
                                >
                                  {isRegeneratingCodes ? (
                                    <>
                                      <Loader2 aria-hidden="true" className="animate-spin" />
                                      {t('twoFactor.verifying')}
                                    </>
                                  ) : (
                                    t('twoFactor.regenerate')
                                  )}
                                </Button>
                              </DialogFooter>
                            </form>
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        {t('twoFactor.scanInstructions')}
                      </p>
                      <Dialog
                        open={isTotpSetupOpen}
                        onOpenChange={(open) => {
                          // Block dismissal while the setup dialog is mid-flow only via the
                          // wizard's own controls; closing here just resets local UI state.
                          setIsTotpSetupOpen(open);
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button type="button">
                            <ShieldCheck aria-hidden="true" />
                            {t('twoFactor.setUp')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader className="sr-only">
                            <DialogTitle>{t('twoFactor.setupTitle')}</DialogTitle>
                            <DialogDescription>{t('twoFactor.scanInstructions')}</DialogDescription>
                          </DialogHeader>
                          {isTotpSetupOpen && (
                            <TotpSetupWizard
                              onSetup={onTotpSetup}
                              onConfirm={onTotpConfirm}
                              onFinished={handleTotpSetupFinished}
                              onCancel={() => setIsTotpSetupOpen(false)}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <Shield aria-hidden="true" className="size-4 text-praetor" />
                {t('security.personalAccessToken.title')}
              </CardTitle>
              <CardDescription>{t('security.personalAccessToken.description')}</CardDescription>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRenewPersonalAccessToken}
                  disabled={isLoadingToken || isRenewingToken}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={isRenewingToken ? 'animate-spin' : undefined}
                  />
                  {isRenewingToken
                    ? t('security.personalAccessToken.renewing')
                    : t('security.personalAccessToken.renew')}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              {tokenError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                  {tokenError}
                </div>
              )}

              <Field>
                <FieldLabel htmlFor="security-pat-token">
                  {t('security.personalAccessToken.tokenLabel')}
                </FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="security-pat-token"
                    value={
                      isLoadingToken ? t('security.personalAccessToken.loading') : tokenDisplayValue
                    }
                    readOnly
                    className="font-mono text-sm"
                  />
                  <CopyButton
                    variant="secondary"
                    value={personalAccessToken?.token ?? ''}
                    disabled={!personalAccessToken?.token}
                    label={t('security.personalAccessToken.copy')}
                    copiedLabel={t('security.personalAccessToken.copied')}
                    onCopyError={() => setTokenError(t('security.copyFailed'))}
                  />
                </div>
                <FieldDescription>
                  {personalAccessToken?.token
                    ? t('security.personalAccessToken.visibleOnce')
                    : t('security.personalAccessToken.masked')}
                </FieldDescription>
              </Field>

              {personalAccessToken && (
                <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                  {(['createdAt', 'updatedAt', 'lastUsedAt'] as const).map((field) => (
                    <div key={field}>
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t(`security.personalAccessToken.${field}`)}
                      </dt>
                      <dd className="mt-1 text-foreground">
                        {formatPersonalAccessTokenDate(personalAccessToken[field])}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'mcp' && (
        <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="border-b border-border bg-muted/40 px-6 py-4">
            <div className="flex items-center gap-3">
              <McpIcon className="size-4 text-praetor" />
              <h3 className="font-semibold text-foreground">{t('mcp.title')}</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t('mcp.description')}</p>
          </div>
          <div className="p-6 space-y-6">
            {mcpError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
                <i className="fa-solid fa-circle-exclamation"></i>
                {mcpError}
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="mcp-endpoint-url">{t('mcp.urlLabel')}</FieldLabel>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <Input id="mcp-endpoint-url" readOnly value={mcpEndpointUrl} />
                <CopyButton
                  variant="outline"
                  value={mcpEndpointUrl}
                  label={t('mcp.copyUrl')}
                  copiedLabel={t('mcp.copyUrlCopied')}
                />
              </div>
              <FieldDescription>{t('mcp.urlDescription')}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="mcp-setup-prompt">{t('mcp.promptLabel')}</FieldLabel>
              <Textarea
                id="mcp-setup-prompt"
                readOnly
                value={mcpSetupPrompt}
                className="min-h-44 resize-y font-mono text-xs"
              />
              <div className="flex justify-end">
                <CopyButton
                  variant="outline"
                  value={mcpSetupPrompt}
                  label={t('mcp.copyPrompt')}
                  copiedLabel={t('mcp.copyPromptCopied')}
                />
              </div>
              <FieldDescription>{t('mcp.promptDescription')}</FieldDescription>
            </Field>

            <form
              onSubmit={handleCreateMcpToken}
              className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_minmax(10rem,auto)_auto]"
            >
              <Field>
                <FieldLabel htmlFor="mcp-token-name">{t('mcp.nameLabel')}</FieldLabel>
                <Input
                  id="mcp-token-name"
                  type="text"
                  value={mcpTokenName}
                  onChange={(e) => setMcpTokenName(e.target.value)}
                  placeholder={t('mcp.namePlaceholder')}
                  maxLength={120}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-token-scope">{t('mcp.scopeLabel')}</FieldLabel>
                <Select
                  value={mcpTokenScope}
                  onValueChange={(value) => setMcpTokenScope(value as McpTokenScope)}
                >
                  <SelectTrigger id="mcp-token-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">{t('mcp.scopeFull')}</SelectItem>
                    <SelectItem value="read_only">{t('mcp.scopeReadOnly')}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {mcpTokenScope === 'read_only'
                    ? t('mcp.scopeReadOnlyDescription')
                    : t('mcp.scopeFullDescription')}
                </FieldDescription>
              </Field>
              <Button
                type="submit"
                disabled={isCreatingMcpToken || !mcpTokenName.trim()}
                className="self-end"
              >
                {isCreatingMcpToken ? (
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                ) : (
                  <McpIcon className="size-4" />
                )}
                {t('mcp.create')}
              </Button>
            </form>

            {rawMcpToken && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {t('mcp.rawTokenTitle')}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('mcp.rawTokenDescription')}
                    </p>
                  </div>
                  <CopyButton
                    variant="outline"
                    size="sm"
                    value={rawMcpToken}
                    label={t('mcp.copy')}
                    copiedLabel={t('mcp.copied')}
                    className="shrink-0"
                  />
                </div>
                <code className="mt-3 block rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground break-all">
                  {rawMcpToken}
                </code>
              </div>
            )}

            <div className="space-y-3">
              {isLoadingMcpTokens ? (
                <div className="text-sm text-zinc-500 font-medium flex items-center gap-2">
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  {t('mcp.loading')}
                </div>
              ) : mcpTokens.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                  {t('mcp.empty')}
                </div>
              ) : (
                mcpTokens.map((token) => {
                  const isRevoking = revokingMcpTokenId === token.id;
                  const renderRevokeIcon = () =>
                    isRevoking ? (
                      <i className="fa-solid fa-circle-notch fa-spin"></i>
                    ) : (
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    );

                  return (
                    <div
                      key={token.id}
                      className="flex flex-col justify-between gap-4 rounded-md border border-border p-4 md:flex-row md:items-center"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-foreground">{token.name}</p>
                          <span
                            className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                            data-scope={token.scope}
                          >
                            {token.scope === 'read_only'
                              ? t('mcp.scopeReadOnly')
                              : t('mcp.scopeFull')}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {token.tokenPrefix}... · {t('mcp.created')}{' '}
                          {formatMcpTokenDate(token.createdAt)} · {t('mcp.lastUsed')}{' '}
                          {formatMcpTokenDate(token.lastUsedAt)}
                        </p>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={isRevoking}
                          >
                            {renderRevokeIcon()}
                            {t('mcp.revoke')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('mcp.revokeDialogTitle')}</DialogTitle>
                            <DialogDescription>
                              {t('mcp.revokeDialogDescription', { name: token.name })}
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button type="button" variant="outline" disabled={isRevoking}>
                                {t('common:buttons.cancel')}
                              </Button>
                            </DialogClose>
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => void handleRevokeMcpToken(token.id)}
                              disabled={isRevoking}
                            >
                              {renderRevokeIcon()}
                              {t('mcp.revokeConfirm')}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default UserSettings;
