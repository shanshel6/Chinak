import React from 'react';
import { Search, SearchX, ChevronLeft } from 'lucide-react';

interface SearchEmptyStateProps {
  query: string;
  popularSearches: string[];
  onSelect: (query: string) => void;
}

const SearchEmptyState: React.FC<SearchEmptyStateProps> = ({
  query,
  popularSearches,
  onSelect,
}) => {
  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="w-32 h-32 relative mb-8">
          <div className="absolute inset-0 bg-primary/5 rounded-full animate-pulse"></div>
          <div className="absolute inset-4 bg-primary/10 rounded-full animate-pulse delay-75"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Search size={60} className="text-primary" />
          </div>
        </div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">ابحث عن ما تحتاجه</h3>
        <p className="text-slate-500 text-sm max-w-[240px]">
          اكتشف آلاف المنتجات المميزة بأفضل الأسعار. جرب البحث عن ماركة أو نوع منتج.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-24 h-24 bg-slate-50 dark:bg-slate-800/50 rounded-full flex items-center justify-center mb-6">
        <SearchX size={60} className="text-slate-300" />
      </div>
      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">لم نجد نتائج لـ "{query}"</h3>
      <p className="text-slate-500 text-sm mb-8 leading-relaxed">
        تأكد من كتابة الكلمة بشكل صحيح أو جرب كلمات بحث أخرى مثل "سماعات" أو "أحذية".
      </p>
      <div className="w-full max-w-xs space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">اقتراحات لك</p>
        {popularSearches.slice(0, 3).map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s)}
            className="w-full flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-primary transition-all group"
          >
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{s}</span>
            <ChevronLeft size={20} className="text-slate-300 group-hover:text-primary transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default SearchEmptyState;
