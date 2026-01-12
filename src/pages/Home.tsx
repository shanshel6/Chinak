import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProducts } from '../services/api';
import { useWishlistStore } from '../store/useWishlistStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { useToastStore } from '../store/useToastStore';
import Skeleton from '../components/Skeleton';
import { useTranslation } from 'react-i18next';
import HomeHeader from '../components/home/HomeHeader';
import SearchBar from '../components/home/SearchBar';
import ProductCard from '../components/home/ProductCard';
import CategoryTabs from '../components/home/CategoryTabs';
import { Grid2X2, Smartphone, Shirt, Sparkles, Banknote, AlertCircle, PackageSearch } from 'lucide-react';

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  description: string;
  images?: { id: number; url: string; order: number; type?: string }[];
  purchaseUrl?: string;
}

const Home: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const addItem = useCartStore((state) => state.addItem);
  const showToast = useToastStore((state) => state.showToast);
  const unreadNotificationsCount = useNotificationStore((state) => state.unreadCount);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Infinite Scroll & Categories State
  const [hasMore, setHasMore] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const observer = useRef<IntersectionObserver | null>(null);
  const [, setPage] = useState(1);

  const categories = [
    { id: 'all', name: 'الكل', icon: Grid2X2 },
    { id: 'electronics', name: 'إلكترونيات', icon: Smartphone },
    { id: 'fashion', name: 'أزياء', icon: Shirt },
    { id: 'new', name: 'جديدنا', icon: Sparkles },
    { id: 'under5k', name: 'أقل من 5,000 د.ع', icon: Banknote },
  ];

  const categoryToSearchTerm: Record<string, string> = {
    all: '',
    electronics: 'إلكترونيات أجهزة ذكية electronics tech',
    fashion: 'ملابس أزياء موضة fashion clothes',
    new: 'جديد وصل حديثاً new arrivals',
    under5k: '', 
  };

  const loadData = async (pageNum: number, categoryId: string, isInitial = false, retryCount = 0) => {
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      setError(null);
      const searchTerm = categoryToSearchTerm[categoryId] || '';
      const maxPrice = categoryId === 'under5k' ? 5000 : undefined;
      
      const prodsRes = await fetchProducts(pageNum, 10, searchTerm, maxPrice);

      const newProducts = prodsRes.products || [];
      
      if (isInitial) {
        setProducts(newProducts);
      } else {
        setProducts(prev => [...prev, ...newProducts]);
      }
      
      setHasMore(newProducts.length === 10);
      
    } catch (err: any) {
      console.error('Error loading data:', err);
      
      // Auto-retry for initial load failures up to 2 times
      if (isInitial && retryCount < 2) {
        const delay = (retryCount + 1) * 1500;
        console.log(`Retrying initial load (${retryCount + 1}/2) in ${delay}ms...`);
        setTimeout(() => loadData(pageNum, categoryId, isInitial, retryCount + 1), delay);
        return;
      }

      setError(err.message || t('common.error_loading'));
    } finally {
      // Only set loading to false if we're not retrying
      if (!isInitial || retryCount >= 2 || !error) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    setProducts([]); // Clear products to avoid showing stale data from previous category
    setHasMore(true); // Reset hasMore to true for the new category
    loadData(1, selectedCategoryId, true);
    setPage(1);
  }, [selectedCategoryId]);

  const lastProductElementRef = useCallback((node: HTMLDivElement) => {
    if (loading || loadingMore) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => {
          const nextPage = prevPage + 1;
          loadData(nextPage, selectedCategoryId);
          return nextPage;
        });
      }
    });
    
    if (node) observer.current.observe(node);
  }, [loading, loadingMore, hasMore, selectedCategoryId]);

  const handleSelectCategory = (id: string) => {
    setSelectedCategoryId(id);
  };

  const prefetchTimerRef = useRef<Record<string, any>>({});
  const prefetchedCategories = useRef<Set<string>>(new Set());

  const handleHoverCategory = (id: string) => {
    if (id === selectedCategoryId || products.length === 0 || prefetchedCategories.current.has(id)) return;
    
    // Clear existing timer for this category
    if (prefetchTimerRef.current[id]) {
      clearTimeout(prefetchTimerRef.current[id]);
    }

    // Set a small delay (200ms) before prefetching to ensure intent
    prefetchTimerRef.current[id] = setTimeout(async () => {
      try {
        const searchTerm = categoryToSearchTerm[id] || '';
        const maxPrice = id === 'under5k' ? 5000 : undefined;
        // Prefetch first page for this category
        await fetchProducts(1, 10, searchTerm, maxPrice);
        prefetchedCategories.current.add(id);
        console.log(`Prefetched category on hover: ${id}`);
      } catch (err) {
        // Silently fail for prefetch
      }
    }, 200);
  };

  // Idle prefetching
  useEffect(() => {
    if (loading || products.length === 0) return;

    const idleCallback = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 2000));
    
    const handleIdle = () => {
      categories.forEach(async (cat) => {
        if (cat.id !== selectedCategoryId && !prefetchedCategories.current.has(cat.id)) {
          try {
            const searchTerm = categoryToSearchTerm[cat.id] || '';
            const maxPrice = cat.id === 'under5k' ? 5000 : undefined;
            await fetchProducts(1, 10, searchTerm, maxPrice);
            prefetchedCategories.current.add(cat.id);
            console.log(`Prefetched category on idle: ${cat.id}`);
          } catch (err) {
            // Silently fail
          }
        }
      });
    };

    const handle = idleCallback(handleIdle);
    return () => {
      if ((window as any).cancelIdleCallback) {
        (window as any).cancelIdleCallback(handle);
      } else {
        clearTimeout(handle);
      }
    };
  }, [loading, products.length, selectedCategoryId]);

  const isProductInWishlist = (productId: number) => wishlistItems.some(item => item.productId === productId);

  const handleAddToWishlist = (e: React.MouseEvent, productId: number) => {
    e.stopPropagation();
    const product = products.find(p => p.id === productId);
    toggleWishlist(productId, product);
  };

  const handleAddToCart = async (e: React.MouseEvent, productId: number) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      showToast('يرجى تسجيل الدخول أولاً لإضافة منتجات إلى السلة', 'info');
      navigate('/login');
      return;
    }
    
    const product = products.find(p => p.id === productId);
    if (!product) return;

    // Optimistic UI update
    showToast('تمت إضافة المنتج إلى السلة', 'success');

    try {
      await addItem(productId, 1, undefined, {
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image
      });
    } catch (err: any) {
      showToast('فشل في إضافة المنتج للسلة', 'error');
    }
  };

  if (loading && products.length === 0) {
    return (
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl font-display text-text-primary-light dark:text-text-primary-dark antialiased" dir="rtl">
        <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-700">
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce"></div>
            </div>
            <p className="text-sm font-bold text-slate-500 animate-pulse">جاري تحضير طلبك...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden pb-24 mx-auto max-w-md bg-background-light dark:bg-background-dark shadow-2xl font-display text-slate-900 dark:text-white antialiased selection:bg-primary/30 rtl" dir="rtl">
      <HomeHeader 
        user={user}
        onNavigate={navigate}
        unreadNotificationsCount={unreadNotificationsCount}
      />

        <SearchBar 
          onNavigate={navigate} 
        />

        <CategoryTabs 
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={handleSelectCategory}
          onHoverCategory={handleHoverCategory}
        />

        {error && (
          <div className="mx-4 mt-4 p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 text-sm flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="flex-1 font-medium">{error}</p>
            <button 
              onClick={() => loadData(1, selectedCategoryId, true)}
              className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-bold"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {/* Discovery Feed */}
        <div className="mt-4 flex flex-col px-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              {selectedCategoryId === 'all' ? 'اكتشف المزيد ✨' : categories.find(c => c.id === selectedCategoryId)?.name}
            </h2>
          </div>
          
          <div className="grid grid-cols-2 gap-3 pb-6">
            {loading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="aspect-[3/4] w-full rounded-2xl shadow-sm" />
                  <div className="px-1 space-y-2">
                    <Skeleton variant="text" className="h-4 w-full" />
                    <Skeleton variant="text" className="h-4 w-2/3" />
                  </div>
                </div>
              ))
            ) : (
              products.map((product, index) => (
                <div 
                  key={`${product.id}-${index}`}
                  ref={index === products.length - 1 ? lastProductElementRef : null}
                >
                  <ProductCard 
                    product={product}
                    onNavigate={(id) => navigate(`/product?id=${id}`, { state: { initialProduct: product } })}
                    onAddToWishlist={handleAddToWishlist}
                    onAddToCart={handleAddToCart}
                    isProductInWishlist={isProductInWishlist}
                  />
                </div>
              ))
            )}
          </div>

          {loadingMore && (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white dark:bg-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 animate-pulse">
                <div className="h-5 w-5 border-2 border-t-transparent border-primary rounded-full animate-spin"></div>
                <span className="text-sm font-black text-slate-900 dark:text-white">جاري تحميل المزيد...</span>
              </div>
            </div>
          )}
          
          {!loading && !loadingMore && !hasMore && products.length > 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
              <p className="text-sm font-bold text-slate-400 dark:text-slate-500">وصلت إلى نهاية النتائج</p>
              <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
            </div>
          )}

          {!loading && products.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-6" dir="rtl">
              <div className="size-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 mb-2">
                <PackageSearch size={48} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">لا توجد منتجات حالياً</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 max-w-[260px] mx-auto">
                  نحن نعمل على إضافة منتجات جديدة باستمرار. جرب البحث عن شيء آخر أو العودة للتصنيفات الرئيسية.
                </p>
              </div>
              <button 
                onClick={() => setSelectedCategoryId('all')}
                className="px-8 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
              >
                العودة للكل
              </button>
            </div>
          )}
        </div>
      </div>
  );
};

export default Home;
