import type React from 'react';
import { useId } from 'react';
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
  const partialDescriptionId = useId();
  const isPartial = partial && !checked;

  return (
    <>
      <Switch
        checked={checked || partial}
        onCheckedChange={() => onChange(!checked)}
        disabled={disabled}
        aria-describedby={isPartial ? partialDescriptionId : undefined}
        className={isPartial ? 'data-[state=checked]:bg-primary/50' : undefined}
      />
      {isPartial && (
        <span id={partialDescriptionId} className="sr-only">
          Partially selected
        </span>
      )}
    </>
  );
};

export default Toggle;
