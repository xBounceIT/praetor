import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api/client';
import { downloadTextFile } from '@/utils/download';

export interface TotpSetupResult {
  secret: string;
  otpauthUri: string;
  qrDataUri: string;
  backupCodes: string[];
}

export interface TotpSetupWizardProps {
  // Called once when the wizard becomes active; returns the secret/QR/backup codes.
  onSetup: () => Promise<TotpSetupResult>;
  // Caller performs the real confirm + any post-actions; throws ApiError on an invalid code.
  onConfirm: (code: string) => Promise<void>;
  // Invoked when the user clicks Done after viewing their backup codes.
  onFinished: () => void;
  // Optional cancel affordance shown on the scan/verify steps.
  onCancel?: () => void;
  className?: string;
}

type WizardStep = 'scan' | 'verify' | 'backup';

const OTP_LENGTH = 6;

// The wizard's setup/verify state is one cohesive flow (a step machine plus the in-flight/error
// flags for each phase), so it lives in a single reducer rather than a fan of useState calls.
interface WizardState {
  step: WizardStep;
  setupResult: TotpSetupResult | null;
  isLoadingSetup: boolean;
  setupError: string | null;
  code: string;
  isVerifying: boolean;
  verifyError: string | null;
}

const INITIAL_WIZARD_STATE: WizardState = {
  step: 'scan',
  setupResult: null,
  isLoadingSetup: false,
  setupError: null,
  code: '',
  isVerifying: false,
  verifyError: null,
};

type WizardAction =
  | { type: 'setupStart' }
  | { type: 'setupSuccess'; result: TotpSetupResult }
  | { type: 'setupError'; message: string }
  | { type: 'setupSettled' }
  | { type: 'gotoVerify' }
  | { type: 'setCode'; value: string }
  | { type: 'verifyStart' }
  | { type: 'verifySuccess' }
  | { type: 'verifyError'; message: string }
  | { type: 'verifySettled' };

const wizardReducer = (state: WizardState, action: WizardAction): WizardState => {
  switch (action.type) {
    case 'setupStart':
      return { ...state, isLoadingSetup: true, setupError: null };
    case 'setupSuccess':
      return { ...state, setupResult: action.result };
    case 'setupError':
      return { ...state, setupError: action.message };
    case 'setupSettled':
      return { ...state, isLoadingSetup: false };
    case 'gotoVerify':
      return { ...state, step: 'verify' };
    case 'setCode':
      return { ...state, code: action.value, verifyError: null };
    case 'verifyStart':
      return { ...state, isVerifying: true, verifyError: null };
    case 'verifySuccess':
      return { ...state, step: 'backup' };
    case 'verifyError':
      return { ...state, verifyError: action.message, code: '' };
    case 'verifySettled':
      return { ...state, isVerifying: false };
    default:
      return state;
  }
};

const TotpSetupWizard: React.FC<TotpSetupWizardProps> = ({
  onSetup,
  onConfirm,
  onFinished,
  onCancel,
  className,
}) => {
  const { t } = useTranslation('settings');

  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD_STATE);
  const { step, setupResult, isLoadingSetup, setupError, code, isVerifying, verifyError } = state;

  const isMountedRef = useRef(true);
  // Set true on the first /setup attempt and NEVER reset — auto-run fires exactly once per mount,
  // including after a failure. `onSetup` is an inline closure in both callers, so its identity
  // changes on every re-render (e.g. the one triggered by setSetupError); without a sticky guard
  // the effect below would re-fire and retry /setup in a loop, burning the login rate limit and
  // hiding the error. Retrying requires remounting the wizard (the caller reopens the dialog).
  const setupStartedRef = useRef(false);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const runSetup = useCallback(async () => {
    if (setupStartedRef.current || setupResult) return;
    setupStartedRef.current = true;
    dispatch({ type: 'setupStart' });
    try {
      const result = await onSetup();
      if (isMountedRef.current) dispatch({ type: 'setupSuccess', result });
    } catch (err) {
      console.error('Failed to start two-factor setup:', err);
      if (isMountedRef.current) {
        dispatch({
          type: 'setupError',
          message: (err as Error).message || t('twoFactor.invalidCode'),
        });
      }
    } finally {
      // Intentionally NOT resetting setupStartedRef — a failed setup must not auto-retry.
      if (isMountedRef.current) dispatch({ type: 'setupSettled' });
    }
  }, [onSetup, setupResult, t]);

  // Kick the setup call off as soon as the wizard mounts/activates.
  useEffect(() => {
    void runSetup();
  }, [runSetup]);

  const handleVerify = useCallback(
    async (submittedCode: string) => {
      if (isVerifying) return;
      if (submittedCode.length !== OTP_LENGTH) return;
      dispatch({ type: 'verifyStart' });
      try {
        await onConfirm(submittedCode);
        if (isMountedRef.current) dispatch({ type: 'verifySuccess' });
      } catch (err) {
        console.error('Failed to verify two-factor code:', err);
        if (!isMountedRef.current) return;
        const isInvalidCode = err instanceof ApiError && err.errorCode === 'invalid_totp_code';
        dispatch({
          type: 'verifyError',
          message: isInvalidCode
            ? t('twoFactor.invalidCode')
            : (err as Error).message || t('twoFactor.invalidCode'),
        });
      } finally {
        if (isMountedRef.current) dispatch({ type: 'verifySettled' });
      }
    },
    [isVerifying, onConfirm, t],
  );

  const handleCodeChange = (value: string) => {
    dispatch({ type: 'setCode', value });
  };

  const backupCodes = setupResult?.backupCodes ?? [];
  const backupCodesText = backupCodes.join('\n');

  const handleDownloadBackupCodes = useCallback(() => {
    if (backupCodes.length === 0) return;
    downloadTextFile('praetor-backup-codes.txt', `${backupCodesText}\n`);
  }, [backupCodes.length, backupCodesText]);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {step === 'scan' && (
        <div className="flex flex-col gap-5">
          <div className="space-y-1">
            <h3 className="text-lg leading-none font-semibold text-foreground">
              {t('twoFactor.setupTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('twoFactor.scanInstructions')}</p>
          </div>

          {setupError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{setupError}</AlertTitle>
            </Alert>
          )}

          {isLoadingSetup && !setupResult ? (
            <div className="flex items-center justify-center rounded-lg border border-border bg-muted/40 py-12 text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
            </div>
          ) : (
            setupResult && (
              <div className="flex flex-col items-center gap-5">
                <div className="rounded-lg border border-border bg-background p-3">
                  <img
                    src={setupResult.qrDataUri}
                    alt={t('twoFactor.scanInstructions')}
                    className="size-44 [image-rendering:pixelated]"
                  />
                </div>

                <div className="w-full space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('twoFactor.manualKeyLabel')}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-center font-mono text-sm tracking-[0.2em] break-all text-foreground">
                      {setupResult.secret}
                    </code>
                    <CopyButton
                      variant="outline"
                      value={setupResult.secret}
                      label={t('twoFactor.copySecret')}
                      copiedLabel={t('twoFactor.copySecret')}
                      className="shrink-0"
                    />
                  </div>
                </div>
              </div>
            )
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('twoFactor.cancel')}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => dispatch({ type: 'gotoVerify' })}
              disabled={!setupResult || isLoadingSetup}
            >
              {t('common:buttons.next', { defaultValue: 'Next' })}
            </Button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="flex flex-col gap-5">
          <div className="space-y-1">
            <h3 className="text-lg leading-none font-semibold text-foreground">
              {t('twoFactor.setupTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('twoFactor.enterCodeLabel')}</p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleVerify(code);
            }}
            className="flex flex-col items-center gap-4"
          >
            <InputOTP
              maxLength={OTP_LENGTH}
              value={code}
              onChange={handleCodeChange}
              onComplete={(value) => void handleVerify(value)}
              pattern={REGEXP_ONLY_DIGITS}
              disabled={isVerifying}
              autoFocus
              aria-invalid={verifyError ? true : undefined}
              aria-label={t('twoFactor.enterCodeLabel')}
              containerClassName="justify-center"
            >
              <InputOTPGroup>
                {Array.from({ length: OTP_LENGTH }, (_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    aria-invalid={verifyError ? true : undefined}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>

            {verifyError && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>{verifyError}</AlertTitle>
              </Alert>
            )}

            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} disabled={isVerifying}>
                  {t('twoFactor.cancel')}
                </Button>
              )}
              <Button type="submit" disabled={isVerifying || code.length !== OTP_LENGTH}>
                {isVerifying ? (
                  <>
                    <Loader2 aria-hidden="true" className="animate-spin" />
                    {t('twoFactor.verifying')}
                  </>
                ) : (
                  t('twoFactor.verify')
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {step === 'backup' && (
        <div className="flex flex-col gap-5">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-lg leading-none font-semibold text-foreground">
              <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
              {t('twoFactor.backupTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('twoFactor.backupInstructions')}</p>
          </div>

          <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-4">
            {backupCodes.map((backupCode) => (
              <li
                key={backupCode}
                className="rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-sm tracking-[0.15em] text-foreground"
              >
                {backupCode}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <CopyButton
              variant="outline"
              value={backupCodesText}
              label={t('twoFactor.copyCodes')}
              copiedLabel={t('twoFactor.copyCodes')}
            />
            <Button type="button" variant="outline" onClick={handleDownloadBackupCodes}>
              {t('twoFactor.downloadCodes')}
            </Button>
            <Button type="button" onClick={onFinished}>
              {t('twoFactor.done')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TotpSetupWizard;
