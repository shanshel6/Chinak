import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProducts } from '../services/api';
import { useWishlistStore } from '../store/useWishlistStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { usePageCacheStore } from '../store/usePageCacheStore';
import Skeleton from '../components/Skeleton';
import { useTranslation } from 'react-i18next';
import SearchBar from '../components/home/SearchBar';
import ProductCard from '../components/home/ProductCard';
import CategoryTabs from '../components/home/CategoryTabs';
import { Grid2X2, Smartphone, Shirt, Sparkles, Banknote, AlertCircle, PackageSearch } from 'lucide-react';
import type { Product } from '../types/product';

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

const Home: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const unreadNotificationsCount = useNotificationStore((state) => state.unreadCount);

  const { 
    homeProducts, 
    homePage, 
    homeCategoryId, 
    homeScrollPos,
    setHomeData, 
    setHomeScrollPos 
  } = usePageCacheStore();

  const [products, setProducts] = useState<Product[]>(homeProducts);
  const [loading, setLoading] = useState(homeProducts.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Infinite Scroll & Categories State
  const [hasMore, setHasMore] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState(homeCategoryId);
  const [showSearchBar, setShowSearchBar] = useState(true);
  const lastScrollY = useRef(0);
  const observer = useRef<IntersectionObserver | null>(null);
  const [_page, setPage] = useState(homePage);

  const activeRequestRef = useRef<string | null>(null);

  const loadData = useCallback(async (pageNum: number, categoryId: string, isInitial = false, retryCount = 0) => {
    const requestId = `${categoryId}-${pageNum}-${Date.now()}`;
    activeRequestRef.current = requestId;

    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      setError(null);
      const searchTerm = categoryToSearchTerm[categoryId] || '';
      const maxPrice = categoryId === 'under5k' ? 5000 : undefined;
      
      const prodsRes = await fetchProducts(pageNum, 10, searchTerm, maxPrice);

      // Only proceed if this is still the active request for this category
      if (activeRequestRef.current !== requestId) return;

      const newProducts = prodsRes.products || [];
      
      if (isInitial) {
        setProducts(newProducts);
        setHomeData(newProducts, pageNum, categoryId);
      } else {
        setProducts(prev => {
          // Filter out any duplicates that might have been returned by the server
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNewProducts = newProducts.filter((p: Product) => !existingIds.has(p.id));
          
          const updated = [...prev, ...uniqueNewProducts];
          setHomeData(updated, pageNum, categoryId);
          return updated;
        });
      }
      
      setHasMore(newProducts.length === 10);
      
    } catch (err: any) {
      if (activeRequestRef.current !== requestId) return;
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
      if (activeRequestRef.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [setHomeData, t]);

  useEffect(() => {
    // Only load if we don't have products or if the category has changed
    if (products.length === 0 || selectedCategoryId !== homeCategoryId) {
      setProducts([]); 
      setHasMore(true);
      loadData(1, selectedCategoryId, true);
      setPage(1);
    } else {
      // If we have products and category matches, just restore scroll
      setTimeout(() => {
        window.scrollTo(0, homeScrollPos);
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop = homeScrollPos;
        }
      }, 50);
    }
  }, [selectedCategoryId, homeCategoryId, products.length, loadData, homeScrollPos, setPage]);

  // Save scroll position and handle search bar visibility
  useEffect(() => {
    let timeoutId: any = null;
    let ticking = false;
    
    const getScrollY = (e?: Event) => {
      const target = e?.target as unknown;
      if (target && typeof target === 'object') {
        const el = target as { scrollTop?: unknown; scrollHeight?: unknown; clientHeight?: unknown };
        const scrollTop = typeof el.scrollTop === 'number' ? el.scrollTop : null;
        const scrollHeight = typeof el.scrollHeight === 'number' ? el.scrollHeight : null;
        const clientHeight = typeof el.clientHeight === 'number' ? el.clientHeight : null;
        if (scrollTop !== null && scrollHeight !== null && clientHeight !== null && scrollHeight > clientHeight) {
          return scrollTop;
        }
      }

      const se = document.scrollingElement as null | { scrollTop?: unknown };
      if (se && typeof se.scrollTop === 'number') return se.scrollTop;
      return window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };

    lastScrollY.current = getScrollY();

    const handleScroll = (e?: Event) => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = getScrollY(e);
          const deltaY = currentScrollY - lastScrollY.current;
          
          // Ignore bounces at the very top or bottom (iOS elastic scroll)
          if (currentScrollY < 0) {
            ticking = false;
            return;
          }

          // Search bar visibility logic
          if (currentScrollY < 50) {
            // At the very top, always show
            setShowSearchBar(true);
          } else if (Math.abs(deltaY) > 15) { // Increased threshold for stability
            if (deltaY < 0) {
              // Scrolling up - show search bar immediately
              setShowSearchBar(true);
            } else if (deltaY > 15 && currentScrollY > 200) { // More deliberate down scroll to hide
              // Scrolling down - hide search bar
              setShowSearchBar(false);
            }
            // Update lastScrollY only when we've moved significantly to lock the state
            lastScrollY.current = currentScrollY;
          }

          // Always update lastScrollY for small movements to prevent accumulation 
          // but only if we haven't already updated it above
          if (Math.abs(deltaY) <= 15) {
             // Optional: could update here too, but keeping it stable is better
          }

          ticking = false;
        });
        ticking = true;
      }

      // Separate debounced task for saving scroll position (not for visibility)
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setHomeScrollPos(getScrollY());
      }, 150);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('touchmove', handleScroll);
    };
  }, [setHomeScrollPos]);

  const lastProductElementRef = useCallback((node: HTMLDivElement) => {
    if (loading || loadingMore || !hasMore) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        setPage(prevPage => {
          const nextPage = prevPage + 1;
          loadData(nextPage, selectedCategoryId);
          return nextPage;
        });
      }
    });
    
    if (node) observer.current.observe(node);
  }, [loading, loadingMore, hasMore, selectedCategoryId, loadData]);

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
  }, [loading, products.length, selectedCategoryId, loadData]);

  const isProductInWishlist = (productId: number | string) => wishlistItems.some(item => String(item.productId) === String(productId));

  const handleAddToWishlist = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    toggleWishlist(product.id, product);
  };



  if (loading && products.length === 0) {
    return (
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-background-light dark:bg-background-dark font-display text-text-primary-light dark:text-text-primary-dark antialiased pt-[calc(env(safe-area-inset-top)+1rem)]" dir="rtl">
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
    <div className="relative flex min-h-screen w-full flex-col pb-28 pb-safe bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-white antialiased selection:bg-primary/30 rtl" dir="rtl">
      {/* Unified Sticky Header */}
      <div className="sticky top-0 z-50">
        {/* Search Bar - Slides up/down */}
        <div 
          className={`absolute top-0 left-0 right-0 w-full transition-all duration-300 ease-in-out z-20 ${
            showSearchBar ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
          }`}
        >
          <div className="bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-xl border-b border-slate-100/50 dark:border-slate-800/50 pt-safe shadow-sm">
            <div className="pt-1 pb-1">
              <SearchBar 
                onNavigate={navigate} 
                unreadNotificationsCount={unreadNotificationsCount}
              />
            </div>
          </div>
        </div>

        {/* Category Tabs - Always sticky, slides up when search hides */}
        <div 
          className={`relative z-10 w-full transition-all duration-300 ease-in-out bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-xl border-b border-slate-100/50 dark:border-slate-800/50 shadow-sm ${
            showSearchBar ? 'pt-[calc(env(safe-area-inset-top)+76px)]' : 'pt-[calc(env(safe-area-inset-top)+0px)]'
          }`}
        >
          <CategoryTabs 
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={handleSelectCategory}
            onHoverCategory={handleHoverCategory}
          />
        </div>
      </div>

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
          
          {!loading && !error && products.length > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4 lg:gap-6 pb-6">
                {products.map((product, index) => (
                  <div 
                    key={`${product.id}-${index}`}
                    ref={index === products.length - 1 ? lastProductElementRef : null}
                  >
                    <ProductCard 
                      product={product}
                      onNavigate={(id) => navigate(`/product?id=${id}`, { state: { initialProduct: product } })}
                      onAddToWishlist={handleAddToWishlist}
                      isProductInWishlist={isProductInWishlist}
                    />
                  </div>
                ))}
              </div>

              {loadingMore && (
                <div className="flex flex-col items-center justify-center py-6 gap-3">
                  <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white dark:bg-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 animate-pulse">
                    <div className="h-5 w-5 border-2 border-t-transparent border-primary rounded-full animate-spin"></div>
                    <span className="text-sm font-black text-slate-900 dark:text-white">جاري تحميل المزيد...</span>
                  </div>
                </div>
              )}
              
              {!loadingMore && !hasMore && products.length > 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
                  <p className="text-sm font-bold text-slate-400 dark:text-slate-500">وصلت إلى نهاية النتائج</p>
                  <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
                </div>
              )}
            </>
          )}

          {loading && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4 lg:gap-6 pb-6">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="aspect-[3/4] w-full rounded-2xl shadow-sm" />
                  <div className="px-1 space-y-2">
                    <Skeleton variant="text" className="h-4 w-full" />
                    <Skeleton variant="text" className="h-4 w-2/3" />
                  </div>
                </div>
              ))}
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
