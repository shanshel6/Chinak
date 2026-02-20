import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Search, Bell } from 'lucide-react';

interface SearchBarProps {
  onNavigate: (path: string) => void;
  unreadNotificationsCount?: number;
}

const SearchBar: React.FC<SearchBarProps> = ({ 
  onNavigate,
  unreadNotificationsCount = 0
}) => {
  const { t } = useTranslation();
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const placeholders = [
    t('common.search_placeholder'),
    'ابحث عن أحدث الهواتف...',
    'عروض خاصة على الساعات الذكية',
    'أفضل أنواع العطور العالمية',
    'تسوق ملابس شتوية جديدة'
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [placeholders.length]);

  return (
    <div className="px-4 py-2 bg-transparent transition-all duration-300">
      <div className="flex items-center justify-center gap-2">
        <div 
          onClick={() => onNavigate('/search')}
          className="relative flex-1 max-w-lg flex items-center group cursor-pointer"
        >
          <div className="relative flex-1 flex items-center bg-white/80 dark:bg-slate-800/80 rounded-full h-11 shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700/60 transition-all group-hover:shadow-md group-hover:ring-primary/25 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center justify-center w-10 text-primary group-hover:scale-110 transition-transform duration-300">
              <Search size={18} strokeWidth={2.5} />
            </div>

            <div className="flex-1 relative h-full flex items-center overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.span
                  key={placeholderIndex}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                  className="text-slate-400 text-[13px] font-semibold whitespace-nowrap"
                >
                  {placeholders[placeholderIndex]}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </div>

        <button 
          onClick={() => onNavigate('/notifications')}
          className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/80 dark:bg-slate-800/80 shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700/60 text-slate-600 dark:text-slate-300 transition-all hover:text-primary active:scale-95 backdrop-blur-xl"
        >
          <Bell size={20} strokeWidth={2} />
          {unreadNotificationsCount > 0 && (
            <span className="absolute top-2.5 right-2.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800 animate-pulse"></span>
          )}
        </button>
      </div>
    </div>
  );
};

export default SearchBar;
