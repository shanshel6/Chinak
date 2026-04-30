import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, PackageSearch } from 'lucide-react';
import { fetchCategoriesWithProducts } from '../services/api';
import type { CategoryWithProducts } from '../services/api';

const FALLBACK_ICONS: Record<string, string> = {
  electronics: 'mdi mdi-cellphone',
  fashion: 'mdi mdi-hanger',
  clothing: 'mdi mdi-tshirt-crew',
  shoes: 'mdi mdi-shoe-sneaker',
  beauty: 'mdi mdi-bottle-tonic-plus',
  health: 'mdi mdi-heart-pulse',
  home: 'mdi mdi-home',
  furniture: 'mdi mdi-sofa',
  kitchen: 'mdi mdi-silverware-fork-knife',
  sports: 'mdi mdi-basketball',
  toys: 'mdi mdi-toy-brick',
  baby: 'mdi mdi-baby-carriage',
  automotive: 'mdi mdi-car',
  tools: 'mdi mdi-tools',
  books: 'mdi mdi-book-open-variant',
  pet: 'mdi mdi-paw',
  gaming: 'mdi mdi-gamepad-variant',
  jewelry: 'mdi mdi-ring',
  watch: 'mdi mdi-watch',
  bag: 'mdi mdi-bag-personal',
  camping: 'mdi mdi-tent',
  default: 'mdi mdi-tag-outline',
};

const getCategoryIcon = (slug: string) => {
  for (const [key, icon] of Object.entries(FALLBACK_ICONS)) {
    if (slug.includes(key)) return icon;
  }
  return FALLBACK_ICONS.default;
};

const Categories: React.FC = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryWithProducts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const result = await fetchCategoriesWithProducts(1, 100);
        if (!cancelled) {
          setCategories(result.categories);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError('فشل تحميل التصنيفات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = (category: CategoryWithProducts) => {
    const q = category.nameAr || category.nameEn || category.id;
    navigate(`/search?q=${encodeURIComponent(q)}&categoryId=${encodeURIComponent(category.id)}`);
  };

  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 pt-safe bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5 cursor-pointer" onClick={() => navigate('/search')}>
          <Search size={18} className="text-slate-400" />
          <span className="text-sm text-slate-400 font-medium">ابحث عن منتجات...</span>
        </div>
      </div>

      <div className="flex-1 p-4 pb-24">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="size-12 rounded-full border-2 border-t-transparent border-primary animate-spin" />
            <p className="text-sm text-slate-500">جاري تحميل التصنيفات...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <p className="text-red-500 font-medium">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {!loading && !error && categories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="size-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
              <PackageSearch size={40} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">لا توجد تصنيفات حالياً</h3>
            <p className="text-slate-500 text-sm max-w-[260px]">
              سيتم إنشاء التصنيفات تلقائياً عند معالجة المنتجات
            </p>
          </div>
        )}

        {!loading && !error && categories.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleSearch(cat)}
                className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors cursor-pointer active:scale-95"
              >
                <div className="size-14 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center shadow-sm">
                  <i className={`${getCategoryIcon(cat.id)} text-2xl text-primary leading-none`} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 leading-tight">
                    {cat.nameAr || cat.nameEn || cat.id}
                  </p>
                  {cat.productCount > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      {cat.productCount} منتج{cat.productCount > 1 ? 'ات' : ''}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Categories;
