import {
  AlertCircle,
  Check,
  Contrast,
  Globe,
  Key,
  Languages,
  Loader2,
  Lock,
  type LucideIcon,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Shield,
  Sun,
  SunMoon,
  Trash2,
  User,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siModelcontextprotocol } from 'simple-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import praetorFaviconUrl from '../praetor-favicon.png';
import type { CreatedMcpToken, McpToken, PersonalAccessToken, Settings } from '../services/api';
import { applyLanguagePreference } from '../utils/language';
import { applyTheme, getTheme, THEMES, type Theme } from '../utils/theme';

export interface UserSettingsProps {
  settings: Settings;
  isLoading?: boolean;
  onUpdate: (updates: Partial<Settings>) => void;
  onUpdatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onListMcpTokens: () => Promise<McpToken[]>;
  onCreateMcpToken: (name: string) => Promise<CreatedMcpToken>;
  onRevokeMcpToken: (id: string) => Promise<unknown>;
  onGetPersonalAccessToken: () => Promise<PersonalAccessToken>;
  onRenewPersonalAccessToken: () => Promise<PersonalAccessToken>;
}

type LanguagePreference = NonNullable<Settings['language']>;
type SettingsTab = 'profile' | 'appearance' | 'language' | 'security' | 'mcp';

const PICKER_BUTTON_BASE =
  'relative flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all';
const PICKER_BUTTON_INACTIVE = 'border-input hover:border-border';
const PICKER_BUTTON_ACTIVE = 'border-primary bg-accent';

const SWATCH_CONTAINER =
  'flex size-10 items-center justify-center overflow-hidden rounded-full shadow-sm';

const themeIconSwatch = (Icon: LucideIcon, containerClass: string) => (
  <div className={cn(SWATCH_CONTAINER, containerClass)}>
    <Icon aria-hidden="true" className="size-4" strokeWidth={2.25} />
  </div>
);

const languageSwatch = (inner: React.ReactNode) => (
  <div className={cn(SWATCH_CONTAINER, 'bg-muted')}>{inner}</div>
);

const THEME_SWATCH: Record<Theme, React.ReactNode> = {
  light: themeIconSwatch(Sun, 'border border-border bg-background text-primary'),
  dark: themeIconSwatch(Moon, 'bg-zinc-900 text-white'),
  zebra: themeIconSwatch(Contrast, 'border border-border bg-background text-primary'),
  praetor: (
    <div className={cn(SWATCH_CONTAINER, 'border border-border bg-background')}>
      <img src={praetorFaviconUrl} alt="" className="size-12 max-w-none object-cover" />
    </div>
  ),
  auto: themeIconSwatch(SunMoon, 'border border-border bg-background text-primary'),
};

const formatMcpTokenDate = (value: number | null) => {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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

const PickerSelectedBadge = () => (
  <span className="absolute -top-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm">
    <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
  </span>
);

const PickerCard = ({
  isSelected,
  onClick,
  swatch,
  title,
  description,
}: {
  isSelected: boolean;
  onClick: () => void;
  swatch: React.ReactNode;
  title: string;
  description: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(PICKER_BUTTON_BASE, isSelected ? PICKER_BUTTON_ACTIVE : PICKER_BUTTON_INACTIVE)}
  >
    <div className="relative shrink-0">
      {swatch}
      {isSelected && <PickerSelectedBadge />}
    </div>
    <div>
      <h4 className="mb-1 font-semibold text-foreground">{title}</h4>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  </button>
);

const SettingsSectionHeader = ({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) => (
  <CardHeader className="flex flex-row items-center gap-3">
    <span aria-hidden="true" className="text-primary">
      <Icon className="size-4" />
    </span>
    <CardTitle>{title}</CardTitle>
  </CardHeader>
);

const ErrorBanner = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
    <AlertCircle aria-hidden="true" className="size-4" />
    {children}
  </div>
);

const LANGUAGES: ReadonlyArray<{
  code: LanguagePreference;
  renderSwatch: (isActive: boolean) => React.ReactNode;
  labelKey: string;
  descKey: string;
}> = [
  {
    code: 'auto',
    renderSwatch: (isActive) =>
      languageSwatch(
        <Globe
          aria-hidden="true"
          className={cn('size-5', isActive ? 'text-primary' : 'text-muted-foreground')}
        />,
      ),
    labelKey: 'language.auto',
    descKey: 'language.autoDesc',
  },
  {
    code: 'en',
    renderSwatch: (isActive) =>
      languageSwatch(
        <span
          aria-hidden="true"
          className={cn('fi fi-gb text-xl', isActive ? 'scale-110' : 'opacity-70 grayscale')}
        />,
      ),
    labelKey: 'language.english',
    descKey: 'language.englishDesc',
  },
  {
    code: 'it',
    renderSwatch: (isActive) =>
      languageSwatch(
        <span
          aria-hidden="true"
          className={cn('fi fi-it text-xl', isActive ? 'scale-110' : 'opacity-70 grayscale')}
        />,
      ),
    labelKey: 'language.italian',
    descKey: 'language.italianDesc',
  },
];

const PAT_DATE_FIELDS: ReadonlyArray<{
  labelKey: string;
  field: keyof Pick<PersonalAccessToken, 'createdAt' | 'updatedAt' | 'lastUsedAt'>;
}> = [
  { labelKey: 'security.personalAccessToken.createdAt', field: 'createdAt' },
  { labelKey: 'security.personalAccessToken.updatedAt', field: 'updatedAt' },
  { labelKey: 'security.personalAccessToken.lastUsedAt', field: 'lastUsedAt' },
];

const TABS: ReadonlyArray<{
  id: SettingsTab;
  icon: React.ReactNode;
  labelKey: string;
}> = [
  {
    id: 'profile',
    icon: <User aria-hidden="true" className="size-4" />,
    labelKey: 'userProfile.title',
  },
  {
    id: 'appearance',
    icon: <Palette aria-hidden="true" className="size-4" />,
    labelKey: 'appearance.title',
  },
  {
    id: 'language',
    icon: <Languages aria-hidden="true" className="size-4" />,
    labelKey: 'language.title',
  },
  {
    id: 'security',
    icon: <Lock aria-hidden="true" className="size-4" />,
    labelKey: 'security.title',
  },
  { id: 'mcp', icon: <McpIcon className="size-4" />, labelKey: 'mcp.title' },
];

const UserSettings: React.FC<UserSettingsProps> = ({
  settings,
  isLoading = false,
  onUpdate,
  onUpdatePassword,
  onListMcpTokens,
  onCreateMcpToken,
  onRevokeMcpToken,
  onGetPersonalAccessToken,
  onRenewPersonalAccessToken,
}) => {
  const { t } = useTranslation(['settings', 'common']);
  const translateRef = useRef(t);

  // Initialize the editable fields from `settings` once at mount. We deliberately
  // do not re-sync on later `settings` prop changes: the parent re-creates the
  // settings object on unrelated re-renders, and re-syncing would clobber the
  // user's in-progress edits. When the form should be reset (e.g. after a logout
  // or user switch), the parent unmounts/remounts this component.
  const [fullName, setFullName] = useState(settings.fullName);
  const [email, setEmail] = useState(settings.email);
  const [language, setLanguage] = useState(settings.language || 'auto');
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
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

  const handleThemeChange = (theme: Theme) => {
    if (theme === currentTheme) return;
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
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
    applyLanguagePreference(lang);
    setLanguage(lang);
    try {
      await onUpdate({ fullName, email, language: lang });
    } catch (err) {
      console.error('Failed to update language:', err);
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
      const created = await onCreateMcpToken(name);
      setMcpTokens((prev) => [created.token, ...prev]);
      setRawMcpToken(created.rawToken);
      setMcpTokenName('');
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
      <div className="mx-auto flex max-w-4xl items-center justify-center py-20">
        <div className="text-center">
          <Loader2
            aria-hidden="true"
            className="mx-auto mb-3 size-8 animate-spin text-muted-foreground"
          />
          <p className="font-medium text-muted-foreground">{t('common:states.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div
        role="tablist"
        aria-orientation="horizontal"
        className="inline-flex h-9 w-fit items-center justify-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 py-1 text-sm font-medium transition-all focus-visible:outline-1 focus-visible:outline-ring',
                isActive
                  ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30'
                  : 'text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground',
              )}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      {activeTab === 'profile' && (
        <Card>
          <SettingsSectionHeader icon={User} title={t('userProfile.title')} />
          <form className="contents" onSubmit={handleSave}>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="profile-fullName">{t('userProfile.fullName')}</FieldLabel>
                  <Input
                    id="profile-fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-email">{t('userProfile.email')}</FieldLabel>
                  <Input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" disabled={isSaving || !hasChanges}>
                {isSaving ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : isSaved ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Save aria-hidden="true" className="size-4" />
                )}
                {isSaving
                  ? t('general.saving')
                  : isSaved
                    ? t('general.changesSaved')
                    : t('general.saveChanges')}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {activeTab === 'appearance' && (
        <Card>
          <SettingsSectionHeader icon={Palette} title={t('appearance.title')} />
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {THEMES.map((theme) => (
                <PickerCard
                  key={theme}
                  isSelected={currentTheme === theme}
                  onClick={() => handleThemeChange(theme)}
                  swatch={THEME_SWATCH[theme]}
                  title={t(`appearance.${theme}.name`)}
                  description={t(`appearance.${theme}.description`)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'language' && (
        <Card>
          <SettingsSectionHeader icon={Languages} title={t('language.title')} />
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {LANGUAGES.map((lang) => {
                const isSelected = language === lang.code;
                return (
                  <PickerCard
                    key={lang.code}
                    isSelected={isSelected}
                    onClick={() => handleLanguageChange(lang.code)}
                    swatch={lang.renderSwatch(isSelected)}
                    title={t(lang.labelKey)}
                    description={t(lang.descKey)}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'security' && (
        <Card>
          <SettingsSectionHeader icon={Lock} title={t('security.title')} />
          <form className="contents" onSubmit={handlePasswordUpdate}>
            <CardContent className="space-y-6">
              {passwordError && <ErrorBanner>{passwordError}</ErrorBanner>}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="current-password">
                    {t('password.currentPassword')}
                  </FieldLabel>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </Field>
                <div className="hidden md:block" aria-hidden="true" />
                <Field>
                  <FieldLabel htmlFor="new-password">{t('password.newPassword')}</FieldLabel>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-password">
                    {t('password.confirmNewPassword')}
                  </FieldLabel>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </Field>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button
                type="submit"
                disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
              >
                {isSavingPassword ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : passwordSuccess ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Key aria-hidden="true" className="size-4" />
                )}
                {isSavingPassword
                  ? t('password.updating')
                  : passwordSuccess
                    ? t('password.passwordUpdated')
                    : t('password.updatePassword')}
              </Button>
            </CardFooter>
          </form>
          <Separator />
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <Shield aria-hidden="true" className="size-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">
                    {t('security.personalAccessToken.title')}
                  </h4>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {t('security.personalAccessToken.description')}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRenewPersonalAccessToken}
                disabled={isLoadingToken || isRenewingToken}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn('size-4', isRenewingToken && 'animate-spin')}
                />
                {isRenewingToken
                  ? t('security.personalAccessToken.renewing')
                  : t('security.personalAccessToken.renew')}
              </Button>
            </div>

            {tokenError && <ErrorBanner>{tokenError}</ErrorBanner>}

            <div className="space-y-4 rounded-md border border-border bg-background p-4">
              <Field>
                <FieldLabel htmlFor="personal-access-token">
                  {t('security.personalAccessToken.tokenLabel')}
                </FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="personal-access-token"
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
                  {PAT_DATE_FIELDS.map(({ labelKey, field }) => (
                    <div key={field}>
                      <dt className="text-xs font-medium text-muted-foreground">{t(labelKey)}</dt>
                      <dd className="mt-1 text-foreground">
                        {formatPersonalAccessTokenDate(personalAccessToken[field])}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'mcp' && (
        <Card>
          <SettingsSectionHeader icon={McpIcon} title={t('mcp.title')} />
          <CardContent className="space-y-6">
            {mcpError && <ErrorBanner>{mcpError}</ErrorBanner>}

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
              className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]"
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
              <Button
                type="submit"
                disabled={isCreatingMcpToken || !mcpTokenName.trim()}
                className="self-end"
              >
                {isCreatingMcpToken ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
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
                <code className="mt-3 block break-all rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground">
                  {rawMcpToken}
                </code>
              </div>
            )}

            <div className="space-y-3">
              {isLoadingMcpTokens ? (
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
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
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    );

                  return (
                    <div
                      key={token.id}
                      className="flex flex-col justify-between gap-4 rounded-md border border-border p-4 md:flex-row md:items-center"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{token.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default UserSettings;
