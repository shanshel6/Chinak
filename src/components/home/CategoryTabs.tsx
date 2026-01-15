import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  icon?: LucideIcon;
}

interface CategoryTabsProps {
  categories: Category[];
  selectedCategoryId: string;
  onSelectCategory: (id: string) => void;
  onHoverCategory?: (id: string) => void;
}

const CategoryTabs: React.FC<CategoryTabsProps> = ({ 
  categories, 
  selectedCategoryId, 
  onSelectCategory,
  onHoverCategory
}) => {
  return (
    <div className="bg-background-light dark:bg-background-dark">
      <div className="flex overflow-x-auto scrollbar-hide py-3 px-4 gap-3">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              onClick={() => onSelectCategory(category.id)}
              onMouseEnter={() => onHoverCategory?.(category.id)}
              className={`flex-none px-5 py-2 rounded-full text-sm font-bold transition-all ${
                selectedCategoryId === category.id
                  ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-105'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 ring-1 ring-slate-900/5 dark:ring-white/10'
              }`}
            >
              <div className="flex items-center gap-2">
                {Icon && <Icon size={18} />}
                <span>{category.name}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryTabs;
