
import React, { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import api from '../services/api';

export interface UserSettings {
  fullName: string;
  email: string;
  compactView: boolean;
  dailyGoal: number;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  enableAiInsights: boolean;
}

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>({
    fullName: '',
    email: '',
    compactView: false,
    dailyGoal: 8,
    startOfWeek: 'Monday',
    treatSaturdayAsHoliday: true,
    enableAiInsights: true
  });

  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'ai' | 'security'>('profile');
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
    if (e) e.preventDefault();
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
      <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-3xl text-indigo-600 mb-3"></i>
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
        {isSaved && (
          <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
            <i className="fa-solid fa-check"></i> Changes Saved
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-8">
        <button
          onClick={() => setActiveTab('profile')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'profile' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Profile
          {activeTab === 'profile' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"></div>}
        </button>
        <button
          onClick={() => setActiveTab('preferences')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'preferences' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Tracking Preferences
          {activeTab === 'preferences' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"></div>}
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'ai' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          AI Capabilities
          {activeTab === 'ai' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"></div>}
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'security' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Security
          {activeTab === 'security' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"></div>}
        </button>
      </div>

      <div className="space-y-8">
        {activeTab === 'profile' && (
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
        )}

        {activeTab === 'preferences' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
              <i className="fa-solid fa-clock text-indigo-500"></i>
              <h3 className="font-bold text-slate-800">Tracking Preferences</h3>
            </div>
            <div className="p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">My Daily Hour Goal</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      step="0.5"
                      value={settings.dailyGoal}
                      onChange={e => setSettings({ ...settings, dailyGoal: parseFloat(e.target.value) })}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-bold"
                    />
                    <span className="text-xs font-bold text-slate-400 uppercase whitespace-nowrap">hrs / day</span>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">Personal threshold for daily tracking progress.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Start of Week</label>
                  <CustomSelect
                    options={[
                      { id: 'Monday', name: 'Monday' },
                      { id: 'Sunday', name: 'Sunday' },
                    ]}
                    value={settings.startOfWeek}
                    onChange={(val) => setSettings({ ...settings, startOfWeek: val as 'Monday' | 'Sunday' })}
                  />
                  <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed">Preferred start day for your calendar view.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Treat Saturday as Holiday</p>
                    <p className="text-xs text-slate-500 italic">Overrides Saturday coloring in your calendar.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.treatSaturdayAsHoliday}
                      onChange={e => setSettings({ ...settings, treatSaturdayAsHoliday: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Compact Table View</p>
                    <p className="text-xs text-slate-500 italic">Reduce padding in the tracker activity table.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.compactView}
                      onChange={e => setSettings({ ...settings, compactView: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'ai' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
              <i className="fa-solid fa-wand-magic-sparkles text-indigo-500"></i>
              <h3 className="font-bold text-slate-800">AI Capabilities</h3>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <div className="max-w-md">
                  <p className="text-sm font-bold text-slate-800">Enable My AI Coach</p>
                  <p className="text-xs text-slate-500 italic leading-relaxed">Allow Gemini to analyze your logs and provide personalized productivity coaching.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enableAiInsights}
                    onChange={e => setSettings({ ...settings, enableAiInsights: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'security' && (
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
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={handlePasswordUpdate}
                disabled={isSavingPassword}
                className="px-6 py-2 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-all shadow-md shadow-slate-100 flex items-center gap-2 disabled:opacity-50 text-sm"
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
          </section>
        )}

        {activeTab !== 'security' && (
          <div className="flex justify-end gap-4 pt-4">
            <button
              onClick={handleSave}
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
                  <i className="fa-solid fa-check"></i> Save Changes
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
