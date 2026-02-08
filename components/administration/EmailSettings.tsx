import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmailConfig, SmtpEncryption } from '../../types';
import CustomSelect from '../shared/CustomSelect';

export interface EmailSettingsProps {
  config: EmailConfig;
  onSave: (config: EmailConfig) => Promise<void>;
  onTestEmail: (
    recipientEmail: string,
  ) => Promise<{ success: boolean; code: string; params?: Record<string, string> }>;
}

const DEFAULT_CONFIG: EmailConfig = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: 'Praetor',
};

const EmailSettings: React.FC<EmailSettingsProps> = ({ config, onSave, onTestEmail }) => {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<EmailConfig>(config || DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState<EmailConfig>(config || DEFAULT_CONFIG);
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<{
    success: boolean;
    code: string;
    params?: Record<string, string>;
  } | null>(null);
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});

  // Sync formData when config prop changes (e.g., after API fetch)
  useEffect(() => {
    if (config) {
      setFormData(config);
      setOriginalConfig(config);
    }
  }, [config]);

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(originalConfig);

  const encryptionOptions = [
    { id: 'tls', name: t('email.encryption.tls', 'TLS/STARTTLS') },
    { id: 'ssl', name: t('email.encryption.ssl', 'SSL') },
    { id: 'insecure', name: t('email.encryption.insecure', 'None (Insecure)') },
  ];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!formData.enabled) {
      setIsSaving(true);
      try {
        await onSave(formData);
        setOriginalConfig(formData);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
      } catch (err) {
        console.error('Failed to save email config:', err);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const newErrors: Record<string, string> = {};

    if (!formData.smtpHost?.trim()) {
      newErrors.smtpHost = t('email.errors.hostRequired', 'SMTP host is required');
    }
    if (!formData.smtpPort || formData.smtpPort < 1 || formData.smtpPort > 65535) {
      newErrors.smtpPort = t('email.errors.portInvalid', 'Port must be between 1 and 65535');
    }
    if (!formData.fromEmail?.trim()) {
      newErrors.fromEmail = t('email.errors.fromEmailRequired', 'From email is required');
    } else if (!formData.fromEmail.includes('@')) {
      newErrors.fromEmail = t('email.errors.fromEmailInvalid', 'Invalid email address');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(formData);
      setOriginalConfig(formData);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save email config:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestErrors({});
    setTestResult(null);

    const newErrors: Record<string, string> = {};
    if (!testEmail?.trim()) {
      newErrors.testEmail = t('email.errors.recipientRequired', 'Recipient email is required');
    } else if (!testEmail.includes('@')) {
      newErrors.testEmail = t('email.errors.recipientInvalid', 'Invalid email address');
    }
    if (!formData.enabled) {
      newErrors.enabled = t('email.errors.mustBeEnabled', 'Email must be enabled to send test');
    }

    if (Object.keys(newErrors).length > 0) {
      setTestErrors(newErrors);
      return;
    }

    setIsTestLoading(true);

    try {
      const result = await onTestEmail(testEmail);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        code: 'SMTP_ERROR',
        params: { error: err instanceof Error ? err.message : 'Failed to send test email' },
      });
    } finally {
      setIsTestLoading(false);
    }
  };

  const getTranslatedMessage = (code: string, params?: Record<string, string>) => {
    const translationKey = `email.testMessages.${code}`;
    const defaultMessage = code;

    if (params?.error) {
      return t(translationKey, { error: params.error, defaultValue: params.error });
    }

    return t(translationKey, defaultMessage);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            {t('email.title', 'Email Settings')}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {t('email.subtitle', 'Configure SMTP settings for email notifications')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* SMTP Server Configuration */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <i className="fa-solid fa-server text-praetor"></i>
              <h3 className="font-bold text-slate-800">
                {t('email.smtpServer', 'SMTP Server Configuration')}
              </h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-praetor"></div>
              <span className="ms-3 text-sm font-medium text-slate-600">
                {t('email.enabled', 'Enabled')}
              </span>
            </label>
          </div>

          <div
            className={`p-6 grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.host', 'SMTP Host')}
              </label>
              <input
                type="text"
                value={formData.smtpHost}
                onChange={(e) => {
                  setFormData({ ...formData, smtpHost: e.target.value });
                  if (errors.smtpHost) setErrors({ ...errors, smtpHost: '' });
                }}
                placeholder="smtp.example.com"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.smtpHost ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.smtpHost && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.smtpHost}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.port', 'Port')}
              </label>
              <input
                type="number"
                value={formData.smtpPort}
                onChange={(e) => {
                  setFormData({ ...formData, smtpPort: parseInt(e.target.value, 10) || 587 });
                  if (errors.smtpPort) setErrors({ ...errors, smtpPort: '' });
                }}
                min={1}
                max={65535}
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-mono text-sm ${errors.smtpPort ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.smtpPort && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.smtpPort}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.encryptionLabel', 'Encryption')}
              </label>
              <CustomSelect
                options={encryptionOptions}
                value={formData.smtpEncryption}
                onChange={(val) =>
                  setFormData({ ...formData, smtpEncryption: val as SmtpEncryption })
                }
              />
              <p className="text-[10px] text-slate-400 mt-1">
                {formData.smtpEncryption === 'ssl' &&
                  t('email.encryptionHint.ssl', 'Implicit SSL, typically port 465')}
                {formData.smtpEncryption === 'tls' &&
                  t('email.encryptionHint.tls', 'STARTTLS, typically port 587')}
                {formData.smtpEncryption === 'insecure' &&
                  t('email.encryptionHint.insecure', 'No encryption (for local proxy)')}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.username', 'Username')}
              </label>
              <input
                type="text"
                value={formData.smtpUser}
                onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                placeholder="user@example.com"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.password', 'Password')}
              </label>
              <input
                type="password"
                value={formData.smtpPassword}
                onChange={(e) => setFormData({ ...formData, smtpPassword: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.smtpRejectUnauthorized}
                  onChange={(e) =>
                    setFormData({ ...formData, smtpRejectUnauthorized: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-praetor"></div>
                <span className="ms-3 text-sm font-medium text-slate-600">
                  {t('email.rejectUnauthorized', 'Reject unauthorized certificates')}
                </span>
              </label>
              <p className="text-[10px] text-slate-400 mt-1 ml-14">
                {t('email.rejectUnauthorizedHint', 'Disable for self-signed certificates')}
              </p>
            </div>
          </div>
        </section>

        {/* Sender Settings */}
        <section
          className={`bg-white rounded-2xl border border-slate-200 shadow-sm transition-opacity ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 rounded-t-2xl">
            <i className="fa-solid fa-envelope text-praetor"></i>
            <h3 className="font-bold text-slate-800">{t('email.sender', 'Sender Settings')}</h3>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.fromEmail', 'From Email')}
              </label>
              <input
                type="email"
                value={formData.fromEmail}
                onChange={(e) => {
                  setFormData({ ...formData, fromEmail: e.target.value });
                  if (errors.fromEmail) setErrors({ ...errors, fromEmail: '' });
                }}
                placeholder="noreply@example.com"
                className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm ${errors.fromEmail ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
              />
              {errors.fromEmail && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.fromEmail}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('email.fromName', 'From Name')}
              </label>
              <input
                type="text"
                value={formData.fromName}
                onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
                placeholder="Praetor"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm"
              />
            </div>
          </div>
        </section>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={isSaving || !hasChanges}
            className={`px-8 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50 ${
              isSaved
                ? 'bg-emerald-500 text-white shadow-emerald-200'
                : 'bg-praetor text-white shadow-slate-200 hover:bg-slate-800'
            }`}
          >
            {isSaving ? (
              <i className="fa-solid fa-circle-notch fa-spin"></i>
            ) : isSaved ? (
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-check"></i>
                {t('general.saved', 'Saved!')}
              </span>
            ) : (
              t('general.saveConfiguration', 'Save Configuration')
            )}
          </button>
        </div>
      </form>

      {/* Test Email */}
      <section
        className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-12 transition-opacity ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
          <i className="fa-solid fa-vial text-praetor"></i>
          <h3 className="font-bold text-slate-800">{t('email.testEmail', 'Test Email')}</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            <p className="text-xs text-slate-400 mb-4">
              {t(
                'email.testDescription',
                'Send a test email to verify your SMTP configuration is working correctly.',
              )}
            </p>
            <form onSubmit={handleTest} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {t('email.recipientEmail', 'Recipient Email')}
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => {
                    setTestEmail(e.target.value);
                    if (testErrors.testEmail) setTestErrors({ ...testErrors, testEmail: '' });
                  }}
                  placeholder="test@example.com"
                  className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm font-semibold text-slate-700 ${testErrors.testEmail ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                />
                {testErrors.testEmail && (
                  <p className="text-red-500 text-[10px] font-bold mt-1">{testErrors.testEmail}</p>
                )}
                {testErrors.enabled && (
                  <p className="text-amber-600 text-[10px] font-bold mt-1">{testErrors.enabled}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={isTestLoading || !formData.enabled}
                className="w-full bg-praetor text-white py-2 rounded-lg font-bold hover:bg-slate-800 transition-colors disabled:opacity-50 shadow-md shadow-slate-100"
              >
                {isTestLoading ? (
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                ) : (
                  t('email.sendTest', 'Send Test Email')
                )}
              </button>
            </form>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs overflow-y-auto h-64 border border-slate-800 shadow-inner">
            {isTestLoading ? (
              <div className="text-slate-400 animate-pulse">
                {t('email.sending', 'Sending test email...')}
              </div>
            ) : testResult ? (
              <div className="space-y-2">
                <div
                  className={`font-bold ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  [
                  {testResult.success
                    ? t('email.testSuccess', 'SUCCESS')
                    : t('email.testFailure', 'FAILURE')}
                  ] {getTranslatedMessage(testResult.code, testResult.params)}
                </div>
                {testResult.success && (
                  <div className="text-slate-400 mt-2">
                    {t('email.checkInbox', 'Check your inbox for the test email.')}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-600 italic">
                {t('email.waitingForTest', 'Waiting for test execution...')}
                <br />
                <br />
                <span className="opacity-50">
                  {t('email.logOutput', 'Test results will appear here.')}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default EmailSettings;
