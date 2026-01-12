import React from 'react';
import { ArrowRight, Search, X, ShoppingCart } from 'lucide-react';

interface SearchHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  onCartClick: () => void;
  cartCount: number;
  onFocus: () => void;
  onClear: () => void;
  onSubmit?: () => void;
}

const SearchHeader: React.FC<SearchHeaderProps> = ({
  query,
  onQueryChange,
  onBack,
  onCartClick,
  cartCount,
  onFocus,
  onClear,
  onSubmit,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-surface-light dark:bg-surface-dark shadow-sm px-4 py-3 pb-2 transition-colors duration-200">
      <div className="h-1 w-full"></div>
      <div className="flex items-center gap-3">
        <button 
          onClick={onBack}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
        >
          <ArrowRight size={24} />
        </button>
        
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (onSubmit) onSubmit();
            // Blur the input to hide the keyboard
            (document.activeElement as HTMLElement)?.blur();
          }}
          className="flex-1 relative group"
        >
          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
            <Search size={20} className="text-primary" />
          </div>
          <input 
            className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-xl py-2.5 pr-10 pl-10 text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-primary/50 transition-all" 
            type="text" 
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={onFocus}
            placeholder="ابحث عن المنتجات..."
            enterKeyHint="search"
          />
          {query && (
            <button 
              type="button"
              onClick={onClear}
              className="absolute inset-y-0 left-2 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X size={20} />
            </button>
          )}
        </form>

        <button 
          onClick={onCartClick}
          className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
        >
          <ShoppingCart size={26} />
          {cartCount > 0 && (
            <span className="absolute top-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
              {cartCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};

export default SearchHeader;
