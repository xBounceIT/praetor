export type Theme = 'default' | 'tempo';

export const THEMES: Record<Theme, Record<string, string>> = {
  default: {
    '--color-primary': '#20293F',
    '--color-primary-hover': '#2d3a55',
  },
  tempo: {
    '--color-primary': '#4F46E5', // Indigo-600
    '--color-primary-hover': '#4338ca', // Indigo-700
  },
};

export const getTheme = (): Theme => {
  const saved = localStorage.getItem('praetor_theme');
  return saved === 'tempo' || saved === 'default' ? saved : 'default';
};

export const applyTheme = (theme: Theme) => {
  const colors = THEMES[theme];
  const root = document.documentElement;

  Object.entries(colors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });

  localStorage.setItem('praetor_theme', theme);
};
