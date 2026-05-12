import { createContext, useContext } from 'react';
import type { ResolvedTheme } from '@/utils/theme';

export const ModalThemeContext = createContext<ResolvedTheme | null>(null);

export const useModalTheme = () => useContext(ModalThemeContext);
