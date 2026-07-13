import { Check, FlaskConical, Loader2, Save, Send, Server } from 'lucide-react';
import type React from 'react';
import { useCallback, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useSecretReplaceState } from '../../hooks/useSecretReplaceState';
import type { EmailConfig, SmtpEncryption } from '../../types';
import SecretField from '../shared/SecretField';

export interface EmailSettingsProps {
  config: EmailConfig;
  onSave: (config: EmailConfig) => Promise<void>;
  onTestEmail: (
    recipientEmail: string,
  ) => Promise<{ success: boolean; code: string; params?: Record<string, string> }>;
}

const ENCRYPTION_OPTIONS: ReadonlyArray<{ id: SmtpEncryption; nameKey: string }> = [
  { id: 'tls', nameKey: 'email.encryption.tls' },
  { id: 'ssl', nameKey: 'email.encryption.ssl' },
  { id: 'insecure', nameKey: 'email.encryption.insecure' },
];

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

type EmailTestResult = {
  success: boolean;
  code: string;
  params?: Record<string, string>;
};

type EmailSettingsState = {
  formData: EmailConfig;
  originalConfig: EmailConfig;
  testEmail: string;
  testResult: EmailTestResult | null;
  isTestLoading: boolean;
  isSaving: boolean;
  isSaved: boolean;
  errors: Record<string, string>;
  testErrors: Record<string, string>;
};

type StateUpdate<T> = T | ((prev: T) => T);

type EmailSettingsAction =
  | { type: 'loadConfig'; config: EmailConfig }
  | { type: 'setFormData'; update: StateUpdate<EmailConfig> }
  | { type: 'setOriginalConfig'; config: EmailConfig }
  | { type: 'setTestEmail'; value: string }
  | { type: 'setTestResult'; value: EmailTestResult | null }
  | { type: 'setIsTestLoading'; value: boolean }
  | { type: 'setIsSaving'; value: boolean }
  | { type: 'setIsSaved'; value: boolean }
  | { type: 'setErrors'; update: StateUpdate<Record<string, string>> }
  | { type: 'setTestErrors'; update: StateUpdate<Record<string, string>> };

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const emailSettingsReducer = (
  state: EmailSettingsState,
  action: EmailSettingsAction,
): EmailSettingsState => {
  switch (action.type) {
    case 'loadConfig':
      return { ...state, formData: action.config, originalConfig: action.config };
    case 'setFormData':
      return { ...state, formData: resolveStateUpdate(state.formData, action.update) };
    case 'setOriginalConfig':
      return { ...state, originalConfig: action.config };
    case 'setTestEmail':
      return { ...state, testEmail: action.value };
    case 'setTestResult':
      return { ...state, testResult: action.value };
    case 'setIsTestLoading':
      return { ...state, isTestLoading: action.value };
    case 'setIsSaving':
      return { ...state, isSaving: action.value };
    case 'setIsSaved':
      return { ...state, isSaved: action.value };
    case 'setErrors':
      return { ...state, errors: resolveStateUpdate(state.errors, action.update) };
    case 'setTestErrors':
      return { ...state, testErrors: resolveStateUpdate(state.testErrors, action.update) };
  }
};

type EmailSettingsUpdater = (update: StateUpdate<EmailConfig>) => void;
type EmailSettingsErrorsUpdater = (update: StateUpdate<Record<string, string>>) => void;

const SmtpConfigurationCard: React.FC<{
  formData: EmailConfig;
  errors: Record<string, string>;
  isSaving: boolean;
  isSaved: boolean;
  hasChanges: boolean;
  smtpPasswordReplace: ReturnType<typeof useSecretReplaceState>;
  fromEmailManuallyEdited: boolean;
  markFromEmailManuallyEdited: () => void;
  setFormData: EmailSettingsUpdater;
  setErrors: EmailSettingsErrorsUpdater;
}> = ({
  formData,
  errors,
  isSaving,
  isSaved,
  hasChanges,
  smtpPasswordReplace,
  fromEmailManuallyEdited,
  markFromEmailManuallyEdited,
  setFormData,
  setErrors,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <Server aria-hidden="true" className="size-4 text-praetor" />
          {t('email.smtpServer', 'SMTP Server Configuration')}
        </CardTitle>
        <CardDescription>
          {t(
            'email.smtpServerDescription',
            'Connect Praetor to your outbound SMTP relay to deliver notification emails.',
          )}
        </CardDescription>
        <CardAction>
          <Field className="flex-row items-center gap-2">
            <Switch
              id="email-enabled"
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, enabled: checked }))}
            />
            <FieldLabel htmlFor="email-enabled">{t('email.enabled', 'Enabled')}</FieldLabel>
          </Field>
        </CardAction>
      </CardHeader>
      <CardContent
        className={cn(
          'space-y-6 p-6 transition-opacity',
          !formData.enabled && 'pointer-events-none opacity-60',
        )}
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <Field className="md:col-span-2">
            <FieldLabel htmlFor="email-smtp-host" required>
              {t('email.host', 'SMTP Host')}
            </FieldLabel>
            <Input
              id="email-smtp-host"
              type="text"
              value={formData.smtpHost}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, smtpHost: e.target.value }));
                if (errors.smtpHost) setErrors((prev) => ({ ...prev, smtpHost: '' }));
              }}
              placeholder="smtp.example.com"
              aria-invalid={!!errors.smtpHost}
              className="font-mono"
            />
            {errors.smtpHost && <FieldError errors={[{ message: errors.smtpHost }]} />}
          </Field>

          <Field>
            <FieldLabel htmlFor="email-smtp-port" required>
              {t('email.port', 'Port')}
            </FieldLabel>
            <Input
              id="email-smtp-port"
              type="number"
              value={formData.smtpPort}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  smtpPort: parseInt(e.target.value, 10) || 587,
                }));
                if (errors.smtpPort) setErrors((prev) => ({ ...prev, smtpPort: '' }));
              }}
              min={1}
              max={65535}
              aria-invalid={!!errors.smtpPort}
              className="font-mono"
            />
            {errors.smtpPort && <FieldError errors={[{ message: errors.smtpPort }]} />}
          </Field>

          <Field>
            <FieldLabel htmlFor="email-smtp-encryption">
              {t('email.encryptionLabel', 'Encryption')}
            </FieldLabel>
            <Select
              value={formData.smtpEncryption}
              onValueChange={(val) =>
                setFormData((prev) => ({ ...prev, smtpEncryption: val as SmtpEncryption }))
              }
            >
              <SelectTrigger id="email-smtp-encryption" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENCRYPTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {t(opt.nameKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {formData.smtpEncryption === 'ssl' &&
                t('email.encryptionHint.ssl', 'Implicit SSL, typically port 465')}
              {formData.smtpEncryption === 'tls' &&
                t('email.encryptionHint.tls', 'STARTTLS, typically port 587')}
              {formData.smtpEncryption === 'insecure' &&
                t('email.encryptionHint.insecure', 'No encryption (for local proxy)')}
            </FieldDescription>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="email-smtp-user">{t('email.username', 'Username')}</FieldLabel>
            <Input
              id="email-smtp-user"
              type="text"
              value={formData.smtpUser}
              onChange={(e) => {
                const smtpUser = e.target.value;
                setFormData((prev) => ({
                  ...prev,
                  smtpUser,
                  ...(fromEmailManuallyEdited ? {} : { fromEmail: smtpUser }),
                }));
                if (!fromEmailManuallyEdited && errors.fromEmail) {
                  setErrors((prev) => ({ ...prev, fromEmail: '' }));
                }
              }}
              placeholder="user@example.com"
            />
          </Field>

          <SecretField
            {...smtpPasswordReplace}
            label={t('email.password', 'Password')}
            value={formData.smtpPassword}
            onChange={(smtpPassword) => setFormData((prev) => ({ ...prev, smtpPassword }))}
            storedLabel={t('email.passwordStored', 'Password stored')}
            storedHelp={t(
              'email.passwordStoredHelp',
              'Leave as-is to keep the stored password, or click Replace to overwrite it.',
            )}
            testId="smtp-password"
          />
        </div>

        <Field className="flex-row items-start gap-3">
          <Switch
            id="email-reject-unauthorized"
            checked={formData.smtpRejectUnauthorized}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({ ...prev, smtpRejectUnauthorized: checked }))
            }
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="email-reject-unauthorized">
              {t('email.rejectUnauthorized', 'Reject unauthorized certificates')}
            </FieldLabel>
            <FieldDescription>
              {t('email.rejectUnauthorizedHint', 'Disable for self-signed certificates')}
            </FieldDescription>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="email-from-email" required>
              {t('email.fromEmail', 'From Email')}
            </FieldLabel>
            <Input
              id="email-from-email"
              type="email"
              value={formData.fromEmail}
              onChange={(e) => {
                markFromEmailManuallyEdited();
                setFormData((prev) => ({ ...prev, fromEmail: e.target.value }));
                if (errors.fromEmail) setErrors((prev) => ({ ...prev, fromEmail: '' }));
              }}
              placeholder="noreply@example.com"
              aria-invalid={!!errors.fromEmail}
            />
            {errors.fromEmail && <FieldError errors={[{ message: errors.fromEmail }]} />}
          </Field>

          <Field>
            <FieldLabel htmlFor="email-from-name">{t('email.fromName', 'From Name')}</FieldLabel>
            <Input
              id="email-from-name"
              type="text"
              value={formData.fromName}
              onChange={(e) => setFormData((prev) => ({ ...prev, fromName: e.target.value }))}
              placeholder="Praetor"
            />
          </Field>
        </div>
      </CardContent>
      <CardFooter className="justify-end border-t border-border px-6 py-4 [.border-t]:pt-4">
        {(() => {
          const { Icon, iconClass, label } = isSaving
            ? {
                Icon: Loader2,
                iconClass: 'animate-spin',
                label: t('general.saving', 'Saving...'),
              }
            : isSaved
              ? { Icon: Check, iconClass: undefined, label: t('general.saved', 'Saved!') }
              : {
                  Icon: Save,
                  iconClass: undefined,
                  label: t('general.saveConfiguration', 'Save Configuration'),
                };
          return (
            <Button type="submit" disabled={isSaving || !hasChanges}>
              <Icon aria-hidden="true" className={iconClass} />
              {label}
            </Button>
          );
        })()}
      </CardFooter>
    </Card>
  );
};

const EmailTestCard: React.FC<{
  enabled: boolean;
  testEmail: string;
  testResult: EmailTestResult | null;
  isTestLoading: boolean;
  testErrors: Record<string, string>;
  setTestEmail: (value: string) => void;
  setTestErrors: EmailSettingsErrorsUpdater;
  onSubmit: (event: React.FormEvent) => void;
  getTranslatedMessage: (code: string, params?: Record<string, string>) => string;
}> = ({
  enabled,
  testEmail,
  testResult,
  isTestLoading,
  testErrors,
  setTestEmail,
  setTestErrors,
  onSubmit,
  getTranslatedMessage,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden rounded-lg border-border bg-background py-0 transition-opacity',
        !enabled && 'pointer-events-none opacity-60',
      )}
    >
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <FlaskConical aria-hidden="true" className="size-4 text-praetor" />
          {t('email.testEmail', 'Test Email')}
        </CardTitle>
        <CardDescription>
          {t(
            'email.testDescription',
            'Send a test email to verify your SMTP configuration is working correctly.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <form onSubmit={onSubmit} className="space-y-4">
            <Field>
              <FieldLabel htmlFor="email-test-recipient" required>
                {t('email.recipientEmail', 'Recipient Email')}
              </FieldLabel>
              <Input
                id="email-test-recipient"
                type="email"
                value={testEmail}
                onChange={(e) => {
                  setTestEmail(e.target.value);
                  if (testErrors.testEmail) setTestErrors((prev) => ({ ...prev, testEmail: '' }));
                }}
                placeholder="test@example.com"
                aria-invalid={!!testErrors.testEmail}
              />
              {testErrors.testEmail && <FieldError errors={[{ message: testErrors.testEmail }]} />}
              {testErrors.enabled && (
                <FieldDescription className="text-amber-600 dark:text-amber-400">
                  {testErrors.enabled}
                </FieldDescription>
              )}
            </Field>
            <Button type="submit" disabled={isTestLoading || !enabled} className="w-full">
              {isTestLoading ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {t('email.sendTest', 'Send Test Email')}
            </Button>
          </form>

          <div className="h-64 overflow-y-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-xs">
            {isTestLoading ? (
              <div className="animate-pulse text-muted-foreground">
                {t('email.sending', 'Sending test email...')}
              </div>
            ) : testResult ? (
              <div className="space-y-2">
                <div
                  className={cn(
                    'font-semibold',
                    testResult.success
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-destructive',
                  )}
                >
                  [
                  {testResult.success
                    ? t('email.testSuccess', 'SUCCESS')
                    : t('email.testFailure', 'FAILURE')}
                  ] {getTranslatedMessage(testResult.code, testResult.params)}
                </div>
                {testResult.success && (
                  <div className="mt-2 text-muted-foreground">
                    {t('email.checkInbox', 'Check your inbox for the test email.')}
                  </div>
                )}
              </div>
            ) : (
              <div className="italic text-muted-foreground">
                {t('email.waitingForTest', 'Waiting for test execution...')}
                <br />
                <br />
                <span className="opacity-70">
                  {t('email.logOutput', 'Test results will appear here.')}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const EmailSettings: React.FC<EmailSettingsProps> = ({ config, onSave, onTestEmail }) => {
  const { t } = useTranslation('settings');
  const [state, dispatchState] = useReducer(emailSettingsReducer, undefined, () => ({
    formData: DEFAULT_CONFIG,
    originalConfig: DEFAULT_CONFIG,
    testEmail: '',
    testResult: null,
    isTestLoading: false,
    isSaving: false,
    isSaved: false,
    errors: {},
    testErrors: {},
  }));
  const {
    formData,
    originalConfig,
    testEmail,
    testResult,
    isTestLoading,
    isSaving,
    isSaved,
    errors,
    testErrors,
  } = state;
  const setFormData = useCallback((update: StateUpdate<EmailConfig>) => {
    dispatchState({ type: 'setFormData', update });
  }, []);
  const setOriginalConfig = useCallback((nextConfig: EmailConfig) => {
    dispatchState({ type: 'setOriginalConfig', config: nextConfig });
  }, []);
  const setTestEmail = useCallback((value: string) => {
    dispatchState({ type: 'setTestEmail', value });
  }, []);
  const setTestResult = useCallback((value: EmailTestResult | null) => {
    dispatchState({ type: 'setTestResult', value });
  }, []);
  const setIsTestLoading = useCallback((value: boolean) => {
    dispatchState({ type: 'setIsTestLoading', value });
  }, []);
  const setIsSaving = useCallback((value: boolean) => {
    dispatchState({ type: 'setIsSaving', value });
  }, []);
  const setIsSaved = useCallback((value: boolean) => {
    dispatchState({ type: 'setIsSaved', value });
  }, []);
  const setErrors = useCallback((update: StateUpdate<Record<string, string>>) => {
    dispatchState({ type: 'setErrors', update });
  }, []);
  const setTestErrors = useCallback((update: StateUpdate<Record<string, string>>) => {
    dispatchState({ type: 'setTestErrors', update });
  }, []);
  const [loadedConfig, setLoadedConfig] = useState<EmailConfig | null>(null);
  const smtpPasswordReplace = useSecretReplaceState(
    formData.smtpPassword,
    (smtpPassword) => setFormData((prev) => ({ ...prev, smtpPassword })),
    config,
  );
  // Lock the From Email auto-fill once the admin has supplied a value (either by
  // typing into the field or by loading a saved config that already has one).
  // Mirrors the username/firstName-surname pattern in UserManagement.
  const [fromEmailManuallyEdited, setFromEmailManuallyEdited] = useState(
    Boolean(config?.fromEmail),
  );

  if (loadedConfig !== config) {
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- React-supported prop snapshot adjustment; no updater callback is involved.
    setLoadedConfig(config);
    dispatchState({ type: 'loadConfig', config });
    setFromEmailManuallyEdited(Boolean(config.fromEmail));
  }

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(originalConfig);

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
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">
            {t('email.title', 'Email Settings')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('email.subtitle', 'Configure SMTP settings for email notifications')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <SmtpConfigurationCard
          formData={formData}
          errors={errors}
          isSaving={isSaving}
          isSaved={isSaved}
          hasChanges={hasChanges}
          smtpPasswordReplace={smtpPasswordReplace}
          fromEmailManuallyEdited={fromEmailManuallyEdited}
          markFromEmailManuallyEdited={() => setFromEmailManuallyEdited(true)}
          setFormData={setFormData}
          setErrors={setErrors}
        />
      </form>

      <EmailTestCard
        enabled={formData.enabled}
        testEmail={testEmail}
        testResult={testResult}
        isTestLoading={isTestLoading}
        testErrors={testErrors}
        setTestEmail={setTestEmail}
        setTestErrors={setTestErrors}
        onSubmit={handleTest}
        getTranslatedMessage={getTranslatedMessage}
      />
    </div>
  );
};

export default EmailSettings;
