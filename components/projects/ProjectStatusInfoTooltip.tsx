import { Info } from 'lucide-react';
import type React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PROJECT_STATUSES } from '../../types';
import { getProjectStatusIcon, PROJECT_STATUS_ICON_CLASS_NAME } from './projectStatusUi';

export const ProjectStatusInfoTooltip: React.FC<{ t: (key: string) => string }> = ({ t }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t('projects:projects.statusHelpLabel')}
      >
        <Info className="h-3 w-3" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs">
      <div className="space-y-1">
        {PROJECT_STATUSES.map((status) => (
          <p key={status} className="flex items-start gap-2">
            {getProjectStatusIcon(status, `mt-0.5 ${PROJECT_STATUS_ICON_CLASS_NAME}`)}
            <span>
              <span className="font-semibold">
                {t(`projects:projects.statusValues.${status}`)}:
              </span>{' '}
              {t(`projects:projects.statusHelp.${status}`)}
            </span>
          </p>
        ))}
      </div>
    </TooltipContent>
  </Tooltip>
);
