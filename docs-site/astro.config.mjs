import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  base: '/docs',
  trailingSlash: 'always',
  integrations: [
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
