import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

export type SecretFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isStored: boolean;
  isReplacing: boolean;
  onStartReplace: () => void;
  onCancelReplace: () => void;
  storedLabel: string;
  storedHelp: string;
  multiline?: boolean;
  monospace?: boolean;
  error?: string;
  testId?: string;
  disabled?: boolean;
};

// Stored secrets arrive from the server pre-masked. Typing into a populated field would silently
// overwrite the real value with mask + extra characters (issue #601), so Stored mode hides the
// input behind a Replace badge until the admin explicitly opts in. Cancelling restores the mask
// so it round-trips back to the server unchanged.
//
// Built from shadcn primitives (Field/FieldLabel/Input/Textarea/Badge) and theme tokens so the
// label and input match the native fields rendered alongside it (and respect every theme).
const SecretField: React.FC<SecretFieldProps> = ({
  label,
  value,
  onChange,
  isStored,
  isReplacing,
  onStartReplace,
  onCancelReplace,
  storedLabel,
  storedHelp,
  multiline,
  monospace,
  error,
  testId,
  disabled = false,
}) => {
  const { t } = useTranslation('common');
  const replaceLabel = t('secretField.replace', 'Replace');
  const keepStoredLabel = t('secretField.keepStored', 'Keep stored value');

  if (isStored && !isReplacing) {
    return (
      <Field data-testid={testId}>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-center gap-3 rounded-md border border-input bg-muted/50 px-3 py-2">
          <Badge variant="secondary" className="gap-1.5">
            <i className="fa-solid fa-lock" aria-hidden="true"></i>
            {storedLabel}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onStartReplace}
            disabled={disabled}
            data-testid={testId ? `${testId}-replace` : undefined}
          >
            {replaceLabel}
          </Button>
        </div>
        <FieldDescription>{storedHelp}</FieldDescription>
      </Field>
    );
  }

  const inputClassName = monospace ? 'font-mono' : undefined;
  const isInvalid = error ? true : undefined;

  return (
    <Field data-testid={testId} data-invalid={isInvalid}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        {isReplacing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onCancelReplace}
            disabled={disabled}
            data-testid={testId ? `${testId}-keep-stored` : undefined}
          >
            {keepStoredLabel}
          </Button>
        )}
      </div>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
          aria-label={label}
          aria-invalid={isInvalid}
          className={inputClassName}
          data-testid={testId ? `${testId}-input` : undefined}
          disabled={disabled}
        />
      ) : (
        <Input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          aria-invalid={isInvalid}
          className={inputClassName}
          data-testid={testId ? `${testId}-input` : undefined}
          disabled={disabled}
        />
      )}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
};

export default SecretField;
