import React, { useRef, useEffect } from 'react';
import ProductCard from '../home/ProductCard';
import { useWishlistStore } from '../../store/useWishlistStore';
import { normalizeWishlistProductId } from '../../store/useWishlistStore';
import type { Product } from '../../types/product';

interface SimilarProductsProps {
  products: Product[];
  onProductClick: (id: number | string) => void;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

const SimilarProducts: React.FC<SimilarProductsProps> = ({ products, onProductClick, loading, hasMore, onLoadMore }) => {
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);

  const isProductInWishlist = (id: number | string) => {
    const normalizedProductId = normalizeWishlistProductId(id);
    if (!normalizedProductId) return false;
    return wishlistItems.some(item => normalizeWishlistProductId(item.productId) === normalizedProductId);
  };

  const handleAddToWishlist = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    toggleWishlist(product.id);
  };

  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (loading && products.length === 0) {
    return (
      <div className="mb-8 px-5">
        <h3 className="text-slate-900 dark:text-white text-lg font-black mb-4">منتجات مشابهة</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-[24px] bg-white dark:bg-slate-800 shadow-sm">
              <div className="aspect-[4/5] bg-slate-200 dark:bg-slate-700 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                <div className="h-5 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (products.length === 0 && !loading) {
    return (
      <div className="mb-8 px-5">
        <h3 className="text-slate-900 dark:text-white text-lg font-black mb-4">منتجات مشابهة</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm">لا توجد منتجات مشابهة حالياً</p>
      </div>
    );
  }

  return (
    <div className="mb-8 px-5">
      <h3 className="text-slate-900 dark:text-white text-lg font-black mb-4">منتجات مشابهة</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onNavigate={onProductClick}
            onAddToWishlist={handleAddToWishlist}
            isProductInWishlist={isProductInWishlist}
          />
        ))}
      </div>
      {hasMore && onLoadMore && (
        <div ref={loadMoreRef} className="py-4 flex justify-center">
          {loading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-slate-500">تحميل...</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default SimilarProducts;
