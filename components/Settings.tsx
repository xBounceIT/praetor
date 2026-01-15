
import React, { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import api from '../services/api';
import { getTheme, applyTheme, Theme } from '../utils/theme';

export interface UserSettings {
  fullName: string;
  email: string;
}

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>({
    fullName: '',
    email: '',
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
        setSettings(data);
        setInitialSettings(data);
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
      await api.settings.update(settings);
      setInitialSettings(settings);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
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
          <p className="text-slate-500 font-medium">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">User Settings</h2>
          <p className="text-sm text-slate-500 mt-1">Manage your individual profile and tracking preferences</p>
        </div>
      </div>


      <div className="space-y-8">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-user text-praetor"></i>
            <h3 className="font-bold text-slate-800">User Profile</h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Full Name</label>
                <input
                  type="text"
                  value={settings.fullName}
                  onChange={e => setSettings({ ...settings, fullName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none transition-all text-sm font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
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
                    Saving...
                  </>
                ) : isSaved ? (
                  <>
                    <i className="fa-solid fa-check"></i> Changes Saved
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-save"></i> Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-palette text-praetor"></i>
            <h3 className="font-bold text-slate-800">Appearance</h3>
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
                  <h4 className="font-bold text-slate-800 mb-1">Default</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    The classic Praetor experience with slate blue branding. Professional and distinct.
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
                  <h4 className="font-bold text-slate-800 mb-1">Tempo</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    A vibrant indigo theme. Modern, energetic, and clean.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-lock text-praetor"></i>
            <h3 className="font-bold text-slate-800">Password Settings</h3>
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
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Current Password</label>
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
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">New Password</label>
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
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Confirm New Password</label>
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
                    Updating...
                  </>
                ) : passwordSuccess ? (
                  <>
                    <i className="fa-solid fa-check"></i> Password Updated
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-key"></i> Update Password
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
