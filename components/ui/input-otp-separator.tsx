import { MinusIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

function InputOTPSeparator({ ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="input-otp-separator" aria-hidden="true" {...props}>
      <MinusIcon />
    </div>
  );
}

export { InputOTPSeparator };
