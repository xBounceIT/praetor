import i18n from '../i18n';

const SUPPORTED_LANGUAGES = ['en', 'it'] as const;

const stripCachedLanguage = (): void => {
  localStorage.removeItem('i18nextLng');
};

export const applyLanguagePreference = async (lang: string | undefined): Promise<void> => {
  if (!lang) return;
  if (lang === 'auto') {
    stripCachedLanguage();
    const browserLang = navigator.language.split('-')[0];
    const detectedLang = (SUPPORTED_LANGUAGES as readonly string[]).includes(browserLang)
      ? browserLang
      : 'en';
    try {
      await i18n.changeLanguage(detectedLang);
    } finally {
      // i18next's localStorage cache writes through on every changeLanguage,
      // so strip the key again — auto mode must re-detect on the next load
      // rather than pin to this run's detected value.
      stripCachedLanguage();
    }
    return;
  }
  localStorage.setItem('i18nextLng', lang);
  await i18n.changeLanguage(lang);
};
