import { Check, Copy } from 'lucide-react';
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { writeTextToClipboard } from '@/utils/clipboard';

type CopyValueResolver = () => string | null | Promise<string | null>;

export type CopyButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'onClick' | 'children' | 'value'
> & {
  // String to copy, or a function called at click time to resolve it.
  // Returning `null` from the resolver aborts (no clipboard write, no copied state).
  value: string | CopyValueResolver;
  // Called when the clipboard write fails. The button does NOT enter copied state.
  onCopyError?: (err: unknown) => void;
  // Hides the visible label; caller must supply `aria-label`.
  iconOnly?: boolean;
  label?: React.ReactNode;
  copiedLabel?: React.ReactNode;
  resetMs?: number;
};

const copyIconState = (visible: boolean) =>
  cn('absolute inset-0 transition-all', visible ? 'scale-100 opacity-100' : 'scale-0 opacity-0');

function CopyButton({
  value,
  onCopyError,
  iconOnly = false,
  label,
  copiedLabel,
  resetMs = 1500,
  variant = 'outline',
  size,
  className,
  disabled: externalDisabled,
  ...buttonProps
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copyValueToClipboard = async () => {
    try {
      const text = typeof value === 'function' ? await value() : value;
      if (text == null) return;
      const ok = await writeTextToClipboard(text);
      if (!ok) {
        onCopyError?.(new Error('Clipboard write rejected'));
        return;
      }
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), resetMs);
    } catch (err) {
      onCopyError?.(err);
    }
  };

  return (
    <Button
      {...buttonProps}
      type={buttonProps.type ?? 'button'}
      variant={variant}
      size={size ?? (iconOnly ? 'icon-sm' : undefined)}
      onClick={copyValueToClipboard}
      disabled={copied || externalDisabled}
      className={cn(copied && 'disabled:opacity-100', className)}
    >
      <span className="relative inline-block size-4 shrink-0">
        <Check
          aria-hidden="true"
          className={cn(copyIconState(copied), 'stroke-green-600 dark:stroke-green-400')}
        />
        <Copy aria-hidden="true" className={copyIconState(!copied)} />
      </span>
      {!iconOnly && (copied ? copiedLabel : label)}
    </Button>
  );
}

export { CopyButton };
