import React from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Bell } from 'lucide-react';

interface HomeHeaderProps {
  user: any;
  onNavigate: (path: string) => void;
  unreadNotificationsCount: number;
}

const HomeHeader: React.FC<HomeHeaderProps> = ({
  user,
  onNavigate,
  unreadNotificationsCount,
}) => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-background-light/90 dark:bg-background-dark/90 backdrop-blur-md px-4 py-3 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-start gap-0.5">
          <div className="flex items-center gap-1 text-primary">
            <MapPin size={16} strokeWidth={2.5} />
            <span className="text-xs font-bold">{t('common.baghdad')}</span>
          </div>
          <h2 className="text-lg font-bold leading-tight text-slate-900 dark:text-white">
            {t('common.welcome', { name: user?.name || t('common.guest') })} 👋
          </h2>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button 
          onClick={() => onNavigate('/notifications')}
          className="relative flex size-10 items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10 text-slate-600 dark:text-slate-300 transition hover:text-primary"
        >
          <Bell size={20} />
          {unreadNotificationsCount > 0 && (
            <span className="absolute top-2 right-2.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800 animate-pulse"></span>
          )}
        </button>
      </div>
    </header>
  );
};

export default HomeHeader;
