import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { rapidSearchItems, rapidSearchItemsByImage } from '../services/api';
import { useWishlistStore } from '../store/useWishlistStore';
import { usePageCacheStore } from '../store/usePageCacheStore';
import { useUserPreferencesStore } from '../store/useUserPreferencesStore';
import SearchHeader from '../components/search/SearchHeader';
import SearchEmptyState from '../components/search/SearchEmptyState';
import SearchLoadingState from '../components/search/SearchLoadingState';
import SearchProductCard from '../components/search/SearchProductCard';
import type { Product } from '../types/product';

import { AlertCircle, ArrowUp, X } from 'lucide-react';

const SearchResults: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);

  const isProductInWishlist = (productId: number | string) => wishlistItems.some(item => String(item.productId) === String(productId));
  
  // Get query from URL if present
  const queryParams = new URLSearchParams(location.search);
  const initialQuery = queryParams.get('q') || '';
  const initialImageSearchUrl = (location.state as any)?.imageSearchUrl || '';

  const searchResults = usePageCacheStore((state) => state.searchResults);
  const cachedQuery = usePageCacheStore((state) => state.searchQuery);
  const setSearchData = usePageCacheStore((state) => state.setSearchData);
  const setSearchScrollPos = usePageCacheStore((state) => state.setSearchScrollPos);

  const [searchQuery, setSearchQuery] = useState('');
  const [draftQuery, setDraftQuery] = useState(initialQuery || cachedQuery);
  const [imageSearchUrl, setImageSearchUrl] = useState<string>(initialImageSearchUrl);
  const [products, setProducts] = useState<Product[]>(searchResults);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>(searchResults);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [activeFilter] = useState('all');
  const [sortBy] = useState<'none' | 'price_asc' | 'price_desc' | 'rating'>('none');
  
  // Use User Preferences Store
  const recentSearches = useUserPreferencesStore((state) => state.searchHistory);
  const addSearchHistory = useUserPreferencesStore((state) => state.addSearchHistory);
  const clearHistory = useUserPreferencesStore((state) => state.clearHistory);
  
  const [isTyping, setIsTyping] = useState(false);
  const scrollTargetsRef = useRef<HTMLElement[]>([]);
  const suppressInitialFocusRef = useRef(false);

  const observer = useRef<IntersectionObserver | null>(null);

  const lastProductElementRef = useCallback((node: HTMLDivElement) => {
    if (loading || loadingMore || !hasMore) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        setPage(prev => prev + 1);
      }
    }, { rootMargin: '100% 0px', threshold: 0 });
    
    if (node) observer.current.observe(node);
  }, [loading, loadingMore, hasMore]);

  const popularSearches = ['سماعات لاسلكية', 'آيفون 15', 'ساعة ذكية', 'أحذية رياضية', 'عطور رجالية'];

  const extractNumericPrice = (item: any) => {
    const raw = item?.priceMoney?.Price
      ?? item?.price
      ?? item?.originalPrice
      ?? item?.Price?.ConvertedPriceWithoutSign
      ?? item?.Price?.OriginalPrice
      ?? item?.Price?.ConvertedPriceList?.Internal?.Price
      ?? item?.PromotionPrice?.ConvertedPriceList?.Internal?.Price;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    if (typeof raw === 'string') {
      const parsed = parseFloat(raw.replace(/[^\d.]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const coerced = Number(raw);
    return Number.isFinite(coerced) ? coerced : 0;
  };

  const mapRapidItemToProduct = useCallback((item: any): Product => {
    const numericPrice = extractNumericPrice(item);
    const safePrice = Number.isFinite(numericPrice) ? numericPrice : 0;
    const rawImages = Array.isArray(item?.images) ? item.images : [];
    const normalizedImages = rawImages
      .map((img: any) => {
        if (!img) return null;
        const url = typeof img === 'string' ? img : (typeof img === 'object' ? img?.url : '');
        if (!url) return null;
        const s = String(url);
        return s.startsWith('//') ? `https:${s}` : s;
      })
      .filter(Boolean) as string[];
    const rawMain = item?.image && typeof item.image === 'object' ? item.image?.url : item?.image;
    const mainImage = rawMain
      ? (String(rawMain).startsWith('//') ? `https:${String(rawMain)}` : String(rawMain))
      : (normalizedImages[0] || '');

    return {
      id: `rapid-${item?.itemId || item?.itemIdStr || Math.random().toString(36).slice(2)}`,
      name: item?.title || 'Product',
      price: safePrice,
      image: mainImage,
      images: normalizedImages,
      purchaseUrl: item?.taobaoItemUrl || item?.itemUrl || item?.detail_url || undefined,
      variants: []
    };
  }, []);

  useEffect(() => {
    // If query in URL changes, update search query state
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (q && q !== draftQuery) {
      setDraftQuery(q);
      setSearchQuery(q);
      setIsTyping(false);
    }
    const nextImage = (location.state as any)?.imageSearchUrl;
    if (typeof nextImage === 'string' && nextImage && nextImage !== imageSearchUrl) {
      setImageSearchUrl(nextImage);
      setSearchQuery('');
      setDraftQuery('');
      setIsTyping(false);
      setPage(1);
    }
  }, [location.search, location.state, draftQuery, imageSearchUrl]);

  useEffect(() => {
    const cachedQueryValue = initialQuery || cachedQuery;
    if (searchResults.length > 0 && cachedQueryValue) {
      if (products.length === 0) {
        setProducts(searchResults);
        setFilteredProducts(searchResults);
      }
      setIsTyping(false);
      suppressInitialFocusRef.current = true;
    }
  }, [initialQuery, cachedQuery, searchResults, products.length]);

  const addToRecentSearches = useCallback((query: string) => {
    if (!query.trim()) return;
    addSearchHistory(query);
  }, [addSearchHistory]);

  const clearRecentSearches = () => {
    clearHistory();
  };

  useEffect(() => {
    const searchScrollPos = usePageCacheStore.getState().searchScrollPos;
    if (products.length > 0) {
      setTimeout(() => {
        window.scrollTo(0, searchScrollPos);
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop = searchScrollPos;
        }
      }, 50);
    }
    // Only run on initial mount to restore scroll position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const resolveScrollTargets = () => {
      const scrollingEl = document.scrollingElement as HTMLElement | null;
      const body = document.body;
      const root = document.getElementById('root') as HTMLElement | null;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [data-scroll-container], [data-scroll-root], .scroll-container, .overflow-y-auto, .overflow-auto, .overflow-y-scroll'));
      const combined = [scrollingEl, body, root, ...candidates].filter(Boolean) as HTMLElement[];
      const unique = Array.from(new Set(combined));
      const scrollables = unique.filter((el) => {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight;
      });
      if (scrollables.length > 0) return scrollables;
      return [scrollingEl, body, root].filter(Boolean) as HTMLElement[];
    };

    scrollTargetsRef.current = resolveScrollTargets();

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

      const fixedTargets = scrollTargetsRef.current;
      for (const targetEl of fixedTargets) {
        if (targetEl && typeof targetEl.scrollTop === 'number') return targetEl.scrollTop;
      }
      const se = document.scrollingElement as null | { scrollTop?: unknown };
      if (se && typeof se.scrollTop === 'number') return se.scrollTop;
      return window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };

    const handleScroll = (e?: Event) => {
      // Save scroll position
      setSearchScrollPos(getScrollY(e));
    };
    const scrollTargets = scrollTargetsRef.current;
    if (scrollTargets.length > 0) {
      scrollTargets.forEach((target) => {
        target.addEventListener('scroll', handleScroll, { passive: true });
      });
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      if (scrollTargets.length > 0) {
        scrollTargets.forEach((target) => {
          target.removeEventListener('scroll', handleScroll);
        });
      } else {
        window.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('touchmove', handleScroll);
    };
  }, [setSearchScrollPos]);

  useEffect(() => {
    let isMounted = true;
    const performSearch = async () => {
      const hasImageSearch = Boolean(imageSearchUrl);
      if (!searchQuery.trim() && !hasImageSearch) {
        setProducts([]);
        setFilteredProducts([]);
        setError(null);
        setHasMore(false);
        return;
      }
      
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      
      setError(null);
      const startTime = Date.now();
      const querySnapshot = searchQuery;
      try {
        console.log('[SearchResults] request_start', { query: querySnapshot, page });
        let data: any = null;
        if (hasImageSearch) {
          const rapidData = await rapidSearchItemsByImage(imageSearchUrl, page, 20);
          const rapidItems = Array.isArray(rapidData?.items) ? rapidData.items : [];
          const mappedRapidProducts = rapidItems.map(mapRapidItemToProduct);
          data = {
            products: mappedRapidProducts,
            total: typeof rapidData?.total === 'number' ? rapidData.total : mappedRapidProducts.length,
            hasMore: typeof rapidData?.hasMore === 'boolean' ? rapidData.hasMore : mappedRapidProducts.length >= 20
          };
        } else {
          const rapidData = await rapidSearchItems(searchQuery, page, 20, true, null);
          const rapidItems = Array.isArray(rapidData?.items) ? rapidData.items : [];
          const mappedRapidProducts = rapidItems.map(mapRapidItemToProduct);
          data = {
            products: mappedRapidProducts,
            total: typeof rapidData?.total === 'number' ? rapidData.total : mappedRapidProducts.length,
            hasMore: typeof rapidData?.hasMore === 'boolean' ? rapidData.hasMore : mappedRapidProducts.length >= 20
          };
        }
        if (!isMounted) return;

        const newProducts = data.products || [];
        const total = data.total || 0;
        const serverHasMore = data.hasMore !== undefined ? data.hasMore : newProducts.length === 20;
        console.log('[SearchResults] request_success', { query: querySnapshot, page, returned: newProducts.length, total, elapsedMs: Date.now() - startTime, imageSearch: hasImageSearch });

        if (page === 1) {
          setProducts(newProducts);
          setFilteredProducts(newProducts);
          setTotalResults(total);
          setSearchData(newProducts, searchQuery);
          if (newProducts.length > 0 && searchQuery) {
            addToRecentSearches(searchQuery);
          }
          const initialHasMore = serverHasMore && (total <= 0 || newProducts.length < total);
          setHasMore(initialHasMore);
        } else {
          let mergedProducts: Product[] = [];
          let uniqueCount = 0;
          setProducts(prev => {
            // Filter out any duplicates that might have been returned by the server
            const existingIds = new Set(prev.map(p => p.id));
            const uniqueNewProducts = newProducts.filter((p: Product) => !existingIds.has(p.id));
            uniqueCount = uniqueNewProducts.length;
            mergedProducts = [...prev, ...uniqueNewProducts];
            return mergedProducts;
          });
          setSearchData(mergedProducts, searchQuery);
          const reachedTotal = total > 0 && mergedProducts.length >= total;
          const effectiveHasMore = serverHasMore && !reachedTotal && uniqueCount > 0;
          setHasMore(effectiveHasMore);
        }
      } catch (err) {
        if (!isMounted) return;
        console.error('Search failed:', err);
        console.log('[SearchResults] request_error', { query: querySnapshot, page, elapsedMs: Date.now() - startTime });
        const errorMessage = (err as any)?.status === 429 
          ? 'عذراً، الخدمة مشغولة حالياً (تجاوز الحد المسموح). يرجى المحاولة لاحقاً.' 
          : 'حدث خطأ أثناء البحث. يرجى المحاولة مرة أخرى.';
        setError(errorMessage);
      } finally {
        if (isMounted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    };

    const timeoutId = setTimeout(performSearch, page === 1 ? 500 : 0);
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [searchQuery, imageSearchUrl, page, setSearchData, addToRecentSearches, mapRapidItemToProduct]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
  }, [searchQuery, imageSearchUrl]);

  const getProductBasePrice = useCallback((p: Product) => {
    const variants = (p as any).variants || [];
    const variantPrices = variants
      .map((v: any) => Number(v?.price))
      .filter((price: number) => !isNaN(price) && price > 0);
    return variantPrices.length > 0 ? Math.min(...variantPrices) : Number(p.price);
  }, []);

  useEffect(() => {
    let result = [...products];
    const getNumericId = (id: number | string) => (typeof id === 'number' ? id : Number.parseInt(String(id), 10) || 0);

    // Apply filters
    if (activeFilter === 'free_shipping') {
      // Products over 30,000 IQD get free shipping in our business logic
      result = result.filter(p => getProductBasePrice(p) >= 30000); 
    } else if (activeFilter === 'top_rated') {
      // Simulated top rated (products with even IDs for demo)
      result = result.filter(p => getNumericId(p.id) % 2 === 0);
    } else if (activeFilter === 'under_25k') {
      result = result.filter(p => getProductBasePrice(p) < 25000);
    }

    // Apply sorting
    if (sortBy === 'price_asc') {
      result.sort((a, b) => getProductBasePrice(a) - getProductBasePrice(b));
    } else if (sortBy === 'price_desc') {
      result.sort((a, b) => getProductBasePrice(b) - getProductBasePrice(a));
    } else if (sortBy === 'rating') {
      // Sort by simulated rating (higher IDs first for demo)
      result.sort((a, b) => getNumericId(b.id) - getNumericId(a.id));
    }

    setFilteredProducts(result);
  }, [activeFilter, sortBy, products, getProductBasePrice]);





  const isImageSearchActive = Boolean(imageSearchUrl);

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-white antialiased selection:bg-primary/30 rtl overflow-visible" dir="rtl">
          <SearchHeader 
           query={draftQuery}
           onQueryChange={(q) => {
             setDraftQuery(q);
             setIsTyping(true);
             if (imageSearchUrl) setImageSearchUrl('');
           }}
           onBack={() => navigate('/')}
           onFocus={() => {
             if (suppressInitialFocusRef.current) {
               suppressInitialFocusRef.current = false;
               return;
             }
             if (draftQuery.trim()) setIsTyping(true);
           }}
           onClear={() => {
             setDraftQuery('');
             setSearchQuery('');
             setIsTyping(false);
             if (imageSearchUrl) setImageSearchUrl('');
           }}
           onSubmit={() => {
            const query = draftQuery.trim();
            if (!query) return;
            setSearchQuery(query);
            setIsTyping(false);
            setPage(1);
            setHasMore(true);
           }}
           onImageSelect={(dataUrl: string) => {
             setImageSearchUrl(dataUrl);
             setSearchQuery('');
             setDraftQuery('');
             setIsTyping(false);
             setPage(1);
           }}
         />
         
         <div className="transition-all duration-300"></div>

        <main className="flex-1 p-3 pb-12">
          {isImageSearchActive && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3">
              <div className="h-16 w-16 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <img src={imageSearchUrl} alt="بحث بالصورة" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white">بحث بالصورة</p>
                <p className="text-[11px] text-slate-400">نتائج مطابقة للصورة المختارة</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setImageSearchUrl('');
                  setPage(1);
                  setHasMore(true);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!isTyping && (searchQuery || isImageSearchActive) && !loading && filteredProducts.length > 0 && (
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">النتائج لـ "{isImageSearchActive ? 'بحث بالصورة' : searchQuery}"</h2>
              <span className="text-sm text-slate-500">{totalResults || filteredProducts.length} منتج</span>
            </div>
          )}

          {!isTyping && (searchQuery || isImageSearchActive) && loading && <SearchLoadingState query={isImageSearchActive ? 'بحث بالصورة' : searchQuery} />}

          {!isTyping && error && (
            <div className="p-6 text-center">
              <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={40} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">عذراً، حدث خطأ</h3>
              <p className="text-slate-500 text-sm mb-6">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-primary text-white rounded-xl font-bold"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {!isTyping && !loading && !error && (searchQuery || isImageSearchActive) && filteredProducts.length === 0 && (
            <SearchEmptyState 
              query={isImageSearchActive ? 'بحث بالصورة' : searchQuery}
              popularSearches={popularSearches}
              onSelect={(q) => {
                setDraftQuery(q);
                setSearchQuery(q);
                setIsTyping(false);
              }}
            />
          )}

          {!isTyping && !loading && !error && !searchQuery && !isImageSearchActive && (
            <SearchEmptyState 
              query=""
              popularSearches={popularSearches}
              recentSearches={recentSearches}
              onSelect={(q) => {
                setDraftQuery(q);
                setSearchQuery(q);
                setIsTyping(false);
              }}
              onClearRecent={clearRecentSearches}
            />
          )}

          {!isTyping && !loading && !error && filteredProducts.length > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredProducts.map((product, index) => (
                  <div 
                    key={product.id}
                    ref={index === filteredProducts.length - 1 ? lastProductElementRef : null}
                  >
                    <SearchProductCard 
                      product={product}
                      onNavigate={(id) => navigate(`/product?id=${id}`, { state: { initialProduct: product } })}
                      onToggleWishlist={(p) => toggleWishlist(p.id, p)}
                      isWishlisted={isProductInWishlist(product.id)}
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
              
              {!loadingMore && !hasMore && filteredProducts.length > 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
                  <p className="text-sm font-bold text-slate-400 dark:text-slate-500">وصلت إلى نهاية النتائج</p>
                  <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
                </div>
              )}
            </>
          )}
        </main>

        {/* Floating Action Button: Scroll to Top */}
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-24 left-6 z-40 size-12 rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-white/5 flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-90 transition-all"
        >
          <ArrowUp size={24} />
        </button>
      </div>
  );
};

export default SearchResults;
