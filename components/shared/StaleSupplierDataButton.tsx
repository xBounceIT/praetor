import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The per-line "Old info — update?" chip (#779 reverse sync): shown on a supplier-sourced line
 * whose stored quantity/cost lag the live supplier item; clicking pulls the current values back
 * into the line. One component for the four render sites (quotes/offers × mobile/desktop) so the
 * affordance can't drift between them — positioning stays with the caller via className.
 */
const StaleSupplierDataButton: React.FC<{
  onClick: () => void;
  className?: string;
}> = ({ onClick, className }) => {
  const { t } = useTranslation(['sales']);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        'h-5 px-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 border-amber-400/60 bg-amber-50 hover:bg-amber-100 hover:text-amber-800',
        className,
      )}
    >
      {t('sales:clientQuotes.staleSupplierData', { defaultValue: 'Old info — update?' })}
    </Button>
  );
};

export default StaleSupplierDataButton;
