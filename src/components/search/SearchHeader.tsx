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
    <header className="bg-transparent px-3 py-2 transition-all duration-300 pt-safe">
      <div className="flex items-center gap-2">
        <button 
          onClick={onBack}
          className="flex items-center justify-center size-10 rounded-xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200 dark:ring-white/5 text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
        >
          <ArrowRight size={20} />
        </button>
        
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (onSubmit) onSubmit();
            (document.activeElement as HTMLElement)?.blur();
          }}
          className="flex-1 relative group"
        >
          <div className="relative flex items-center bg-white dark:bg-slate-800 rounded-xl h-10 shadow-sm ring-1 ring-slate-200 dark:ring-white/5 transition-all focus-within:ring-primary/30 focus-within:shadow-md overflow-hidden">
            {/* Right Icon (Search) - Reduced size */}
            <div className="flex items-center justify-center w-9 text-primary group-focus-within:scale-110 transition-transform duration-300">
              <Search size={18} strokeWidth={2.5} />
            </div>

            <input 
              className="flex-1 bg-transparent border-none py-1.5 pr-0 pl-8 text-[13px] font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-0 outline-none transition-all" 
              type="text" 
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={onFocus}
              placeholder="ابحث..."
              enterKeyHint="search"
            />

            {query && (
              <button 
                type="button"
                onClick={onClear}
                className="absolute inset-y-0 left-11 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X size={16} />
              </button>
            )}

            {/* Left Action Button (Visual & Functional) - Smaller */}
            <button
              type="submit"
              className="flex items-center px-3 h-full border-r border-slate-100 dark:border-slate-700/50 bg-primary text-white text-[10px] font-black uppercase tracking-wider shadow-sm hover:bg-primary/90 transition-colors"
            >
              بحث
            </button>
          </div>
        </form>

        <button 
          onClick={onCartClick}
          className="relative flex items-center justify-center size-10 rounded-xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200 dark:ring-white/5 text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
        >
          <ShoppingCart size={20} />
          {cartCount > 0 && (
            <span className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white ring-1 ring-white dark:ring-slate-900 shadow-sm">
              {cartCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};

export default SearchHeader;
