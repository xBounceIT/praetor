import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import enAccounting from './locales/en/accounting.json';
import enAdministration from './locales/en/administration.json';
import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enCrm from './locales/en/crm.json';
import enFinances from './locales/en/finances.json';
import enHr from './locales/en/hr.json';
import enLayout from './locales/en/layout.json';
import enNotifications from './locales/en/notifications.json';
import enProjects from './locales/en/projects.json';
import enSales from './locales/en/sales.json';
import enSettings from './locales/en/settings.json';
import enSuppliers from './locales/en/suppliers.json';
import enTimesheets from './locales/en/timesheets.json';
import itAccounting from './locales/it/accounting.json';
import itAdministration from './locales/it/administration.json';
import itAuth from './locales/it/auth.json';
import itCommon from './locales/it/common.json';
import itCrm from './locales/it/crm.json';
import itFinances from './locales/it/finances.json';
import itHr from './locales/it/hr.json';
import itLayout from './locales/it/layout.json';
import itNotifications from './locales/it/notifications.json';
import itProjects from './locales/it/projects.json';
import itSales from './locales/it/sales.json';
import itSettings from './locales/it/settings.json';
import itSuppliers from './locales/it/suppliers.json';
import itTimesheets from './locales/it/timesheets.json';

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
    notifications: enNotifications,
    accounting: enAccounting,
    sales: enSales,
    administration: enAdministration,
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
    notifications: itNotifications,
    accounting: itAccounting,
    sales: itSales,
    administration: itAdministration,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common',
      'form',
      'layout',
      'auth',
      'timesheets',
      'crm',
      'hr',
      'projects',
      'finances',
      'suppliers',
      'settings',
      'notifications',
      'accounting',
      'sales',
      'administration',
    ],
    resources,
    detection: {
      order: ['querystring', 'navigator'],
      caches: [],
      lookupQuerystring: 'lng',
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
