import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from './locales/en/common.json';
import enLayout from './locales/en/layout.json';
import enAuth from './locales/en/auth.json';
import enTimesheets from './locales/en/timesheets.json';
import enCrm from './locales/en/crm.json';
import enHr from './locales/en/hr.json';
import enProjects from './locales/en/projects.json';
import enFinances from './locales/en/finances.json';
import enSuppliers from './locales/en/suppliers.json';
import enSettings from './locales/en/settings.json';
import enNotifications from './locales/en/notifications.json';
import itCommon from './locales/it/common.json';
import itLayout from './locales/it/layout.json';
import itAuth from './locales/it/auth.json';
import itTimesheets from './locales/it/timesheets.json';
import itCrm from './locales/it/crm.json';
import itHr from './locales/it/hr.json';
import itProjects from './locales/it/projects.json';
import itFinances from './locales/it/finances.json';
import itSuppliers from './locales/it/suppliers.json';
import itSettings from './locales/it/settings.json';
import itNotifications from './locales/it/notifications.json';

const resources = {
  en: {
    common: enCommon,
    form: enCommon.form,
    layout: enLayout,
    auth: enAuth,
    timesheets: enTimesheets,
    crm: enCrm,
    hr: enHr,
    projects: enProjects,
    finances: enFinances,
    suppliers: enSuppliers,
    settings: enSettings,
    notifications: enNotifications
  },
  it: {
    common: itCommon,
    form: itCommon.form,
    layout: itLayout,
    auth: itAuth,
    timesheets: itTimesheets,
    crm: itCrm,
    hr: itHr,
    projects: itProjects,
    finances: itFinances,
    suppliers: itSuppliers,
    settings: itSettings,
    notifications: itNotifications
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'form', 'layout', 'auth', 'timesheets', 'crm', 'hr', 'projects', 'finances', 'suppliers', 'settings', 'notifications'],
    resources,
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupQuerystring: 'lng',
      lookupLocalStorage: 'i18nextLng'
    },
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
