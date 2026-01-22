
import React, { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import api from '../services/api';
import { getTheme, applyTheme, Theme } from '../utils/theme';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

export interface UserSettings {
  fullName: string;
  email: string;
  language?: 'en' | 'it';
}

const Settings: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);

  const [settings, setSettings] = useState<UserSettings>({
    fullName: '',
    email: '',
    language: 'en',
  });
  const [initialSettings, setInitialSettings] = useState<UserSettings | null>(null);

  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Theme state
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

  const handleThemeChange = (theme: Theme) => {
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await api.settings.get();
        const profile = {
          fullName: data.fullName,
          email: data.email,
          language: data.language || 'en'
        };
        setSettings(profile);
        setInitialSettings(profile);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      const payload = { fullName: settings.fullName, email: settings.email, language: settings.language };
      await api.settings.update(payload);
      setInitialSettings(payload);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLanguageChange = async (language: 'en' | 'it') => {
    i18n.changeLanguage(language);
    localStorage.setItem('i18nextLng', language);
    setSettings({ ...settings, language });
    try {
      const payload = { fullName: settings.fullName, email: settings.email, language };
      await api.settings.update(payload);
      setInitialSettings(payload);
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
      await api.settings.updatePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err: any) {
      console.error('Failed to update password:', err);
      setPasswordError(err.message || 'Failed to update password');
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-praetor text-3xl mb-3"></i>
          <p className="text-slate-500 font-medium">{t('common:states.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{t('title')}</h2>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
      </div>

      <div className="space-y-8">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-user text-praetor"></i>
            <h3 className="font-bold text-slate-800">{t('userProfile.title')}</h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('userProfile.fullName')}</label>
                <input
                  type="text"
                  value={settings.fullName}
                  onChange={e => setSettings({ ...settings, fullName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('userProfile.email')}</label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={e => setSettings({ ...settings, email: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                />
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <button
                onClick={handleSave}
                disabled={isSaving || (JSON.stringify(settings) === JSON.stringify(initialSettings))}
                className={`px-8 py-3 text-white font-bold rounded-xl transition-all duration-300 ease-in-out shadow-md flex items-center gap-2 disabled:opacity-50 ${isSaved ? 'bg-emerald-500 shadow-emerald-100 hover:bg-emerald-600' : (JSON.stringify(settings) === JSON.stringify(initialSettings)) ? 'bg-slate-300 shadow-none cursor-not-allowed' : 'bg-praetor shadow-slate-200 hover:bg-slate-800'}`}
              >
                {isSaving ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                    {t('general.saving')}
                  </>
                ) : isSaved ? (
                  <>
                    <i className="fa-solid fa-check"></i> {t('general.changesSaved')}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-save"></i> {t('general.saveChanges')}
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-palette text-praetor"></i>
            <h3 className="font-bold text-slate-800">{t('appearance.title')}</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                onClick={() => handleThemeChange('default')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${currentTheme === 'default' ? 'border-praetor bg-slate-50' : 'border-slate-100 hover:border-slate-200'}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#20293F] shrink-0 shadow-sm flex items-center justify-center text-white">
                  {currentTheme === 'default' && <i className="fa-solid fa-check text-xs"></i>}
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 mb-1">{t('appearance.default.name')}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {t('appearance.default.description')}
                  </p>
                </div>
              </button>

              <button
                onClick={() => handleThemeChange('tempo')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${currentTheme === 'tempo' ? 'border-indigo-600 bg-indigo-50/10' : 'border-slate-100 hover:border-indigo-100'}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#4F46E5] shrink-0 shadow-sm flex items-center justify-center text-white">
                  {currentTheme === 'tempo' && <i className="fa-solid fa-check text-xs"></i>}
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 mb-1">{t('appearance.tempo.name')}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {t('appearance.tempo.description')}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-language text-praetor"></i>
            <h3 className="font-bold text-slate-800">{t('language.title')}</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                onClick={() => handleLanguageChange('en')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${settings.language === 'en' ? 'border-praetor bg-slate-50' : 'border-slate-100 hover:border-slate-200'}`}
              >
                <div className="w-10 h-10 rounded-full bg-slate-100 shrink-0 shadow-sm flex items-center justify-center overflow-hidden relative">
                  <span className={`fi fi-gb text-xl ${settings.language === 'en' ? 'scale-110' : 'grayscale opacity-70'}`}></span>
                  {settings.language === 'en' && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-praetor rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <i className="fa-solid fa-check text-white text-[8px]"></i>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 mb-1">{t('language.english')}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {t('language.englishDesc')}
                  </p>
                </div>
              </button>

              <button
                onClick={() => handleLanguageChange('it')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left flex items-start gap-4 group ${settings.language === 'it' ? 'border-praetor bg-slate-50' : 'border-slate-100 hover:border-slate-200'}`}
              >
                <div className="w-10 h-10 rounded-full bg-slate-100 shrink-0 shadow-sm flex items-center justify-center overflow-hidden relative">
                  <span className={`fi fi-it text-xl ${settings.language === 'it' ? 'scale-110' : 'grayscale opacity-70'}`}></span>
                  {settings.language === 'it' && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-praetor rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <i className="fa-solid fa-check text-white text-[8px]"></i>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 mb-1">{t('language.italian')}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {t('language.italianDesc')}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-lock text-praetor"></i>
            <h3 className="font-bold text-slate-800">{t('password.title')}</h3>
          </div>
          <div className="p-6">
            {passwordError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <i className="fa-solid fa-circle-exclamation"></i>
                {passwordError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('password.currentPassword')}</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div className="hidden md:block"></div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('password.newPassword')}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('password.confirmNewPassword')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end pt-8">
              <button
                onClick={handlePasswordUpdate}
                disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
                className={`px-8 py-3 text-white font-bold rounded-xl transition-all duration-300 ease-in-out shadow-md flex items-center gap-2 disabled:opacity-50 ${passwordSuccess ? 'bg-emerald-500 shadow-emerald-100 hover:bg-emerald-600' : (!currentPassword || !newPassword || !confirmPassword) ? 'bg-slate-300 shadow-none cursor-not-allowed' : 'bg-praetor shadow-slate-200 hover:bg-slate-800'}`}
              >
                {isSavingPassword ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                    {t('password.updating')}
                  </>
                ) : passwordSuccess ? (
                  <>
                    <i className="fa-solid fa-check"></i> {t('password.passwordUpdated')}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-key"></i> {t('password.updatePassword')}
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};

export default Settings;
