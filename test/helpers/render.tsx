import type { RenderOptions, RenderResult } from '@testing-library/react';
import { render as rtlRender } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '../../components/ui/tooltip';

export const render = (ui: ReactNode, options?: RenderOptions): RenderResult => {
  const result = rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);
  const rerender = (nextUi: ReactNode) =>
    result.rerender(<TooltipProvider>{nextUi}</TooltipProvider>);
  return { ...result, rerender };
};
