import React from 'react';
import { ArrowUpDown } from 'lucide-react';

type SortType = 'none' | 'price_asc' | 'price_desc' | 'rating';

interface FilterSortStripProps {
  activeFilter: string;
  sortBy: SortType;
  onFilterChange: (filter: string) => void;
  onSortChange: (sort: SortType) => void;
}

const FilterSortStrip: React.FC<FilterSortStripProps> = ({
  activeFilter,
  sortBy,
  onFilterChange,
  onSortChange,
}) => {
  const sorts: SortType[] = ['none', 'price_asc', 'price_desc', 'rating'];
  
  const handleSortClick = () => {
    const nextSort = sorts[(sorts.indexOf(sortBy) + 1) % sorts.length];
    onSortChange(nextSort);
  };

  const filters = [
    { id: 'all', label: 'الكل' },
    { id: 'top_rated', label: 'الأعلى تقييماً' },
    { id: 'under_25k', label: 'أقل من 25,000' },
  ];

  return (
    <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-4">
      <button 
        onClick={handleSortClick}
        className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 border active:scale-95 transition-all ${
          sortBy !== 'none' 
            ? 'bg-primary text-white border-primary shadow-sm' 
            : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-700 dark:text-slate-300'
        }`}
      >
        <ArrowUpDown size={18} />
        <span className="text-xs font-bold">
          {sortBy === 'none' && 'تصنيف'}
          {sortBy === 'price_asc' && 'الأرخص'}
          {sortBy === 'price_desc' && 'الأغلى'}
          {sortBy === 'rating' && 'التقييم'}
        </span>
      </button>
      
      <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
      
      {filters.map((filter) => (
        <button 
          key={filter.id}
          onClick={() => onFilterChange(filter.id === activeFilter && filter.id !== 'all' ? 'all' : filter.id)}
          className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 shadow-sm active:scale-95 transition-all ${
            activeFilter === filter.id 
              ? 'bg-primary text-white shadow-primary/30' 
              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
          }`}
        >
          <span className="text-xs font-bold">{filter.label}</span>
        </button>
      ))}
    </div>
  );
};

export default FilterSortStrip;
