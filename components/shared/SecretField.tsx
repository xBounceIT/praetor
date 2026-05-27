import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

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
};

// Stored secrets arrive from the server pre-masked. Typing into a populated field would silently
// overwrite the real value with mask + extra characters (issue #601), so Stored mode hides the
// input behind a Replace badge until the admin explicitly opts in. Cancelling restores the mask
// so it round-trips back to the server unchanged.
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
}) => {
  const { t } = useTranslation('common');
  const replaceLabel = t('secretField.replace', 'Replace');
  const keepStoredLabel = t('secretField.keepStored', 'Keep stored value');

  if (isStored && !isReplacing) {
    return (
      <div data-testid={testId}>
        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
          {label}
        </label>
        <div className="flex items-center gap-3 px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
            <i className="fa-solid fa-lock"></i>
            {storedLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs font-bold ml-auto"
            onClick={onStartReplace}
            data-testid={testId ? `${testId}-replace` : undefined}
          >
            {replaceLabel}
          </Button>
        </div>
        <p className="text-[10px] text-zinc-400 italic mt-1">{storedHelp}</p>
      </div>
    );
  }

  const baseClass = `w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 outline-none text-sm ${monospace ? 'font-mono' : 'font-semibold text-zinc-700'} ${error ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`;

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
          {label}
        </label>
        {isReplacing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-[10px] font-bold text-muted-foreground hover:text-foreground h-6 px-2"
            onClick={onCancelReplace}
            data-testid={testId ? `${testId}-keep-stored` : undefined}
          >
            {keepStoredLabel}
          </Button>
        )}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
          aria-label={label}
          className={baseClass}
          data-testid={testId ? `${testId}-input` : undefined}
        />
      ) : (
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className={baseClass}
          data-testid={testId ? `${testId}-input` : undefined}
        />
      )}
      {error && <p className="text-red-500 text-[10px] font-bold mt-1">{error}</p>}
    </div>
  );
};

export default SecretField;
