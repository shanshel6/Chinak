import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchProducts, fetchSettings } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { normalizeWishlistProductId, useWishlistStore } from '../store/useWishlistStore';
import { usePageCacheStore } from '../store/usePageCacheStore';
import Skeleton from '../components/Skeleton';
import { useTranslation } from 'react-i18next';
import ProductCard from '../components/home/ProductCard';
import { AlertCircle, Camera, Search, PackageSearch, MessageCircle } from 'lucide-react';
import { isVisionModelReady } from '../services/clipService';
import { useVisionDownloadState } from '../services/visionDownloadManager';
import VisionDownloadPrompt from '../components/VisionDownloadPrompt';
import type { Product } from '../types/product';

const Home: React.FC = () => {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const location = useLocation();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);

  // Session-only feed cache. On back-navigation from a product page the
  // component remounts (AnimatePresence keys routes by pathname), so without
  // this the feed would refetch page 1 and show a different set of products.
  // We hydrate the previous feed synchronously so the first render already
  // shows it; <ScrollToTop> then restores the exact scroll position on POP.
  const getHomeData = usePageCacheStore((s) => s.getHomeData);
  const setHomeData = usePageCacheStore((s) => s.setHomeData);
  const initialHomeCache = useRef(getHomeData()).current;

  const [products, setProducts] = useState<Product[]>(initialHomeCache?.products ?? []);
  const [loading, setLoading] = useState(!initialHomeCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeSettings, setStoreSettings] = useState<any>({
    socialLinks: { whatsapp: '' }
  });

  // Vision download state — used by the camera icon to show the
  // download prompt BEFORE letting the user pick a photo.
  const visionState = useVisionDownloadState();
  const [visionPromptOpen, setVisionPromptOpen] = useState(false);
  const pendingPhotoActionRef = useRef<null | (() => void)>(null);

  const [hasMore, setHasMore] = useState(initialHomeCache?.hasMore ?? true);
  const pageRef = useRef(initialHomeCache?.page ?? 1);
  const productsRef = useRef<Product[]>(initialHomeCache?.products ?? []);
  const observer = useRef<IntersectionObserver | null>(null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const activeRequestRef = useRef<string | null>(null);
  const inFlightPageRequestsRef = useRef<Set<string>>(new Set());
  const normalizeProductId = useCallback((id: number | string | null | undefined) => {
    const raw = String(id ?? '').trim();
    if (!raw) return '';
    return raw.replace(/^rapid-/i, '');
  }, []);

  const loadData = useCallback(async (pageNum: number, isInitial = false, retryCount = 0) => {
    const pageRequestKey = `load:${pageNum}`;
    if (inFlightPageRequestsRef.current.has(pageRequestKey)) return;
    inFlightPageRequestsRef.current.add(pageRequestKey);
    const requestId = `load-${pageNum}-${Date.now()}`;
    activeRequestRef.current = requestId;

    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      setError(null);
      const prodsRes = await fetchProducts(pageNum, 10, undefined, undefined, true);

      if (activeRequestRef.current !== requestId) return;

      const newProducts = prodsRes.products || [];
      
      if (isInitial) {
        productsRef.current = newProducts;
        setProducts(newProducts);
      } else {
        setProducts(prev => {
          const existingIds = new Set(prev.map((p) => normalizeProductId(p.id)));
          const uniqueNewBatch = newProducts.filter((p: Product) => !existingIds.has(normalizeProductId(p.id)));
          const updated = [...prev, ...uniqueNewBatch];
          productsRef.current = updated;
          return updated;
        });
      }
      
      const resolvedHasMore = typeof prodsRes?.hasMore === 'boolean'
        ? prodsRes.hasMore
        : newProducts.length === 10;
      setHasMore(resolvedHasMore);
      
    } catch (err: any) {
      if (activeRequestRef.current !== requestId) return;
      console.error('Error loading data:', err);
      
      if (isInitial && retryCount < 2) {
        const delay = (retryCount + 1) * 1500;
        console.log(`Retrying initial load (${retryCount + 1}/2) in ${delay}ms...`);
        setTimeout(() => loadData(pageNum, isInitial, retryCount + 1), delay);
        return;
      }
      setError(err.message || t('common.error_loading'));
    } finally {
      inFlightPageRequestsRef.current.delete(pageRequestKey);
      if (activeRequestRef.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [normalizeProductId, t]);

  useEffect(() => {
    // Skip the initial fetch when we restored the feed from the session
    // cache (back-navigation) — otherwise page 1 would reload and replace
    // the products the user was looking at.
    if (!initialHomeCache) {
      loadData(1, true);
    }
    // Fetch store settings to get WhatsApp number
    const getStoreSettings = async () => {
      try {
        const data = await fetchSettings({ skipCache: true });
        setStoreSettings((prev: any) => ({
          ...prev,
          ...data,
          socialLinks: typeof data?.socialLinks === 'string' 
            ? JSON.parse(data.socialLinks) 
            : (data?.socialLinks || prev.socialLinks)
        }));
      } catch (err) {
        console.error('Failed to fetch store settings:', err);
      }
    };
    getStoreSettings();
  }, [loadData]);

  const lastProductElementRef = useCallback((node: HTMLDivElement) => {
    if (loading || loadingMore || !hasMore) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        pageRef.current += 1;
        loadData(pageRef.current);
      }
    }, { rootMargin: '200% 0px', threshold: 0 });
    
    if (node) observer.current.observe(node);
  }, [loading, loadingMore, hasMore, loadData]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  // Keep the session feed cache in sync as the user scrolls / loads more,
  // so returning from a product page restores the exact same list + page.
  useEffect(() => {
    if (loading || products.length === 0) return;
    setHomeData({ products, page: pageRef.current, hasMore });
  }, [products, hasMore, loading, setHomeData]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    const scrollingEl = document.scrollingElement || document.documentElement;
    const docHeight = Math.max(
      scrollingEl?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const needsMoreContent = docHeight <= viewportHeight + 160;
    if (!needsMoreContent) return;
    
    pageRef.current += 1;
    loadData(pageRef.current);
  }, [loading, loadingMore, hasMore, products.length, loadData]);

  const isProductInWishlist = (productId: number | string) => {
    const normalizedProductId = normalizeWishlistProductId(productId);
    if (!normalizedProductId) return false;
    return wishlistItems.some(item => normalizeWishlistProductId(item.productId) === normalizedProductId);
  };

  const handleAddToWishlist = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    toggleWishlist(product.id, product);
  };

  const handleNavigateToProduct = useCallback((id: number | string, product: Product) => {
    navigate(`/product?id=${id}`, { state: { initialProduct: product } });
  }, [navigate]);

  /**
   * Triggered by any "search by photo" entry point (banner or camera icon).
   * If the vision model is ready, open the file picker. Otherwise, show
   * the download prompt and remember this action so it can run when ready.
   */
  const requestImageSearch = useCallback(() => {
    const run = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.heic,.heif';
      input.style.display = 'none';
      document.body.appendChild(input);
      const removeInput = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
      };
      input.onchange = async (e: Event) => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) {
          removeInput();
          return;
        }
        try {
          const fileToDataUrl = (f: File): Promise<string> => {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
          };
          const fileToJpegDataUrl = async (f: File): Promise<string> => {
            return new Promise((resolve, reject) => {
              const img = new Image();
              const objectUrl = URL.createObjectURL(f);
              const cleanup = () => {
                URL.revokeObjectURL(objectUrl);
              };
              img.onload = () => {
                try {
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  if (!ctx) {
                    cleanup();
                    throw new Error('canvas_failed');
                  }
                  canvas.width = img.width;
                  canvas.height = img.height;
                  ctx.drawImage(img, 0, 0);
                  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                  cleanup();
                  resolve(jpegDataUrl);
                } catch (err) {
                  cleanup();
                  reject(err);
                }
              };
              img.onerror = () => {
                cleanup();
                reject(new Error('decode_failed'));
              };
              img.src = objectUrl;
            });
          };
          let payload = '';
          try {
            payload = await fileToJpegDataUrl(file);
          } catch {
            payload = await fileToDataUrl(file);
          }
          if (payload) {
            sessionStorage.setItem('pendingImageSearch', payload);
            navigate('/search');
          }
        } finally {
          removeInput();
        }
      };
      input.click();
    };

    if (isVisionModelReady() || visionState.status === 'ready') {
      run();
    } else {
      pendingPhotoActionRef.current = run;
      setVisionPromptOpen(true);
    }
  }, [navigate, visionState.status]);

  // When the vision download finishes, run the queued photo action
  const handleVisionReadyFromHome = useCallback(() => {
    setVisionPromptOpen(false);
    const pending = pendingPhotoActionRef.current;
    pendingPhotoActionRef.current = null;
    if (pending) {
      // small delay so the user sees the success state
      setTimeout(pending, 250);
    }
  }, []);

  /**
   * "Search by text instead" — closes the prompt and navigates to the
   * search page where the user can type a query.
   */
  const handleSearchByTextFromHome = useCallback(() => {
    setVisionPromptOpen(false);
    pendingPhotoActionRef.current = null;
    navigate('/search');
  }, [navigate]);

  const handleSearchByPhotoBannerClick = requestImageSearch;

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
      <div className="sticky top-0 z-40 pt-safe bg-white dark:bg-gray-900 shadow-sm transition-transform duration-300" id="home-header">
        <div className="px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/search')}
            className="flex-1 flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-right"
          >
            <Search size={18} className="text-slate-400" />
            <span className="text-sm text-slate-500 font-medium">ابحث عن منتجات...</span>
          </button>
          <button 
            onClick={requestImageSearch}
            className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-primary rounded-xl transition-colors shrink-0"
            aria-label="بحث بالصورة"
          >
            <Camera size={18} />
          </button>
        </div>
      </div>

      <div className="mx-4 mt-4 space-y-4">
        {/* First Panel - Image Search */}
        <div 
          onClick={handleSearchByPhotoBannerClick}
          className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10 rounded-2xl border border-primary/20 dark:border-primary/30 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm"
        >
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/20 dark:bg-primary/30 flex items-center justify-center">
              <Camera size={24} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-base font-black text-primary dark:text-primary-light">🎉 الآن يمكنك البحث بالصورة!</p>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">إذا كنت لا تعرف اسم المنتج، فقط ابحث عنه بالصورة أو لقطة الشاشة، جربها الآن!</p>
            </div>
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center">
                <Search size={16} />
              </div>
            </div>
          </div>
        </div>

        {/* Second Panel - WhatsApp Contact */}
        {(() => {
          // Get WhatsApp number, fall back to a default if not set
          const whatsappNumber = storeSettings?.socialLinks?.whatsapp || '+8613223001309';
          // Clean the number (remove any non-digit characters)
          const cleanNumber = whatsappNumber.replace(/\D/g, '');
          const message = encodeURIComponent('مرحباً، لا أجدة المنتج الذي أبحث عنه، هل يمكنكم مساعدتي؟');
          const whatsappUrl = `https://wa.me/${cleanNumber}?text=${message}`;
          
          return (
            <a 
              href={whatsappUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-4 bg-gradient-to-r from-[#25D366]/15 to-[#25D366]/10 dark:from-[#25D366]/25 dark:to-[#25D366]/15 rounded-2xl border-2 border-[#25D366]/30 dark:border-[#25D366]/40 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] block shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#25D366]/25 dark:bg-[#25D366]/35 flex items-center justify-center">
                  <MessageCircle size={24} className="text-[#25D366] dark:text-[#25D366]/90" />
                </div>
                <div className="flex-1">
                  <p className="text-base font-black text-[#25D366] dark:text-[#25D366]/90">🤝 لا تجد المنتج الذي تبحث عنه؟</p>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">تواصل معنا عبر واتساب وأرسل لنا صورة المنتج وسنساعدك في العثور عليه!</p>
                </div>
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-sm">
                    <MessageCircle size={16} />
                  </div>
                </div>
              </div>
            </a>
          );
        })()}
      </div>

      {error && (
        <div className="mx-4 mt-4 p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 text-sm flex items-center gap-3">
          <AlertCircle size={20} />
          <p className="flex-1 font-medium">{error}</p>
          <button 
            onClick={() => loadData(1, true)}
            className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-bold"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-col px-4">
        {!loading && !error && products.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4 lg:gap-6 pb-6">
              {products.map((product, index) => (
                <div 
                  key={product.id}
                  ref={index === products.length - 1 ? lastProductElementRef : null}
                >
                  <ProductCard 
                    product={product}
                    onNavigate={(id) => handleNavigateToProduct(id, product)}
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
              onClick={() => loadData(1, true)}
              className="px-8 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
      </div>

      <VisionDownloadPrompt
        open={visionPromptOpen}
        onClose={() => setVisionPromptOpen(false)}
        onReady={handleVisionReadyFromHome}
        onSearchByTextInstead={handleSearchByTextFromHome}
      />
    </div>
  );
};

export default Home;
