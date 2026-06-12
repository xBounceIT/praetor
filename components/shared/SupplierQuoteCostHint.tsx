import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Small shadcn tooltip shown next to a cost field whose value is driven by a
 * linked supplier quote. The trigger is an icon (not the input) on purpose:
 * wrapping the cost input itself in a Radix TooltipTrigger collapses the cell
 * in the editor grid, so we follow the same icon-trigger pattern every other
 * tooltip in the app uses.
 *
 * The default copy promises the #779 forward sync ("edits update the supplier
 * quote too"), which only the client-quote and client-offer routes implement —
 * contexts without the sync (e.g. client orders) must pass their own
 * `descriptionKey` so the tooltip doesn't overpromise.
 */
const SupplierQuoteCostHint: React.FC<{ descriptionKey?: string }> = ({
  descriptionKey = 'clientQuotes.supplierQuoteCostTooltip',
}) => {
  const { t } = useTranslation('sales');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 cursor-help">
          <i className="fa-solid fa-circle-info text-[10px] text-zinc-400 transition-colors hover:text-zinc-600" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{t(descriptionKey)}</TooltipContent>
    </Tooltip>
  );
};

export default SupplierQuoteCostHint;
