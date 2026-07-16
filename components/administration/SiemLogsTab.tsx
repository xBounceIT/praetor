import { AlertTriangle, CheckCircle2, Loader2, RadioTower, Save, Send } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  logsApi,
  type SiemConfig,
  type SiemConfigUpdate,
  type SiemStatus,
} from '../../services/api/logs';
import SecretField from '../shared/SecretField';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

type Props = { canUpdate: boolean };
type FormErrors = Partial<Record<keyof SiemConfigUpdate, string>>;

const FIELD_FOCUS_SELECTORS: Partial<Record<keyof SiemConfigUpdate, string>> = {
  host: '#siem-host',
  port: '#siem-port',
  sourceIdentifier: '#siem-source',
  facility: '#siem-facility',
  clientKey: '[data-testid="siem-client-key-input"]',
  retentionDays: '#siem-retention',
  maxEvents: '#siem-capacity',
};

const formatDate = (value: string | null, formatter: Intl.DateTimeFormat, fallback: string) =>
  value ? formatter.format(new Date(value)) : fallback;

const configToForm = (config: SiemConfig): SiemConfigUpdate => ({
  host: config.host,
  port: config.port,
  protocol: config.protocol,
  tcpFraming: config.tcpFraming,
  sourceIdentifier: config.sourceIdentifier,
  facility: config.facility,
  runtimeLevel: config.runtimeLevel,
  includeRuntime: config.includeRuntime,
  includeAudit: config.includeAudit,
  caPem: config.caPem,
  serverName: config.serverName,
  clientCertPem: config.clientCertPem,
  clientKey: config.clientKey,
  retentionDays: config.retentionDays,
  maxEvents: config.maxEvents,
});

const SiemLogsTab: React.FC<Props> = ({ canUpdate }) => {
  const { t, i18n } = useTranslation('administration');
  const [config, setConfig] = useState<SiemConfig | null>(null);
  const [form, setForm] = useState<SiemConfigUpdate | null>(null);
  const [status, setStatus] = useState<SiemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'test' | 'toggle' | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [replacingClientKey, setReplacingClientKey] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestStatusRequestIdRef = useRef(0);

  const applyConfig = useCallback((next: SiemConfig, invalidatePendingStatus = false) => {
    if (invalidatePendingStatus) latestStatusRequestIdRef.current += 1;
    setConfig(next);
    setForm(configToForm(next));
    setStatus((current) =>
      current
        ? {
            ...current,
            enabled: next.enabled,
            revision: next.revision,
            testedRevision: next.testedRevision,
            lastTestAt: next.lastTestAt,
            lastTestSuccess: next.lastTestSuccess,
            lastDeliveryAt: next.lastDeliveryAt,
            lastErrorAt: next.lastErrorAt,
            lastError: next.lastError,
            droppedRetention: next.droppedRetention,
            droppedCapacity: next.droppedCapacity,
          }
        : current,
    );
    setReplacingClientKey(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    const requestId = ++latestStatusRequestIdRef.current;
    const next = await logsApi.getSiemStatus();
    if (requestId === latestStatusRequestIdRef.current) setStatus(next);
  }, []);

  const refreshStatusBestEffort = useCallback(() => {
    void refreshStatus().catch(() => undefined);
  }, [refreshStatus]);

  const loadConfiguration = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      const statusRequestId = ++latestStatusRequestIdRef.current;
      const [configResult, statusResult] = await Promise.allSettled([
        logsApi.getSiemConfig(),
        logsApi.getSiemStatus(),
      ]);
      if (signal?.aborted) return;
      if (configResult.status === 'fulfilled') {
        applyConfig(configResult.value);
      } else {
        setLoadError(
          configResult.reason instanceof Error
            ? configResult.reason.message
            : t('logs.siem.messages.loadFailed'),
        );
      }
      if (
        statusResult.status === 'fulfilled' &&
        statusRequestId === latestStatusRequestIdRef.current
      )
        setStatus(statusResult.value);
      setLoading(false);
    },
    [applyConfig, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadConfiguration(controller.signal);
    const interval = window.setInterval(() => {
      refreshStatusBestEffort();
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadConfiguration, refreshStatusBestEffort]);

  const updateField = <K extends keyof SiemConfigUpdate>(key: K, value: SiemConfigUpdate[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const showValidationErrors = (next: FormErrors, replace = true): boolean => {
    const firstInvalidField = (Object.keys(next) as Array<keyof SiemConfigUpdate>).find(
      (key) => next[key],
    );
    setErrors((current) => (replace ? next : { ...current, ...next }));
    if (!firstInvalidField) return false;

    const message = next[firstInvalidField];
    if (message) toast.error(message);
    const selector = FIELD_FOCUS_SELECTORS[firstInvalidField];
    if (selector) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(selector)?.focus();
      });
    }
    return true;
  };

  const showServerValidationError = (code: string): boolean => {
    if (code === 'SIEM_HOST_REQUIRED') {
      return showValidationErrors({ host: t('logs.siem.validation.hostRequired') }, false);
    }
    if (code === 'SIEM_SOURCE_IDENTIFIER_REQUIRED') {
      return showValidationErrors(
        { sourceIdentifier: t('logs.siem.validation.sourceRequired') },
        false,
      );
    }
    if (code === 'SIEM_MTLS_CERT_KEY_REQUIRED') {
      return showValidationErrors({ clientKey: t('logs.siem.validation.mtlsPair') }, false);
    }
    return false;
  };

  const validate = (candidate: SiemConfigUpdate): boolean => {
    const next: FormErrors = {};
    if (!candidate.host.trim()) next.host = t('logs.siem.validation.hostRequired');
    if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535)
      next.port = t('logs.siem.validation.port');
    if (!candidate.sourceIdentifier.trim())
      next.sourceIdentifier = t('logs.siem.validation.sourceRequired');
    if (!Number.isInteger(candidate.facility) || candidate.facility < 0 || candidate.facility > 23)
      next.facility = t('logs.siem.validation.facility');
    if (
      !Number.isInteger(candidate.retentionDays) ||
      candidate.retentionDays < 1 ||
      candidate.retentionDays > 30
    )
      next.retentionDays = t('logs.siem.validation.retention');
    if (
      !Number.isInteger(candidate.maxEvents) ||
      candidate.maxEvents < 10_000 ||
      candidate.maxEvents > 1_000_000
    )
      next.maxEvents = t('logs.siem.validation.capacity');

    if (
      candidate.protocol === 'tls' &&
      Boolean(candidate.clientCertPem) !== Boolean(candidate.clientKey)
    ) {
      next.clientKey = t('logs.siem.validation.mtlsPair');
    }
    return !showValidationErrors(next);
  };

  const handleSave = async () => {
    if (!form || !validate(form)) return;
    setBusy('save');
    try {
      const next = await logsApi.updateSiemConfig(form);
      applyConfig(next, true);
      refreshStatusBestEffort();
      toast.success(t('logs.siem.messages.saved'));
    } catch (error) {
      const errorCode =
        error instanceof Error
          ? ((error as Error & { errorCode?: string }).errorCode ?? error.message)
          : '';
      if (!showServerValidationError(errorCode)) {
        toast.error(error instanceof Error ? error.message : t('logs.siem.messages.saveFailed'));
      }
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    if (!form || !validate(form)) return;
    setBusy('test');
    try {
      const result = await logsApi.testSiem();
      const nextConfig = await logsApi.getSiemConfig().catch(() => null);
      if (nextConfig) applyConfig(nextConfig, true);
      refreshStatusBestEffort();
      if (result.success) toast.success(t('logs.siem.messages.testSucceeded'));
      else if (!result.error || !showServerValidationError(result.error)) {
        toast.error(result.error || t('logs.siem.messages.testFailed'));
      }
    } catch (error) {
      const errorCode =
        error instanceof Error
          ? ((error as Error & { errorCode?: string }).errorCode ?? error.message)
          : '';
      if (!showServerValidationError(errorCode)) {
        toast.error(error instanceof Error ? error.message : t('logs.siem.messages.testFailed'));
      }
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async () => {
    if (!config) return;
    setBusy('toggle');
    try {
      const next = config.enabled ? await logsApi.disableSiem() : await logsApi.enableSiem();
      applyConfig(next, true);
      refreshStatusBestEffort();
      toast.success(t(next.enabled ? 'logs.siem.messages.enabled' : 'logs.siem.messages.disabled'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('logs.siem.messages.toggleFailed'));
    } finally {
      setBusy(null);
    }
  };

  const statusLabel = useMemo(() => {
    if (!status) return t('logs.siem.status.unknown');
    return status.enabled ? t('logs.siem.status.enabled') : t('logs.siem.status.disabled');
  }, [status, t]);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    [i18n.language],
  );

  const isDirty = useMemo(
    () => Boolean(config && form && JSON.stringify(form) !== JSON.stringify(configToForm(config))),
    [config, form],
  );
  const configTestTime =
    config && config.testedRevision === config.revision
      ? Date.parse(config.lastTestAt ?? '') || 0
      : -1;
  const statusTestTime =
    config && status?.revision === config.revision && status.testedRevision === config.revision
      ? Date.parse(status.lastTestAt ?? '') || 0
      : -1;
  const hasSuccessfulTest =
    statusTestTime >= configTestTime && statusTestTime >= 0
      ? status?.lastTestSuccess === true
      : configTestTime >= 0 && config?.lastTestSuccess === true;
  const activationBlocked = Boolean(config && !config.enabled && (isDirty || !hasSuccessfulTest));

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-10 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('logs.siem.loading')}
      </div>
    );
  }

  if (!form || !config) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-xl border bg-card p-10 text-center text-muted-foreground"
      >
        <AlertTriangle className="size-5 text-destructive" />
        <span>{loadError || t('logs.siem.messages.loadFailed')}</span>
        <Button variant="outline" onClick={() => void loadConfiguration()}>
          {t('common:buttons.retry')}
        </Button>
      </div>
    );
  }

  const fieldInvalid = (key: keyof FormErrors) => Boolean(errors[key]) || undefined;
  const never = t('logs.siem.status.never');

  return (
    <div className="space-y-8">
      {!canUpdate && (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          {t('logs.siem.viewOnly')}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <fieldset className="m-0 min-w-0 space-y-8 border-0 p-0">
          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <RadioTower aria-hidden="true" className="size-4 text-praetor" />
                {t('logs.siem.destination.title')}
              </CardTitle>
              <CardDescription>{t('logs.siem.destination.description')}</CardDescription>
              <CardAction>
                <Badge variant={status?.enabled ? 'default' : 'secondary'}>{statusLabel}</Badge>
              </CardAction>
            </CardHeader>

            <CardContent className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
              <Field data-invalid={fieldInvalid('host')} className="sm:col-span-2">
                <FieldLabel htmlFor="siem-host">{t('logs.siem.fields.host')}</FieldLabel>
                <Input
                  id="siem-host"
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                  disabled={!canUpdate}
                  aria-invalid={fieldInvalid('host')}
                />
                <FieldError>{errors.host}</FieldError>
              </Field>
              <Field data-invalid={fieldInvalid('port')}>
                <FieldLabel htmlFor="siem-port">{t('logs.siem.fields.port')}</FieldLabel>
                <Input
                  id="siem-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => updateField('port', Number(e.target.value))}
                  disabled={!canUpdate}
                  aria-invalid={fieldInvalid('port')}
                />
                <FieldError>{errors.port}</FieldError>
              </Field>
              <Field>
                <FieldLabel>{t('logs.siem.fields.protocol')}</FieldLabel>
                <Select
                  value={form.protocol}
                  onValueChange={(value) =>
                    updateField('protocol', value as SiemConfigUpdate['protocol'])
                  }
                  disabled={!canUpdate}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="tls">TLS</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.protocol !== 'udp' && (
                <Field>
                  <FieldLabel>{t('logs.siem.fields.framing')}</FieldLabel>
                  <Select
                    value={form.tcpFraming}
                    onValueChange={(value) =>
                      updateField('tcpFraming', value as SiemConfigUpdate['tcpFraming'])
                    }
                    disabled={!canUpdate}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newline">Newline</SelectItem>
                      <SelectItem value="octet-counting">Octet counting</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field data-invalid={fieldInvalid('sourceIdentifier')}>
                <FieldLabel htmlFor="siem-source">{t('logs.siem.fields.source')}</FieldLabel>
                <Input
                  id="siem-source"
                  value={form.sourceIdentifier}
                  onChange={(e) => updateField('sourceIdentifier', e.target.value)}
                  disabled={!canUpdate}
                  aria-invalid={fieldInvalid('sourceIdentifier')}
                />
                <FieldError>{errors.sourceIdentifier}</FieldError>
              </Field>
              <Field data-invalid={fieldInvalid('facility')}>
                <FieldLabel htmlFor="siem-facility">{t('logs.siem.fields.facility')}</FieldLabel>
                <Input
                  id="siem-facility"
                  type="number"
                  min={0}
                  max={23}
                  value={form.facility}
                  onChange={(e) => updateField('facility', Number(e.target.value))}
                  disabled={!canUpdate}
                  aria-invalid={fieldInvalid('facility')}
                />
                <FieldError>{errors.facility}</FieldError>
              </Field>
            </CardContent>

            <fieldset className="space-y-4 border-t border-border p-6">
              <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('logs.siem.events.title')}
              </legend>
              <FieldDescription>{t('logs.siem.events.description')}</FieldDescription>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex items-start gap-3">
                  <Switch
                    id="siem-runtime"
                    checked={form.includeRuntime}
                    onCheckedChange={(checked) => updateField('includeRuntime', checked)}
                    disabled={!canUpdate}
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <FieldLabel htmlFor="siem-runtime" className="cursor-pointer">
                      {t('logs.siem.fields.runtime')}
                    </FieldLabel>
                    <FieldDescription>{t('logs.siem.fields.runtimeHelp')}</FieldDescription>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Switch
                    id="siem-audit"
                    checked={form.includeAudit}
                    onCheckedChange={(checked) => updateField('includeAudit', checked)}
                    disabled={!canUpdate}
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <FieldLabel htmlFor="siem-audit" className="cursor-pointer">
                      {t('logs.siem.fields.audit')}
                    </FieldLabel>
                    <FieldDescription>{t('logs.siem.fields.auditHelp')}</FieldDescription>
                  </div>
                </div>
              </div>
              <Field className="max-w-sm pt-2">
                <FieldLabel>{t('logs.siem.fields.runtimeLevel')}</FieldLabel>
                <Select
                  value={form.runtimeLevel}
                  onValueChange={(value) =>
                    updateField('runtimeLevel', value as SiemConfigUpdate['runtimeLevel'])
                  }
                  disabled={!canUpdate || !form.includeRuntime}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => (
                      <SelectItem key={level} value={level}>
                        {level.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </fieldset>

            {form.protocol === 'tls' && (
              <fieldset className="space-y-4 border-t border-border p-6">
                <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t('logs.siem.tls.title')}
                </legend>
                <FieldDescription>{t('logs.siem.tls.description')}</FieldDescription>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="siem-server-name">
                      {t('logs.siem.fields.serverName')}
                    </FieldLabel>
                    <Input
                      id="siem-server-name"
                      value={form.serverName}
                      onChange={(e) => updateField('serverName', e.target.value)}
                      disabled={!canUpdate}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="siem-ca">{t('logs.siem.fields.ca')}</FieldLabel>
                    <Textarea
                      id="siem-ca"
                      className="font-mono text-xs"
                      rows={6}
                      value={form.caPem}
                      onChange={(e) => updateField('caPem', e.target.value)}
                      disabled={!canUpdate}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="siem-client-cert">
                      {t('logs.siem.fields.clientCert')}
                    </FieldLabel>
                    <Textarea
                      id="siem-client-cert"
                      className="font-mono text-xs"
                      rows={6}
                      value={form.clientCertPem}
                      onChange={(e) => updateField('clientCertPem', e.target.value)}
                      disabled={!canUpdate}
                    />
                  </Field>
                  <SecretField
                    label={t('logs.siem.fields.clientKey')}
                    value={form.clientKey}
                    onChange={(value) => updateField('clientKey', value)}
                    isStored={config.clientKey === '********'}
                    isReplacing={replacingClientKey}
                    onStartReplace={() => {
                      setReplacingClientKey(true);
                      updateField('clientKey', '');
                    }}
                    onCancelReplace={() => {
                      setReplacingClientKey(false);
                      updateField('clientKey', config.clientKey);
                    }}
                    storedLabel={t('logs.siem.tls.keyStored')}
                    storedHelp={t('logs.siem.tls.keyStoredHelp')}
                    multiline
                    monospace
                    error={errors.clientKey}
                    disabled={!canUpdate}
                    testId="siem-client-key"
                  />
                </div>
              </fieldset>
            )}

            <fieldset className="space-y-4 border-t border-border p-6">
              <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('logs.siem.queue.title')}
              </legend>
              <FieldDescription>{t('logs.siem.queue.description')}</FieldDescription>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field data-invalid={fieldInvalid('retentionDays')}>
                  <FieldLabel htmlFor="siem-retention">
                    {t('logs.siem.fields.retention')}
                  </FieldLabel>
                  <Input
                    id="siem-retention"
                    type="number"
                    min={1}
                    max={30}
                    value={form.retentionDays}
                    onChange={(e) => updateField('retentionDays', Number(e.target.value))}
                    disabled={!canUpdate}
                    aria-invalid={fieldInvalid('retentionDays')}
                  />
                  <FieldError>{errors.retentionDays}</FieldError>
                </Field>
                <Field data-invalid={fieldInvalid('maxEvents')}>
                  <FieldLabel htmlFor="siem-capacity">{t('logs.siem.fields.capacity')}</FieldLabel>
                  <Input
                    id="siem-capacity"
                    type="number"
                    min={10000}
                    max={1000000}
                    value={form.maxEvents}
                    onChange={(e) => updateField('maxEvents', Number(e.target.value))}
                    disabled={!canUpdate}
                    aria-invalid={fieldInvalid('maxEvents')}
                  />
                  <FieldError>{errors.maxEvents}</FieldError>
                </Field>
              </div>
            </fieldset>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={!canUpdate || busy !== null || !isDirty}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
              {t('logs.siem.actions.save')}
            </Button>
          </div>
        </fieldset>
      </form>

      <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
        <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <Send aria-hidden="true" className="size-4 text-praetor" />
            {t('logs.siem.status.title')}
          </CardTitle>
          <CardDescription>{t('logs.siem.status.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-8 p-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <div className="text-sm font-medium text-foreground">
                {t('logs.siem.workflow.title')}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('logs.siem.workflow.description')}
              </p>
              <ol className="mt-4 space-y-3 text-sm">
                {(['save', 'test', 'enable'] as const).map((step, index) => (
                  <li key={step} className="flex items-center gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span>{t(`logs.siem.workflow.${step}`)}</span>
                  </li>
                ))}
              </ol>
            </div>

            {isDirty && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {t('logs.siem.workflow.unsaved')}
              </p>
            )}
            {!isDirty && !config.enabled && !hasSuccessfulTest && (
              <p className="text-xs font-medium text-muted-foreground">
                {t('logs.siem.workflow.testRequired')}
              </p>
            )}

            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={handleTest}
              disabled={!canUpdate || busy !== null || isDirty}
            >
              {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />}
              {t('logs.siem.actions.test')}
            </Button>
            <Button
              type="button"
              size="lg"
              variant={config.enabled ? 'outline' : 'default'}
              className="w-full"
              onClick={handleToggle}
              disabled={!canUpdate || busy !== null || activationBlocked}
            >
              {busy === 'toggle' ? (
                <Loader2 className="animate-spin" />
              ) : config.enabled ? (
                <RadioTower />
              ) : (
                <CheckCircle2 />
              )}
              {t(config.enabled ? 'logs.siem.actions.disable' : 'logs.siem.actions.enable')}
            </Button>
          </div>

          <div className="min-h-64 rounded-md border border-border bg-muted/40 p-4 text-sm">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
              <span className="font-medium text-foreground">{t('logs.siem.status.title')}</span>
              <Badge variant={status?.enabled ? 'default' : 'secondary'}>{statusLabel}</Badge>
            </div>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  {t('logs.siem.status.lastTest')}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-medium">
                  <span>{formatDate(status?.lastTestAt ?? null, dateFormatter, never)}</span>
                  {typeof status?.lastTestSuccess === 'boolean' && (
                    <Badge variant={status.lastTestSuccess ? 'secondary' : 'destructive'}>
                      {t(
                        status.lastTestSuccess
                          ? 'logs.siem.status.testSucceeded'
                          : 'logs.siem.status.testFailed',
                      )}
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t('logs.siem.status.lastDelivery')}
                </div>
                <div className="mt-1 font-medium">
                  {formatDate(status?.lastDeliveryAt ?? null, dateFormatter, never)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t('logs.siem.status.pending')}</div>
                <div className="mt-1 font-medium">
                  {(status?.pendingCount ?? 0).toLocaleString(i18n.language)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t('logs.siem.status.oldestPending')}
                </div>
                <div className="mt-1 font-medium">
                  {formatDate(status?.oldestPendingAt ?? null, dateFormatter, never)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t('logs.siem.status.dropped')}</div>
                <div className="mt-1 font-medium">
                  {(
                    (status?.droppedCapacity ?? 0) + (status?.droppedRetention ?? 0)
                  ).toLocaleString(i18n.language)}
                </div>
              </div>
            </div>
            {status?.lastError && (
              <div className="mt-5 flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{status.lastError}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SiemLogsTab;
