import {
  Check,
  Contrast,
  Copy,
  type LucideIcon,
  Moon,
  RefreshCw,
  Shield,
  Sun,
  SunMoon,
  Trash2,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siModelcontextprotocol } from 'simple-icons';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import praetorFaviconUrl from '../praetor-favicon.png';
import type { CreatedMcpToken, McpToken, PersonalAccessToken, Settings } from '../services/api';
import { writeTextToClipboard } from '../utils/clipboard';
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
type ThemeSwatchVariant = 'default' | 'praetor';

const THEME_OPTION_META: Record<
  Theme,
  {
    activeClassName: string;
    inactiveClassName: string;
    swatchClassName: string;
    Icon?: LucideIcon;
    swatchVariant: ThemeSwatchVariant;
  }
> = {
  light: {
    activeClassName: 'border-praetor bg-zinc-50',
    inactiveClassName: 'border-zinc-100 hover:border-zinc-200',
    swatchClassName:
      'bg-white border border-zinc-200 shadow-sm flex items-center justify-center text-praetor',
    Icon: Sun,
    swatchVariant: 'default',
  },
  dark: {
    activeClassName: 'border-secondary bg-secondary',
    inactiveClassName: 'border-zinc-100 hover:border-secondary',
    swatchClassName: 'bg-zinc-900 shadow-sm flex items-center justify-center text-white',
    Icon: Moon,
    swatchVariant: 'default',
  },
  zebra: {
    activeClassName: 'border-praetor bg-zinc-50',
    inactiveClassName: 'border-zinc-100 hover:border-zinc-200',
    swatchClassName:
      'bg-white border border-zinc-200 shadow-sm flex items-center justify-center text-praetor',
    Icon: Contrast,
    swatchVariant: 'default',
  },
  praetor: {
    activeClassName: 'border-praetor bg-zinc-50',
    inactiveClassName: 'border-zinc-100 hover:border-zinc-200',
    swatchClassName: 'bg-white border border-zinc-200 shadow-sm flex items-center justify-center',
    swatchVariant: 'praetor',
  },
  auto: {
    activeClassName: 'border-praetor bg-zinc-50',
    inactiveClassName: 'border-zinc-100 hover:border-zinc-200',
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

  const [fullName, setFullName] = useState(() => settings.fullName);
  const [email, setEmail] = useState(() => settings.email);
  const [language, setLanguage] = useState<LanguagePreference>(() => settings.language || 'auto');
  // settings can arrive after mount (useAuth populates async). Sync from settings while the
  // field is still untouched, so the form reflects the loaded values without clobbering
  // in-progress edits once the user starts typing.
  const fullNameTouched = useRef(false);
  const emailTouched = useRef(false);
  const languageTouched = useRef(false);
  useEffect(() => {
    if (!fullNameTouched.current) setFullName(settings.fullName);
  }, [settings.fullName]);
  useEffect(() => {
    if (!emailTouched.current) setEmail(settings.email);
  }, [settings.email]);
  useEffect(() => {
    if (!languageTouched.current) setLanguage(settings.language || 'auto');
  }, [settings.language]);
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

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
  const [tokenCopied, setTokenCopied] = useState(false);
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

  const onGetPersonalAccessTokenRef = useRef(onGetPersonalAccessToken);
  useEffect(() => {
    onGetPersonalAccessTokenRef.current = onGetPersonalAccessToken;
  }, [onGetPersonalAccessToken]);

  useEffect(() => {
    if (activeTab !== 'security' || personalAccessToken || tokenLoadInFlightRef.current) return;

    const loadToken = async () => {
      tokenLoadInFlightRef.current = true;
      setIsLoadingToken(true);
      setTokenError('');
      try {
        const tokenMetadata = await onGetPersonalAccessTokenRef.current();
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
  }, [activeTab, personalAccessToken]);
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
    languageTouched.current = true;
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

  const copyRawMcpToken = async () => {
    if (!rawMcpToken) return;
    await writeTextToClipboard(rawMcpToken);
  };

  const copyMcpEndpointUrl = async () => {
    await writeTextToClipboard(mcpEndpointUrl);
  };

  const copyMcpSetupPrompt = async () => {
    await writeTextToClipboard(mcpSetupPrompt);
  };

  const handleRenewPersonalAccessToken = async () => {
    setIsRenewingToken(true);
    setTokenError('');
    setTokenCopied(false);
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

  const handleCopyPersonalAccessToken = async () => {
    if (!personalAccessToken?.token) return;
    const copied = await writeTextToClipboard(personalAccessToken.token);
    if (!copied) {
      setTokenError(t('security.copyFailed'));
      return;
    }
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 3000);
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
        <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-user text-praetor"></i>
            <h3 className="font-semibold text-zinc-800">{t('userProfile.title')}</h3>
          </div>
          <form onSubmit={handleSave}>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('userProfile.fullName')}
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => {
                      fullNameTouched.current = true;
                      setFullName(e.target.value);
                    }}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('userProfile.email')}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      emailTouched.current = true;
                      setEmail(e.target.value);
                    }}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 flex justify-end">
              <button
                type="submit"
                disabled={isSaving || !hasChanges}
                className={`px-8 py-3 rounded-xl font-bold text-sm transition-all duration-300 ease-in-out active:scale-95 flex items-center gap-2 ${
                  isSaved
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                    : isSaving || !hasChanges
                      ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200'
                      : 'bg-praetor text-white shadow-lg shadow-zinc-200 hover:bg-zinc-700'
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
                    : t('general.saveChanges')}
              </button>
            </div>
          </form>
        </section>
      )}

      {activeTab === 'appearance' && (
        <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-palette text-praetor"></i>
            <h3 className="font-semibold text-zinc-800">{t('appearance.title')}</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {THEMES.map((theme) => {
                const isSelected = currentTheme === theme;
                const option = THEME_OPTION_META[theme];

                return (
                  <button
                    key={theme}
                    onClick={() => handleThemeChange(theme)}
                    className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${
                      isSelected ? option.activeClassName : option.inactiveClassName
                    }`}
                  >
                    <div className="relative size-10 shrink-0">
                      <div
                        className={`size-10 overflow-hidden rounded-full ${option.swatchClassName}`}
                      >
                        {renderThemeSwatchContent(option)}
                      </div>
                      {isSelected && (
                        <span className="absolute -top-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full border-2 border-background bg-secondary text-secondary-foreground shadow-sm">
                          <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-semibold text-zinc-800 mb-1">
                        {t(`appearance.${theme}.name`)}
                      </h4>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        {t(`appearance.${theme}.description`)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'language' && (
        <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-language text-praetor"></i>
            <h3 className="font-semibold text-zinc-800">{t('language.title')}</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button
                onClick={() => handleLanguageChange('auto')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${language === 'auto' ? 'border-praetor bg-zinc-50' : 'border-zinc-100 hover:border-zinc-200'}`}
              >
                <div className="size-10 rounded-full bg-zinc-100 shrink-0 shadow-sm flex items-center justify-center overflow-hidden relative">
                  <i
                    className={`fa-solid fa-globe text-xl ${language === 'auto' ? 'text-praetor' : 'text-zinc-400'}`}
                  ></i>
                  {language === 'auto' && (
                    <div className="absolute -top-1 -right-1 size-4 bg-praetor rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <i className="fa-solid fa-check text-white text-[8px]"></i>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-800 mb-1">{t('language.auto')}</h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">{t('language.autoDesc')}</p>
                </div>
              </button>

              <button
                onClick={() => handleLanguageChange('en')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${language === 'en' ? 'border-praetor bg-zinc-50' : 'border-zinc-100 hover:border-zinc-200'}`}
              >
                <div className="size-10 rounded-full bg-zinc-100 shrink-0 shadow-sm flex items-center justify-center overflow-hidden relative">
                  <span
                    className={`fi fi-gb text-xl ${language === 'en' ? 'scale-110' : 'grayscale opacity-70'}`}
                  ></span>
                  {language === 'en' && (
                    <div className="absolute -top-1 -right-1 size-4 bg-praetor rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <i className="fa-solid fa-check text-white text-[8px]"></i>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-800 mb-1">{t('language.english')}</h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {t('language.englishDesc')}
                  </p>
                </div>
              </button>

              <button
                onClick={() => handleLanguageChange('it')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${language === 'it' ? 'border-praetor bg-zinc-50' : 'border-zinc-100 hover:border-zinc-200'}`}
              >
                <div className="size-10 rounded-full bg-zinc-100 shrink-0 shadow-sm flex items-center justify-center overflow-hidden relative">
                  <span
                    className={`fi fi-it text-xl ${language === 'it' ? 'scale-110' : 'grayscale opacity-70'}`}
                  ></span>
                  {language === 'it' && (
                    <div className="absolute -top-1 -right-1 size-4 bg-praetor rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <i className="fa-solid fa-check text-white text-[8px]"></i>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-800 mb-1">{t('language.italian')}</h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {t('language.italianDesc')}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'security' && (
        <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-lock text-praetor"></i>
            <h3 className="font-semibold text-zinc-800">{t('security.title')}</h3>
          </div>
          <form onSubmit={handlePasswordUpdate}>
            <div className="p-6">
              {passwordError && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                  <i className="fa-solid fa-circle-exclamation"></i>
                  {passwordError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('password.currentPassword')}
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <div className="hidden md:block"></div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('password.newPassword')}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('password.confirmNewPassword')}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 flex justify-end">
              <button
                type="submit"
                disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
                className={`px-8 py-3 rounded-xl font-bold text-sm transition-all duration-300 ease-in-out active:scale-95 flex items-center gap-2 ${
                  passwordSuccess
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                    : isSavingPassword || !currentPassword || !newPassword || !confirmPassword
                      ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200'
                      : 'bg-praetor text-white shadow-lg shadow-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {isSavingPassword ? (
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                ) : passwordSuccess ? (
                  <i className="fa-solid fa-check"></i>
                ) : (
                  <i className="fa-solid fa-key"></i>
                )}
                {isSavingPassword
                  ? t('password.updating')
                  : passwordSuccess
                    ? t('password.passwordUpdated')
                    : t('password.updatePassword')}
              </button>
            </div>
          </form>
          <div className="border-t border-zinc-200 p-6">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-praetor">
                  <Shield aria-hidden="true" className="size-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-800">
                    {t('security.personalAccessToken.title')}
                  </h4>
                  <p className="mt-1 max-w-2xl text-sm text-zinc-500">
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
                  className={`size-4 ${isRenewingToken ? 'animate-spin' : ''}`}
                />
                {isRenewingToken
                  ? t('security.personalAccessToken.renewing')
                  : t('security.personalAccessToken.renew')}
              </Button>
            </div>

            {tokenError && (
              <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                {tokenError}
              </div>
            )}

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-400">
                  {t('security.personalAccessToken.tokenLabel')}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={
                      isLoadingToken ? t('security.personalAccessToken.loading') : tokenDisplayValue
                    }
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCopyPersonalAccessToken}
                    disabled={!personalAccessToken?.token}
                  >
                    <Copy aria-hidden="true" className="size-4" />
                    {tokenCopied
                      ? t('security.personalAccessToken.copied')
                      : t('security.personalAccessToken.copy')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {personalAccessToken?.token
                    ? t('security.personalAccessToken.visibleOnce')
                    : t('security.personalAccessToken.masked')}
                </p>
              </div>

              {personalAccessToken && (
                <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      {t('security.personalAccessToken.createdAt')}
                    </dt>
                    <dd className="mt-1 text-zinc-700">
                      {formatPersonalAccessTokenDate(personalAccessToken.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      {t('security.personalAccessToken.updatedAt')}
                    </dt>
                    <dd className="mt-1 text-zinc-700">
                      {formatPersonalAccessTokenDate(personalAccessToken.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      {t('security.personalAccessToken.lastUsedAt')}
                    </dt>
                    <dd className="mt-1 text-zinc-700">
                      {formatPersonalAccessTokenDate(personalAccessToken.lastUsedAt)}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'mcp' && (
        <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-6 py-4">
            <McpIcon className="size-4 text-praetor" />
            <h3 className="font-semibold text-foreground">{t('mcp.title')}</h3>
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
                <Button type="button" variant="outline" onClick={copyMcpEndpointUrl}>
                  <Copy aria-hidden="true" className="size-4" />
                  {t('mcp.copyUrl')}
                </Button>
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
                <Button type="button" variant="outline" onClick={copyMcpSetupPrompt}>
                  <Copy aria-hidden="true" className="size-4" />
                  {t('mcp.copyPrompt')}
                </Button>
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
                  <Button
                    type="button"
                    onClick={copyRawMcpToken}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    <Copy aria-hidden="true" className="size-3.5" />
                    {t('mcp.copy')}
                  </Button>
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
                        <p className="font-semibold text-foreground">{token.name}</p>
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
