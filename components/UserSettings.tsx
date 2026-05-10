import {
  Check,
  Contrast,
  Copy,
  KeyRound,
  type LucideIcon,
  Moon,
  Sun,
  SunMoon,
  Trash2,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import praetorFaviconUrl from '../praetor-favicon.png';
import type { CreatedMcpToken, McpToken, Settings } from '../services/api';
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

const formatTokenDate = (value: number | null) => {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const UserSettings: React.FC<UserSettingsProps> = ({
  settings,
  isLoading = false,
  onUpdate,
  onUpdatePassword,
  onListMcpTokens,
  onCreateMcpToken,
  onRevokeMcpToken,
}) => {
  const { t } = useTranslation(['settings', 'common']);
  const tRef = useRef(t);

  const [fullName, setFullName] = useState(settings.fullName);
  const [email, setEmail] = useState(settings.email);
  const [language, setLanguage] = useState(settings.language || 'auto');
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

  const [activeTab, setActiveTab] = useState<
    'profile' | 'appearance' | 'language' | 'password' | 'mcp'
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

  useEffect(() => {
    setFullName(settings.fullName);
    setEmail(settings.email);
    setLanguage(settings.language || 'auto');
  }, [settings]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

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
      setMcpError(tRef.current('mcp.loadFailed'));
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
    await navigator.clipboard.writeText(rawMcpToken);
  };

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
          onClick={() => setActiveTab('password')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'password' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <i className="fa-solid fa-lock mr-2"></i>
          {t('password.title')}
          {activeTab === 'password' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('mcp')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'mcp' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          <KeyRound aria-hidden="true" className="inline size-4 mr-2 align-[-2px]" />
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
                    onChange={(e) => setFullName(e.target.value)}
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
                    onChange={(e) => setEmail(e.target.value)}
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

      {activeTab === 'password' && (
        <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-lock text-praetor"></i>
            <h3 className="font-semibold text-zinc-800">{t('password.title')}</h3>
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
        </section>
      )}

      {activeTab === 'mcp' && (
        <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3 rounded-t-2xl">
            <KeyRound aria-hidden="true" className="size-4 text-praetor" />
            <h3 className="font-semibold text-zinc-800">{t('mcp.title')}</h3>
          </div>
          <div className="p-6 space-y-6">
            {mcpError && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation"></i>
                {mcpError}
              </div>
            )}

            <form
              onSubmit={handleCreateMcpToken}
              className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"
            >
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  {t('mcp.nameLabel')}
                </label>
                <input
                  type="text"
                  value={mcpTokenName}
                  onChange={(e) => setMcpTokenName(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                  placeholder={t('mcp.namePlaceholder')}
                  maxLength={120}
                />
              </div>
              <button
                type="submit"
                disabled={isCreatingMcpToken || !mcpTokenName.trim()}
                className={`self-end px-6 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 ${
                  isCreatingMcpToken || !mcpTokenName.trim()
                    ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200'
                    : 'bg-praetor text-white shadow-lg shadow-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {isCreatingMcpToken ? (
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                ) : (
                  <KeyRound aria-hidden="true" className="size-4" />
                )}
                {t('mcp.create')}
              </button>
            </form>

            {rawMcpToken && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-amber-900">{t('mcp.rawTokenTitle')}</p>
                    <p className="text-xs text-amber-800 mt-1">{t('mcp.rawTokenDescription')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={copyRawMcpToken}
                    className="shrink-0 px-3 py-2 rounded-lg border border-amber-300 bg-white text-amber-900 text-xs font-bold flex items-center gap-2 hover:bg-amber-100"
                  >
                    <Copy aria-hidden="true" className="size-3.5" />
                    {t('mcp.copy')}
                  </button>
                </div>
                <code className="mt-3 block rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs text-zinc-800 break-all">
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
                <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
                  {t('mcp.empty')}
                </div>
              ) : (
                mcpTokens.map((token) => (
                  <div
                    key={token.id}
                    className="rounded-xl border border-zinc-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div>
                      <p className="font-semibold text-zinc-800">{token.name}</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {token.tokenPrefix}... · {t('mcp.created')}{' '}
                        {formatTokenDate(token.createdAt)} · {t('mcp.lastUsed')}{' '}
                        {formatTokenDate(token.lastUsedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRevokeMcpToken(token.id)}
                      disabled={revokingMcpTokenId === token.id}
                      className="px-3 py-2 rounded-lg border border-red-100 bg-red-50 text-red-600 text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-100 disabled:opacity-60"
                    >
                      {revokingMcpTokenId === token.id ? (
                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                      ) : (
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      )}
                      {t('mcp.revoke')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default UserSettings;
