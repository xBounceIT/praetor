import { Plus } from 'lucide-react';
import type React from 'react';
import { Button } from '@/components/ui/button';

type HeaderAddButtonSize = 'default' | 'tall' | 'wide';

const sizeClasses: Record<HeaderAddButtonSize, string> = {
  default: 'h-auto px-5 py-2.5 has-[>svg]:px-5',
  tall: 'h-auto px-5 py-3 has-[>svg]:px-5',
  wide: 'h-auto px-6 py-3 has-[>svg]:px-6',
};

interface HeaderAddButtonProps {
  children: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  actionSize?: HeaderAddButtonSize;
}

const HeaderAddButton: React.FC<HeaderAddButtonProps> = ({
  children,
  onClick,
  actionSize = 'default',
}) => (
  <Button
    type="button"
    variant="default"
    onClick={onClick}
    className={`${sizeClasses[actionSize]} max-w-full whitespace-normal text-center`}
  >
    <Plus data-icon="inline-start" />
    {children}
  </Button>
);

export default HeaderAddButton;
