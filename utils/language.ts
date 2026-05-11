import i18n from '../i18n';

const SUPPORTED_LANGUAGES = ['en', 'it'] as const;

export const applyLanguagePreference = (lang: string | undefined): void => {
  if (!lang) return;
  if (lang === 'auto') {
    localStorage.removeItem('i18nextLng');
    const browserLang = navigator.language.split('-')[0];
    const detectedLang = (SUPPORTED_LANGUAGES as readonly string[]).includes(browserLang)
      ? browserLang
      : 'en';
    // changeLanguage triggers the localStorage cache to write the detected language
    // back. For 'auto', re-clear after the call so future reloads keep using the
    // navigator detection instead of pinning to whatever was current.
    void i18n.changeLanguage(detectedLang).finally(() => {
      localStorage.removeItem('i18nextLng');
    });
    return;
  }
  localStorage.setItem('i18nextLng', lang);
  i18n.changeLanguage(lang);
};
