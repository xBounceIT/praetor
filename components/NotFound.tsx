import type React from 'react';
import { useTranslation } from 'react-i18next';

export interface NotFoundProps {
  onReturn: () => void;
}

const NotFound: React.FC<NotFoundProps> = ({ onReturn }) => {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4 animate-in fade-in zoom-in duration-500">
      <div className="relative mb-8">
        <div className="text-9xl font-black text-slate-100 select-none">404</div>
        <div className="absolute inset-0 flex items-center justify-center">
          <i className="fa-solid fa-compass-slash text-6xl text-praetor animate-bounce"></i>
        </div>
      </div>

      <h2 className="text-3xl font-black text-slate-800 mb-4">{t('notFound.title')}</h2>
      <p className="text-slate-500 max-w-md mb-8 leading-relaxed">{t('notFound.message')}</p>

      <button
        onClick={onReturn}
        className="px-8 py-3 bg-praetor text-white font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 hover:-translate-y-0.5 transition-all flex items-center gap-2 group"
      >
        <i className="fa-solid fa-house-chimney text-sm transition-transform group-hover:scale-110"></i>
        {t('notFound.return')}
      </button>

      <div className="mt-12 grid grid-cols-3 gap-4 w-full max-w-lg opacity-30 select-none">
        <div className="h-1 bg-slate-200 rounded-full"></div>
        <div className="h-1 bg-praetor rounded-full opacity-50"></div>
        <div className="h-1 bg-slate-200 rounded-full"></div>
      </div>
    </div>
  );
};

export default NotFound;
