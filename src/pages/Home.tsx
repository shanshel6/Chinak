import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProducts, searchProducts } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { useWishlistStore } from '../store/useWishlistStore';
import { usePageCacheStore } from '../store/usePageCacheStore';
import Skeleton from '../components/Skeleton';
import { useTranslation } from 'react-i18next';
import FilterBar from '../components/home/FilterBar';
import type { ConditionFilter, PriceFilter } from '../components/home/FilterBar';
import ProductCard from '../components/home/ProductCard';
import { Grid2X2, Smartphone, Shirt, Sparkles, Banknote, AlertCircle, PackageSearch, Search } from 'lucide-react';
import type { Product } from '../types/product';

const HOME_CATEGORY_CACHE_KEY = 'home_category_cached_products_v1';
const RECENT_SEARCH_TERMS_KEY = 'recent_search_terms_v1';
const HOME_RECENT_FEED_KEY = 'home_recent_feed_v1';

const Home: React.FC = () => {
  const { t } = useTranslation();
  
  // Categories definition with translations and icons
  const staticCategories = React.useMemo(() => [
    { id: 'all', name: t('home.recommended') || 'المقترحة', icon: Grid2X2 },
    { id: 'electronics', name: 'إلكترونيات', icon: Smartphone },
    { id: 'fashion', name: 'أزياء', icon: Shirt },
    { id: 'new', name: 'جديدنا', icon: Sparkles },
    { id: 'under5k', name: 'أقل من 5,000 د.ع', icon: Banknote },
  ], [t]);

  const navigate = useNavigate();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);

  // Read initial state from store without subscribing to updates (except categoryId)
  const homeCategoryId = usePageCacheStore((state) => state.homeCategoryId);
  const setHomeData = usePageCacheStore((state) => state.setHomeData);
  const setHomeScrollPos = usePageCacheStore((state) => state.setHomeScrollPos);

  const [products, setProducts] = useState<Product[]>(() => usePageCacheStore.getState().homeProducts);
  const [loading, setLoading] = useState(() => usePageCacheStore.getState().homeProducts.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Infinite Scroll & Categories State
  const [hasMore, setHasMore] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState(homeCategoryId);
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(null);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>(null);
  const [draftConditionFilter, setDraftConditionFilter] = useState<ConditionFilter>(null);
  const [draftPriceFilter, setDraftPriceFilter] = useState<PriceFilter>(null);
  const scrollTargetRef = useRef<HTMLElement[]>([]);
  const observer = useRef<IntersectionObserver | null>(null);
  const autoLoadGuardRef = useRef({ categoryId: homeCategoryId, lastCount: 0, stagnantAttempts: 0 });
  const [page, setPage] = useState(() => usePageCacheStore.getState().homePage);
  const productsRef = useRef<Product[]>(usePageCacheStore.getState().homeProducts);
  const restoredHomeScrollRef = useRef(false);
  const initializedRef = useRef(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const activeRequestRef = useRef<string | null>(null);
  const inFlightPageRequestsRef = useRef<Set<string>>(new Set());
  const normalizeProductId = useCallback((id: number | string | null | undefined) => {
    const raw = String(id ?? '').trim();
    if (!raw) return '';
    return raw.replace(/^rapid-/i, '');
  }, []);


  const readCategoryCachedProducts = useCallback((categoryId: string): Product[] => {
    try {
      const raw = localStorage.getItem(HOME_CATEGORY_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const products = parsed?.[categoryId];
      return Array.isArray(products) ? products : [];
    } catch {
      return [];
    }
  }, []);

  const writeCategoryCachedProducts = useCallback((categoryId: string, items: Product[]) => {
    if (!Array.isArray(items) || items.length === 0) return;
    try {
      const raw = localStorage.getItem(HOME_CATEGORY_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[categoryId] = items;
      localStorage.setItem(HOME_CATEGORY_CACHE_KEY, JSON.stringify(parsed));
    } catch {}
  }, []);

  const normalizeCachedProduct = useCallback((raw: any): Product | null => {
    if (!raw || typeof raw !== 'object') return null;
    const rawId = raw.id ?? raw.itemId ?? raw.itemIdStr;
    const idText = String(rawId ?? '').trim();
    if (!idText) return null;
    const id = idText.startsWith('rapid-') ? idText : `rapid-${idText}`;
    const name = String(raw.name ?? raw.title ?? '').trim();
    const image = String(raw.image ?? raw.mainPictureUrl ?? '').trim();
    const priceRaw = Number(raw.price ?? raw.priceMoney?.Price ?? raw.originalPrice ?? 0);
    if (!name || !image || !Number.isFinite(priceRaw) || priceRaw <= 0) return null;
    const purchaseUrl = raw.purchaseUrl || raw.itemUrl || raw.taobaoItemUrl || raw.detail_url || undefined;
    const normalizedImages = (Array.isArray(raw.images) ? raw.images : [])
      .map((img: any) => {
        if (typeof img === 'string') return img;
        return img?.url || img?.image || '';
      })
      .filter(Boolean);
    return {
      id,
      name,
      price: priceRaw,
      image,
      images: normalizedImages,
      purchaseUrl,
      variants: Array.isArray(raw.variants) ? raw.variants : []
    } as Product;
  }, []);

  const readGlobalCachedProducts = useCallback((): Product[] => {
    const merged: Product[] = [];
    const seen = new Set<string>();
    const pushMany = (items: any[]) => {
      items.forEach((entry) => {
        const normalized = normalizeCachedProduct(entry);
        if (!normalized) return;
        if (seen.has(String(normalized.id))) return;
        seen.add(String(normalized.id));
        merged.push(normalized);
      });
    };
    const stateSnapshot = usePageCacheStore.getState();
    pushMany(Array.isArray(stateSnapshot.homeProducts) ? stateSnapshot.homeProducts : []);
    try {
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith('app_cache_v5_')) return;
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const data = parsed?.data;
        const items = Array.isArray(data?.items)
          ? data.items
          : (Array.isArray(data?.products)
            ? data.products
            : (Array.isArray(data) ? data : []));
        if (items.length > 0) pushMany(items);
      });
    } catch {}
    return merged;
  }, [normalizeCachedProduct]);

  const mergeUniqueProducts = useCallback((primary: Product[], fallback: Product[]) => {
    const seen = new Set<string>();
    const combined = [...primary, ...fallback].filter((item) => {
      const key = normalizeProductId(item?.id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return combined;
  }, [normalizeProductId]);

  const hasCachedRemainder = useCallback((categoryId: string) => {
    const existingIds = new Set(productsRef.current.map((p) => normalizeProductId(p.id)));
    const cachePool = mergeUniqueProducts(readCategoryCachedProducts(categoryId), readGlobalCachedProducts());
    return cachePool.some((item) => !existingIds.has(normalizeProductId(item.id)));
  }, [mergeUniqueProducts, normalizeProductId, readCategoryCachedProducts, readGlobalCachedProducts]);

  const appendCachedChunk = useCallback((categoryId: string, pageNum: number, chunkSize = 10) => {
    const existingItems = productsRef.current;
    const existingIds = new Set(existingItems.map((p) => normalizeProductId(p.id)));
    const cachePool = mergeUniqueProducts(readCategoryCachedProducts(categoryId), readGlobalCachedProducts());
    const chunk = cachePool
      .filter((item) => !existingIds.has(normalizeProductId(item.id)))
      .slice(0, chunkSize);
    if (chunk.length === 0) return false;
    const updated = [...existingItems, ...chunk];
    productsRef.current = updated;
    setProducts(updated);
    setHomeData(updated, pageNum, categoryId);
    return true;
  }, [mergeUniqueProducts, normalizeProductId, readCategoryCachedProducts, readGlobalCachedProducts, setHomeData]);

  const loadData = useCallback(async (pageNum: number, categoryId: string, isInitial = false, retryCount = 0) => {
    const pageRequestKey = `${categoryId}:${pageNum}:${conditionFilter || 'all'}:${priceFilter || 'all'}`;
    if (inFlightPageRequestsRef.current.has(pageRequestKey)) return;
    inFlightPageRequestsRef.current.add(pageRequestKey);
    const requestId = `${categoryId}-${pageNum}-${Date.now()}`;
    activeRequestRef.current = requestId;

    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      setError(null);
      const maxPrice = categoryId === 'under5k' ? 5000 : (priceFilter === '1k' ? 1000 : priceFilter === '5k' ? 5000 : priceFilter === '10k' ? 10000 : priceFilter === '25k' ? 25000 : undefined);
      const condition = conditionFilter === 'new' ? 'new' : conditionFilter === 'used' ? 'used' : undefined;

      const shouldUseRecentFeed = categoryId === 'all' && !maxPrice && !condition;
      if (shouldUseRecentFeed) {
        const readRecentFeed = (): Product[] => {
          try {
            const raw = localStorage.getItem(HOME_RECENT_FEED_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };
        const writeRecentFeed = (items: Product[]) => {
          try {
            localStorage.setItem(HOME_RECENT_FEED_KEY, JSON.stringify(items));
          } catch {}
        };

        const shuffle = (arr: Product[]) => {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        };

        let personalizedPool = readRecentFeed();
        if (pageNum === 1 || personalizedPool.length === 0) {
          let recentTerms: string[] = [];
          try {
            const raw = localStorage.getItem(RECENT_SEARCH_TERMS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            recentTerms = Array.isArray(parsed) ? parsed.map((t) => String(t).trim()).filter(Boolean).slice(0, 30) : [];
          } catch {
            recentTerms = [];
          }

          if (isAuthenticated && recentTerms.length > 0) {
            const batches = await Promise.all(
              recentTerms.map((term) => {
                const randomPage = Math.floor(Math.random() * 3) + 1;
                return searchProducts(term, randomPage, 18).catch(() => ({ products: [] as Product[] }));
              })
            );
            const mergedRecent = batches.flatMap((batch) => (Array.isArray(batch.products) ? batch.products : []));
            personalizedPool = shuffle(mergeUniqueProducts(mergedRecent, personalizedPool));
            if (personalizedPool.length > 0) {
              writeRecentFeed(personalizedPool);
            }
          } else {
            const randomPages = Array.from({ length: 4 }, () => Math.floor(Math.random() * 12) + 1);
            const randomBatches = await Promise.all(
              randomPages.map((p) => fetchProducts(p, 20).then((res) => (Array.isArray(res.products) ? res.products : [])).catch(() => [] as Product[]))
            );
            const randomPool = randomBatches.flat();
            personalizedPool = shuffle(mergeUniqueProducts(randomPool, personalizedPool));
            if (personalizedPool.length > 0) {
              writeRecentFeed(personalizedPool);
            }
          }
        }

        if (personalizedPool.length > 0) {
          const start = (pageNum - 1) * 10;
          const end = start + 10;
          const chunk = personalizedPool.slice(start, end);

          if (isInitial) {
            productsRef.current = chunk;
            setProducts(chunk);
            setHomeData(chunk, pageNum, categoryId);
            writeCategoryCachedProducts(categoryId, chunk);
          } else {
            setProducts((prev) => {
              const updated = mergeUniqueProducts(prev, chunk);
              productsRef.current = updated;
              setHomeData(updated, pageNum, categoryId);
              return updated;
            });
          }

          setHasMore(personalizedPool.length > end);
          return;
        }
      }

      const prodsRes = await fetchProducts(pageNum, 10, maxPrice, condition);

      // Only proceed if this is still the active request for this category
      if (activeRequestRef.current !== requestId) return;

      const newProducts = prodsRes.products || [];
      const globalCachedProducts = readGlobalCachedProducts();
      const uniqueNewProducts = mergeUniqueProducts(newProducts, []);
      
      if (isInitial) {
        if (uniqueNewProducts.length > 0) {
          const seededProducts = uniqueNewProducts.length >= 8 ? uniqueNewProducts : mergeUniqueProducts(uniqueNewProducts, globalCachedProducts);
          productsRef.current = seededProducts;
          setProducts(seededProducts);
          setHomeData(seededProducts, pageNum, categoryId);
          writeCategoryCachedProducts(categoryId, seededProducts);
        } else {
          const fallbackProducts = mergeUniqueProducts(readCategoryCachedProducts(categoryId), globalCachedProducts);
          if (fallbackProducts.length > 0) {
            productsRef.current = fallbackProducts;
            setProducts(fallbackProducts);
            setHomeData(fallbackProducts, pageNum, categoryId);
          } else {
            productsRef.current = newProducts;
            setProducts(newProducts);
            setHomeData(newProducts, pageNum, categoryId);
          }
        }
      } else {
        setProducts(prev => {
          const existingIds = new Set(prev.map((p) => normalizeProductId(p.id)));
          const uniqueNewBatch = uniqueNewProducts.filter((p: Product) => !existingIds.has(normalizeProductId(p.id)));
          
          const updated = [...prev, ...uniqueNewBatch];
          productsRef.current = updated;
          setHomeData(updated, pageNum, categoryId);
          return updated;
        });
      }
      
      const resolvedHasMore = typeof prodsRes?.hasMore === 'boolean'
        ? prodsRes.hasMore
        : newProducts.length === 10;
      const hasCachedMore = hasCachedRemainder(categoryId);
      setHasMore(resolvedHasMore || hasCachedMore);
      
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

      if (isInitial) {
        const fallbackProducts = mergeUniqueProducts(readCategoryCachedProducts(categoryId), readGlobalCachedProducts());
        if (fallbackProducts.length > 0) {
          productsRef.current = fallbackProducts;
          setProducts(fallbackProducts);
          setHomeData(fallbackProducts, pageNum, categoryId);
          setError(null);
          return;
        }
      }
      setError(err.message || t('common.error_loading'));
    } finally {
      inFlightPageRequestsRef.current.delete(pageRequestKey);
      if (activeRequestRef.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [mergeUniqueProducts, normalizeProductId, setHomeData, t, readCategoryCachedProducts, writeCategoryCachedProducts, readGlobalCachedProducts, conditionFilter, priceFilter, isAuthenticated]);

  useEffect(() => {
    const isInitialMount = !initializedRef.current;
    if (isInitialMount) {
      initializedRef.current = true;
      if (productsRef.current.length > 0) {
        return;
      }
    }
    setProducts([]);
    setHasMore(true);
    setPage(1);
    loadData(1, selectedCategoryId, true);
  }, [selectedCategoryId, conditionFilter, priceFilter, loadData]);

  const applyFilters = useCallback(() => {
    setConditionFilter(draftConditionFilter);
    setPriceFilter(draftPriceFilter);
  }, [draftConditionFilter, draftPriceFilter]);

  useEffect(() => {
    setDraftConditionFilter(conditionFilter);
    setDraftPriceFilter(priceFilter);
  }, [conditionFilter, priceFilter]);

  const getCurrentScrollY = useCallback(() => {
    const fixedTargets = scrollTargetRef.current;
    for (const targetEl of fixedTargets) {
      if (targetEl && typeof targetEl.scrollTop === 'number' && targetEl.scrollTop > 0) {
        return targetEl.scrollTop;
      }
    }
    const se = document.scrollingElement as null | { scrollTop?: unknown };
    if (se && typeof se.scrollTop === 'number') return se.scrollTop;
    return window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }, []);

  const handleNavigateToProduct = useCallback((id: number | string, product: Product) => {
    const scrollPos = getCurrentScrollY();
    setHomeScrollPos(scrollPos);
    setHomeData(productsRef.current, page, selectedCategoryId);
    navigate(`/product?id=${id}`, { state: { initialProduct: product } });
  }, [getCurrentScrollY, navigate, page, selectedCategoryId, setHomeData, setHomeScrollPos]);

  useEffect(() => {
    if (restoredHomeScrollRef.current) return;
    const homeScrollPos = usePageCacheStore.getState().homeScrollPos;
    if (products.length === 0 || homeScrollPos <= 0) return;
    restoredHomeScrollRef.current = true;
    let attempts = 0;
    const tryRestore = () => {
      attempts += 1;
      window.scrollTo(0, homeScrollPos);
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = homeScrollPos;
      }
      const now = getCurrentScrollY();
      const reached = Math.abs(now - homeScrollPos) < 4;
      if (reached || attempts >= 12) return;
      setTimeout(tryRestore, 120);
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(tryRestore);
    });
  }, [products.length]);

  // Save scroll position and handle search bar visibility
  useEffect(() => {
    let timeoutId: any = null;

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

    scrollTargetRef.current = resolveScrollTargets();

    const getScrollY = (e?: Event) => {
      const target = e?.target as HTMLElement | null;
      if (target && typeof target.scrollTop === 'number') {
        const scrollTop = target.scrollTop;
        const scrollHeight = target.scrollHeight;
        const clientHeight = target.clientHeight;
        if (scrollHeight > clientHeight) return scrollTop;
      }
      const fixedTargets = scrollTargetRef.current;
      for (const targetEl of fixedTargets) {
        if (targetEl && typeof targetEl.scrollTop === 'number') return targetEl.scrollTop;
      }
      const se = document.scrollingElement as null | { scrollTop?: unknown };
      if (se && typeof se.scrollTop === 'number') return se.scrollTop;
      return window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };

    const handleScroll = (e?: Event) => {
      // Separate debounced task for saving scroll position (not for visibility)
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setHomeScrollPos(getScrollY(e));
      }, 150);
    };

    const scrollTargets = scrollTargetRef.current;
    if (scrollTargets.length > 0) {
      scrollTargets.forEach((target) => {
        target.addEventListener('scroll', handleScroll, { passive: true });
      });
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (scrollTargets.length > 0) {
        scrollTargets.forEach((target) => {
          target.removeEventListener('scroll', handleScroll);
        });
      } else {
        window.removeEventListener('scroll', handleScroll);
      }
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
    }, { rootMargin: '200% 0px', threshold: 0 });
    
    if (node) observer.current.observe(node);
  }, [loading, loadingMore, hasMore, selectedCategoryId, loadData]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    setProducts((prev) => {
      const seen = new Set<string>();
      const deduped = prev.filter((item) => {
        const key = normalizeProductId(item?.id);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (deduped.length === prev.length) return prev;
      productsRef.current = deduped;
      setHomeData(deduped, page, selectedCategoryId);
      return deduped;
    });
  }, [normalizeProductId, page, selectedCategoryId, setHomeData]);

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
    if (!needsMoreContent) {
      autoLoadGuardRef.current = {
        categoryId: selectedCategoryId,
        lastCount: products.length,
        stagnantAttempts: 0
      };
      return;
    }

    if (autoLoadGuardRef.current.categoryId !== selectedCategoryId) {
      autoLoadGuardRef.current = { categoryId: selectedCategoryId, lastCount: products.length, stagnantAttempts: 0 };
    }

    const hasGrown = products.length > autoLoadGuardRef.current.lastCount;
    autoLoadGuardRef.current.lastCount = products.length;
    autoLoadGuardRef.current.stagnantAttempts = hasGrown
      ? 0
      : (autoLoadGuardRef.current.stagnantAttempts + 1);

    if (autoLoadGuardRef.current.stagnantAttempts > 6) {
      const cachePage = page + 1;
      const appended = appendCachedChunk(selectedCategoryId, cachePage, 10);
      if (appended) {
        setPage(cachePage);
        setHasMore(true);
        autoLoadGuardRef.current.stagnantAttempts = 0;
      } else {
        setHasMore(false);
      }
      return;
    }

    const timer = window.setTimeout(() => {
      setPage(prevPage => {
        const nextPage = prevPage + 1;
        loadData(nextPage, selectedCategoryId);
        return nextPage;
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [products.length, hasMore, loading, loadingMore, selectedCategoryId, loadData, appendCachedChunk, page]);

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
      <div className="sticky top-0 z-40 pt-safe bg-white dark:bg-gray-900 shadow-sm transition-transform duration-300" id="home-header">
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/search')}
            className="w-full flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-right"
          >
            <Search size={18} className="text-slate-400" />
            <span className="text-sm text-slate-500 font-medium">ابحث عن منتجات...</span>
          </button>
        </div>
        <FilterBar 
          condition={draftConditionFilter}
          price={draftPriceFilter}
          onConditionChange={setDraftConditionFilter}
          onPriceChange={setDraftPriceFilter}
          appliedCondition={conditionFilter}
          appliedPrice={priceFilter}
          onApply={applyFilters}
          className="border-t border-slate-100 dark:border-slate-800"
        />
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
          {selectedCategoryId !== 'all' && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                {staticCategories.find(c => c.id === selectedCategoryId)?.name}
              </h2>
            </div>
          )}
          
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
