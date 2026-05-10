import type React from 'react';
import { Switch } from '@/components/ui/switch';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  partial?: boolean;
  disabled?: boolean;
}

const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  partial = false,
  disabled = false,
}) => {
  return (
    <Switch
      checked={checked || partial}
      onCheckedChange={() => onChange(!checked)}
      disabled={disabled}
    />
  );
};

export default Toggle;
