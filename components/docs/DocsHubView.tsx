import { BookOpen, Code2, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

const docsLinks = [
  {
    label: 'Frontend',
    href: '/docs/frontend/index.html',
    icon: Code2,
  },
  {
    label: 'Backend',
    href: '/docs/api',
    icon: Server,
  },
  {
    label: 'App',
    href: '/docs/index.html',
    icon: BookOpen,
  },
];

export default function DocsHubView() {
  const { t } = useTranslation('layout');

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
      <h1 className="text-2xl font-semibold tracking-normal text-foreground">
        {t('docsHub.title')}
      </h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {docsLinks.map(({ label, href, icon: Icon }) => (
          <Button
            key={href}
            asChild
            variant="outline"
            className="h-24 flex-col gap-3 whitespace-normal px-4 py-5 text-base"
          >
            <a href={href}>
              <Icon className="size-5" />
              <span>{label}</span>
            </a>
          </Button>
        ))}
      </div>
    </section>
  );
}
