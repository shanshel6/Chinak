import React from 'react';
import { Tag, Banknote, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export type ConditionFilter = 'new' | 'used' | null;
export type PriceFilter = '1k' | '5k' | '10k' | '25k' | null;

interface FilterBarProps {
  condition: ConditionFilter;
  price: PriceFilter;
  onConditionChange: (condition: ConditionFilter) => void;
  onPriceChange: (price: PriceFilter) => void;
  appliedCondition?: ConditionFilter;
  appliedPrice?: PriceFilter;
  onApply?: () => void;
  className?: string;
}

const FilterBar: React.FC<FilterBarProps> = ({ 
  condition, 
  price, 
  onConditionChange, 
  onPriceChange,
  appliedCondition,
  appliedPrice,
  onApply,
  className = '' 
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resolvedAppliedCondition = typeof appliedCondition === 'undefined' ? condition : appliedCondition;
  const resolvedAppliedPrice = typeof appliedPrice === 'undefined' ? price : appliedPrice;
  const isDirty = resolvedAppliedCondition !== condition || resolvedAppliedPrice !== price;
  const showApplyButton = Boolean(onApply) && isDirty;

  return (
    <div className={`relative w-full py-2 ${className}`}>
      {showApplyButton && (
        <div className="absolute left-4 top-1/2 z-10 -translate-y-1/2">
          <button
            onClick={onApply}
            className="px-3 py-1.5 rounded-full text-xs font-black bg-primary text-white shadow-sm hover:opacity-95 transition-opacity whitespace-nowrap"
          >
            {t('filter.apply', 'تطبيق')}
          </button>
        </div>
      )}

      <div className={`w-full overflow-x-auto no-scrollbar px-4 flex items-center gap-3 ${showApplyButton ? 'pl-24' : ''}`}>
        
        {/* Search Trigger */}
        <button
          onClick={() => navigate('/search')}
          className="flex items-center justify-center size-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0"
        >
          <Search size={16} />
        </button>

        {/* Condition Filters */}
        <div className="flex items-center gap-2 border-r border-slate-200 dark:border-slate-700 pr-3 pl-1 shrink-0">
          <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
            <Tag size={12} />
            {t('filter.condition', 'الحالة')}
          </span>
          
          <button
            onClick={() => onConditionChange(condition === 'new' ? null : 'new')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              condition === 'new'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {t('filter.new', 'جديد')}
          </button>

          <button
            onClick={() => onConditionChange(condition === 'used' ? null : 'used')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              condition === 'used'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {t('filter.used', 'مستعمل')}
          </button>
        </div>

        {/* Price Filters */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
            <Banknote size={12} />
            {t('filter.price', 'السعر')}
          </span>

          {[
            { id: '1k', label: '< 1,000' },
            { id: '5k', label: '< 5,000' },
            { id: '10k', label: '< 10,000' },
            { id: '25k', label: '< 25,000' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onPriceChange(price === item.id as PriceFilter ? null : item.id as PriceFilter)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap dir-ltr ${
                price === item.id
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
};

export default FilterBar;
