
import React, { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import api from '../services/api';

export interface UserSettings {
  fullName: string;
  email: string;
  compactView: boolean;
}

const WEEK_OPTIONS = [
  { id: 'Monday', name: 'Monday' },
  { id: 'Sunday', name: 'Sunday' },
];

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>({
    fullName: '',
    email: '',
    compactView: false
  });

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

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await api.settings.get();
        setSettings(data);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.settings.update(settings);
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
      <div className="max-w-3xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-3xl text-indigo-600 mb-3"></i>
          <p className="text-slate-500 font-medium">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {isSaved && (
        <div className="fixed top-24 right-8 bg-emerald-500 text-white px-6 py-3 rounded-xl shadow-lg z-50 animate-in fade-in slide-in-from-right-4">
          <div className="flex items-center gap-2 font-bold text-sm">
            <i className="fa-solid fa-circle-check"></i>
            Settings saved successfully!
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-user text-indigo-500"></i>
            <h3 className="font-bold text-slate-800">User Profile</h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Full Name</label>
              <input
                type="text"
                value={settings.fullName}
                onChange={e => setSettings({ ...settings, fullName: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
              <input
                type="email"
                value={settings.email}
                onChange={e => setSettings({ ...settings, email: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
              />
            </div>
          </div>
        </section>


        <div className="flex justify-end gap-4">
          <button
            type="submit"
            disabled={isSaving}
            className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                Saving...
              </>
            ) : (
              <>
                <i className="fa-solid fa-floppy-disk"></i> Save Settings
              </>
            )}
          </button>
        </div>
      </form>

      <div className="h-px bg-slate-200 my-8" />

      <form onSubmit={handlePasswordUpdate} className="space-y-8 pb-12">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-lock text-indigo-500"></i>
            <h3 className="font-bold text-slate-800">Password Settings</h3>
          </div>
          <div className="p-6 space-y-6">
            {passwordError && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <i className="fa-solid fa-circle-exclamation"></i>
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <i className="fa-solid fa-circle-check"></i>
                Password updated successfully!
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
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
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-4">
          <button
            type="submit"
            disabled={isSavingPassword}
            className="px-8 py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-all shadow-md shadow-slate-100 flex items-center gap-2 disabled:opacity-50"
          >
            {isSavingPassword ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                Updating...
              </>
            ) : (
              <>
                <i className="fa-solid fa-key"></i> Update Password
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Settings;
