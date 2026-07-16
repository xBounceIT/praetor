import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// Starlight adds @astrojs/sitemap automatically unless an integration with this
// name is already registered. Praetor's docs are deployed under an operator-
// selected origin, so there is no truthful absolute `site` URL at build time.
const sitemapDisabledWithoutSite = {
  name: '@astrojs/sitemap',
  hooks: {},
};

export default defineConfig({
  base: '/docs',
  trailingSlash: 'always',
  integrations: [
    sitemapDisabledWithoutSite,
    starlight({
      title: 'Praetor',
      description: 'Documentazione utente della piattaforma Praetor.',
      disable404Route: true,
      defaultLocale: 'root',
      locales: {
        root: {
          label: 'Italiano',
          lang: 'it',
        },
        en: {
          label: 'English',
          lang: 'en',
        },
      },
      sidebar: [
        {
          label: 'Uso della piattaforma',
          translations: { en: 'Using the platform' },
          items: [
            'getting-started',
            'time-tracking',
            'crm-projects',
            'sales-accounting',
            'time-report',
            'ai-reporting',
            'administration',
            'faq',
          ],
        },
        {
          label: 'Documentazione tecnica',
          translations: { en: 'Technical documentation' },
          items: [
            {
              label: 'API',
              link: '/api',
            },
            {
              label: 'Frontend',
              link: '/frontend',
            },
          ],
        },
      ],
    }),
  ],
});
