
import React, { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';

export interface UserSettings {
  fullName: string;
  email: string;
  dailyGoal: number;
  startOfWeek: 'Monday' | 'Sunday';
  enableAiInsights: boolean;
  compactView: boolean;
  treatSaturdayAsHoliday: boolean;
}

const WEEK_OPTIONS = [
  { id: 'Monday', name: 'Monday' },
  { id: 'Sunday', name: 'Sunday' },
];

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('tempo_settings');
    return saved ? JSON.parse(saved) : {
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      dailyGoal: 8,
      startOfWeek: 'Monday',
      enableAiInsights: true,
      compactView: false,
      treatSaturdayAsHoliday: true
    };
  });

  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    localStorage.setItem('tempo_settings', JSON.stringify(settings));
  }, [settings]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
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
                onChange={e => setSettings({...settings, fullName: e.target.value})}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
              <input 
                type="email" 
                value={settings.email}
                onChange={e => setSettings({...settings, email: e.target.value})}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold"
              />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-clock text-indigo-500"></i>
            <h3 className="font-bold text-slate-800">Tracking Preferences</h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">Daily Hour Goal</p>
                <p className="text-xs text-slate-500 italic">Target hours to track per day</p>
              </div>
              <div className="flex items-center gap-3">
                <input 
                  type="number" 
                  step="0.5"
                  value={settings.dailyGoal}
                  onChange={e => setSettings({...settings, dailyGoal: parseFloat(e.target.value)})}
                  className="w-20 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-center font-bold text-sm"
                />
                <span className="text-xs font-bold text-slate-400 uppercase">hrs</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">Start of Week</p>
                <p className="text-xs text-slate-500 italic">Preferred start day for calendar and reports</p>
              </div>
              <CustomSelect 
                className="w-48"
                options={WEEK_OPTIONS}
                value={settings.startOfWeek}
                onChange={val => setSettings({...settings, startOfWeek: val as 'Monday' | 'Sunday'})}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">Treat Saturday as Holiday</p>
                <p className="text-xs text-slate-500 italic">Disable Saturday selection in the calendar</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.treatSaturdayAsHoliday} 
                  onChange={e => setSettings({...settings, treatSaturdayAsHoliday: e.target.checked})}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <i className="fa-solid fa-wand-magic-sparkles text-indigo-500"></i>
            <h3 className="font-bold text-slate-800">AI Capabilities</h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="max-w-md">
                <p className="text-sm font-bold text-slate-800">Enable AI Coach</p>
                <p className="text-xs text-slate-500 italic leading-relaxed">Gemini will analyze your logs to provide personalized productivity insights and coaching.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.enableAiInsights} 
                  onChange={e => setSettings({...settings, enableAiInsights: e.target.checked})}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-4">
          <button 
            type="submit"
            className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center gap-2"
          >
            <i className="fa-solid fa-floppy-disk"></i> Save Settings
          </button>
        </div>
      </form>
    </div>
  );
};

export default Settings;
