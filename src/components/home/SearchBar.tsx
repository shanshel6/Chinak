import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

interface SearchBarProps {
  onNavigate: (path: string) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ 
  onNavigate
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
    <div className="px-4 py-2 sticky top-[68px] z-20 bg-background-light dark:bg-background-dark transition-colors">
      <label className="relative flex w-full items-center group">
        <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
          <Search size={20} />
        </div>
        
        <div className="relative w-full overflow-hidden">
          <input
            onClick={() => onNavigate('/search')}
            className="h-12 w-full rounded-2xl border-none bg-white dark:bg-slate-800 pr-11 pl-4 text-sm text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10 focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer transition-all hover:shadow-md"
            readOnly
            type="text"
          />
          <div className="absolute inset-y-0 right-11 flex items-center pointer-events-none overflow-hidden h-full">
            <AnimatePresence mode="wait">
              <motion.span
                key={placeholderIndex}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className="text-slate-400 text-sm whitespace-nowrap"
              >
                {placeholders[placeholderIndex]}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </label>
    </div>
  );
};

export default SearchBar;
