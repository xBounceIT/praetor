import { createContext, use } from 'react';
import type { ResolvedTheme } from '@/utils/theme';

export const ModalThemeContext = createContext<ResolvedTheme | null>(null);

export const useModalTheme = () => use(ModalThemeContext);
