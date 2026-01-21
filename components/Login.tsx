
import React, { useState } from 'react';
import { User } from '../types';
import api from '../services/api';
import { useTranslation } from 'react-i18next';

interface LoginProps {
  users: User[];
  onLogin: (user: User, token?: string) => void;
  logoutReason?: 'inactivity' | null;
  onClearLogoutReason?: () => void;
}

const Login: React.FC<LoginProps> = ({ onLogin, logoutReason, onClearLogoutReason }) => {
  const { t } = useTranslation(['auth', 'common', 'notifications']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setError('');

    const newErrors: Record<string, string> = {};
    if (!username.trim()) newErrors.username = t('validation.usernameRequired');
    if (!password.trim()) newErrors.password = t('validation.passwordRequired');

    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.auth.login(username, password);
      onLogin(response.user, response.token);
    } catch (err) {
      setError((err as Error).message || t('auth:login.errors.invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-praetor flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/praetor-logo.png" alt="Praetor Logo" className="h-56 mx-auto object-contain" />
          <p className="text-slate-500 text-sm">{t('auth:login.subtitle')}</p>
        </div>

        {logoutReason === 'inactivity' && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <i className="fa-solid fa-clock text-amber-500 mt-0.5"></i>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800">{t('auth:session.expired')}</p>
              <p className="text-xs text-amber-600">{t('auth:session.expiredMessage')}</p>
            </div>
            {onClearLogoutReason && (
              <button type="button" onClick={onClearLogoutReason} className="text-amber-400 hover:text-amber-600 transition-colors">
                <i className="fa-solid fa-xmark"></i>
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{t('common:labels.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors({ ...fieldErrors, username: '' });
              }}
              className={`w-full px-4 py-3 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all font-semibold text-slate-700 ${fieldErrors.username ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              placeholder={t('auth:login.username')}
              disabled={isLoading}
            />
            {fieldErrors.username && <p className="text-red-500 text-[10px] font-bold mt-1">{fieldErrors.username}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{t('common:labels.password')}</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' });
                }}
                className={`w-full px-4 py-3 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all pr-10 font-semibold text-slate-700 ${fieldErrors.password ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                placeholder={t('auth:login.password')}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
              >
                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
              </button>
            </div>
            {fieldErrors.password && <p className="text-red-500 text-[10px] font-bold mt-1">{fieldErrors.password}</p>}
          </div>

          {error && (
            <div className="text-red-500 text-xs font-bold bg-red-50 p-3 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
              <i className="fa-solid fa-circle-exclamation"></i>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-praetor text-white font-bold rounded-xl hover:bg-slate-800 transition-all shadow-md shadow-slate-200 flex items-center justify-center gap-2 active:scale-[0.98] mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                {t('auth:login.signingIn')}
              </>
            ) : (
              <>
                {t('auth:login.signIn')} <i className="fa-solid fa-arrow-right"></i>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-400">
            <strong>{t('auth:login.defaultCredentials')}:</strong> "admin" / "password"
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
