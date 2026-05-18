import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchProducts } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { normalizeWishlistProductId, useWishlistStore } from '../store/useWishlistStore';
import Skeleton from '../components/Skeleton';
import { useTranslation } from 'react-i18next';
import ProductCard from '../components/home/ProductCard';
import { AlertCircle, Camera, Search, PackageSearch } from 'lucide-react';
import type { Product } from '../types/product';

const Home: React.FC = () => {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const location = useLocation();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);
  const productsRef = useRef<Product[]>([]);
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
    loadData(1, true);
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

  const handleSearchByPhotoBannerClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    const removeInput = () => {
      document.body.removeChild(input);
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
                const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
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
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*,.heic,.heif';
              input.style.display = 'none';
              document.body.appendChild(input);
              const removeInput = () => {
                if (input.parentNode) input.parentNode.removeChild(input);
              };
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) {
                  removeInput();
                  return;
                }
                const fileToDataUrl = (selectedFile: File) => new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result || ''));
                  reader.onerror = () => reject(new Error('read_failed'));
                  reader.readAsDataURL(selectedFile);
                });
                const fileToJpegDataUrl = (selectedFile: File) => new Promise<string>((resolve, reject) => {
                  const img = new Image();
                  const objectUrl = URL.createObjectURL(selectedFile);
                  const cleanup = () => URL.revokeObjectURL(objectUrl);
                  img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                      ctx.drawImage(img, 0, 0);
                      cleanup();
                      resolve(canvas.toDataURL('image/jpeg', 0.9));
                      return;
                    }
                    cleanup();
                    reject(new Error('canvas_failed'));
                  };
                  img.onerror = () => {
                    cleanup();
                    reject(new Error('decode_failed'));
                  };
                  img.src = objectUrl;
                });
                try {
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
            }}
            className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-primary rounded-xl transition-colors shrink-0"
            aria-label="بحث بالصورة"
          >
            <Camera size={18} />
          </button>
        </div>
      </div>

      <div 
        onClick={handleSearchByPhotoBannerClick}
        className="mx-4 mt-4 p-4 bg-gradient-to-r from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10 rounded-2xl border border-primary/20 dark:border-primary/30 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
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
    </div>
  );
};

export default Home;
