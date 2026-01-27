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
    <div className="px-5 py-3 bg-background-light dark:bg-background-dark transition-all duration-300">
      <div className="flex items-center gap-4">
        <div 
          onClick={() => onNavigate('/search')}
          className="relative flex-1 flex items-center group cursor-pointer"
        >
          <div className="relative flex-1 flex items-center bg-white dark:bg-slate-800 rounded-2xl h-[52px] shadow-sm ring-1 ring-slate-100 dark:ring-white/5 transition-all group-hover:shadow-md group-hover:ring-primary/20 overflow-hidden">
            {/* Right Icon (Search) */}
            <div className="flex items-center justify-center w-12 text-primary group-hover:scale-110 transition-transform duration-300">
              <Search size={22} strokeWidth={2.5} />
            </div>

            {/* Animated Placeholders */}
            <div className="flex-1 relative h-full flex items-center overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.span
                  key={placeholderIndex}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                  className="text-slate-400 text-[13px] font-bold whitespace-nowrap"
                >
                  {placeholders[placeholderIndex]}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Left Action Button (Visual Only) */}
            <div className="flex items-center px-3 h-full border-r border-slate-50 dark:border-slate-700/50">
              <div className="bg-primary text-white text-[11px] font-black px-4 py-2 rounded-xl uppercase tracking-wider shadow-sm group-hover:bg-primary/90 transition-colors">
                بحث
              </div>
            </div>
          </div>
        </div>

        {/* Notification Icon */}
        <button 
          onClick={() => onNavigate('/notifications')}
          className="relative flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-2xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-100 dark:ring-white/5 text-slate-600 dark:text-slate-300 transition-all hover:text-primary active:scale-95"
        >
          <Bell size={24} strokeWidth={2} />
          {unreadNotificationsCount > 0 && (
            <span className="absolute top-3.5 right-3.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800 animate-pulse"></span>
          )}
        </button>
      </div>
    </div>
  );
};

export default SearchBar;
