import { Compass, House } from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export interface NotFoundProps {
  onReturn: () => void;
}

const NotFound: React.FC<NotFoundProps> = ({ onReturn }) => {
  const { t } = useTranslation('common');

  return (
    <Empty className="min-h-[70vh] border-none animate-in fade-in zoom-in duration-500">
      <div className="relative flex select-none items-center justify-center">
        <span className="text-[8rem] font-black leading-none tracking-tighter text-muted-foreground/20 sm:text-[10rem]">
          404
        </span>
        <EmptyMedia
          variant="icon"
          className="absolute size-16 rounded-2xl bg-primary/10 text-primary"
        >
          <Compass aria-hidden="true" className="size-8 animate-in fade-in zoom-in duration-500" />
        </EmptyMedia>
      </div>

      <EmptyHeader>
        <EmptyTitle role="heading" aria-level={2} className="text-2xl">
          {t('notFound.title')}
        </EmptyTitle>
        <EmptyDescription>{t('notFound.message')}</EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        <Button size="lg" onClick={onReturn}>
          <House aria-hidden="true" />
          {t('notFound.return')}
        </Button>
      </EmptyContent>
    </Empty>
  );
};

export default NotFound;
