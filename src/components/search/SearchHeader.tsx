import React, { useEffect, useRef } from 'react';
import { Home, Search, X } from 'lucide-react';

interface SearchHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  onFocus: () => void;
  onClear: () => void;
  onSubmit?: () => void;
}

const SearchHeader: React.FC<SearchHeaderProps> = ({
  query,
  onQueryChange,
  onBack,
  onFocus,
  onClear,
  onSubmit,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus immediately on mount with a small delay to ensure transition is done
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="bg-transparent px-4 py-2 transition-all duration-300">
      <div className="flex items-center justify-center gap-4">
        <button 
          onClick={onBack}
          className="p-2 -mr-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <Home size={24} />
        </button>

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (onSubmit) onSubmit();
            (document.activeElement as HTMLElement)?.blur();
          }}
          className="flex-1 relative group"
        >
          <div className="relative flex items-center bg-slate-100 dark:bg-slate-800 rounded-full h-10 transition-all focus-within:ring-2 focus-within:ring-primary/20 overflow-hidden">
            <div className="flex items-center justify-center w-10 text-slate-400">
              <Search size={16} strokeWidth={2.5} />
            </div>

            <input 
              ref={inputRef}
              className="flex-1 bg-transparent border-none py-1.5 pr-0 pl-10 text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-0 outline-none transition-all" 
              type="text" 
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={onFocus}
              placeholder="ابحث عن منتج..."
              enterKeyHint="search"
            />

            {query && (
              <button 
                type="button"
                onClick={onClear}
                className="absolute inset-y-0 left-3 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </form>

        <button 
          onClick={() => {
            if (onSubmit) onSubmit();
          }}
          className="px-4 py-1.5 bg-primary text-white text-sm font-bold rounded-full shadow-sm hover:bg-primary/90 active:scale-95 transition-all"
        >
          بحث
        </button>
      </div>
    </div>
  );
};

export default SearchHeader;
