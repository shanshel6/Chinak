import React, { useRef, useEffect } from 'react';
import { calculateInclusivePrice } from '../../utils/shipping';
import type { Product } from '../../types/product';

interface SimilarProductsProps {
  products: Product[];
  onProductClick: (id: number | string) => void;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

const SimilarProducts: React.FC<SimilarProductsProps> = ({ products, onProductClick, loading, hasMore, onLoadMore }) => {
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          onLoadMore();
        }
      },
      { threshold: 0.5 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);
  if (loading) {
    return (
      <div className="mb-8 px-5">
        <h3 className="text-slate-900 dark:text-white text-lg font-black mb-4">منتجات مشابهة</h3>
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-40 shrink-0 bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-white/5">
              <div className="p-3 space-y-2">
                <div className="h-8 bg-slate-200 dark:bg-slate-600 rounded animate-pulse" />
                <div className="h-5 w-20 bg-slate-200 dark:bg-slate-600 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (products.length === 0) return null;

  return (
    <div className="mb-8 px-5">
      <h3 className="text-slate-900 dark:text-white text-lg font-black mb-4">منتجات مشابهة</h3>
      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
        {products.map((p) => {
          const variants = p.variants || [];
          
          const minVariant = variants.reduce((min: any, curr: any) => {
            if (!curr.price) return min;
            if (!min) return curr;
            return curr.price < min.price ? curr : min;
          }, null);

          const minPrice = minVariant ? Number(minVariant.price) : Number(p.price);
          
          const effectiveBasePriceIQD = (minVariant && minVariant.basePriceIQD && minVariant.basePriceIQD > 0)
            ? minVariant.basePriceIQD
            : p.basePriceIQD;

          const totalPrice = calculateInclusivePrice(
            minPrice,
            p.domesticShippingFee || 0,
            effectiveBasePriceIQD
          );

          return (
            <div 
              key={p.id}
              onClick={() => onProductClick(p.id)}
              className="w-40 shrink-0 bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-white/5 cursor-pointer hover:scale-[1.02] transition-transform"
            >
              <div className="p-3">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 h-8 mb-2 leading-snug">
                  {p.name}
                </h4>
                <div className="text-primary font-black text-sm">
                  {totalPrice.toLocaleString()} د.ع
                </div>
              </div>
            </div>
          );
        })}
        {hasMore && onLoadMore && (
          <button
            ref={loadMoreRef}
            onClick={onLoadMore}
            className="w-40 shrink-0 bg-primary/10 dark:bg-primary/20 rounded-2xl overflow-hidden shadow-sm border border-primary/20 dark:border-primary/30 cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors flex items-center justify-center min-h-[100px]"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-primary font-black text-sm">تحميل المزيد</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default SimilarProducts;
