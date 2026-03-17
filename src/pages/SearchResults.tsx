import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Search, ArrowRight, Camera, X } from 'lucide-react';
import { searchProducts, searchProductsByImage } from '../services/api';
import FilterBar from '../components/home/FilterBar';
import ProductCard from '../components/home/ProductCard';
import { useWishlistStore } from '../store/useWishlistStore';
import { useAuthStore } from '../store/useAuthStore';
import type { ConditionFilter, PriceFilter } from '../components/home/FilterBar';
import type { Product } from '../types/product';
import { usePageCacheStore } from '../store/usePageCacheStore';

const SearchResults: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const initialQuery = useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  const IMAGE_QUERY_LABEL = 'بحث بالصورة';
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [imageSearchInput, setImageSearchInput] = useState<string | null>(null);
  const [imageSearchPreview, setImageSearchPreview] = useState<string | null>(null);
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(null);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>(null);
  const [draftConditionFilter, setDraftConditionFilter] = useState<ConditionFilter>(null);
  const [draftPriceFilter, setDraftPriceFilter] = useState<PriceFilter>(null);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const [restored, setRestored] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const randomStartPageRef = useRef(1);
  const restoredFromCacheRef = useRef(false);
  const activeQueryRef = useRef(activeQuery);
  const pageRef = useRef(page);
  const loadingRef = useRef(loading);
  const loadingMoreRef = useRef(loadingMore);
  const hasMoreRef = useRef(hasMore);
  const conditionFilterRef = useRef<ConditionFilter>(conditionFilter);
  const priceFilterRef = useRef<PriceFilter>(priceFilter);
  const inFlightMoreRef = useRef(false);
  const scrollRatioRef = useRef(0);
  const LIMIT = 30;
  const RECENT_SEARCH_TERMS_KEY = 'recent_search_terms_v1';
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isImageSearch = Boolean(imageSearchInput && imageSearchPreview);

  const rememberSearchTerm = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean) return;
    try {
      const raw = localStorage.getItem(RECENT_SEARCH_TERMS_KEY);
      const current = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(current) ? current : [];
      const next = [clean, ...list.filter((item) => String(item).trim() !== clean)].slice(0, 30);
      localStorage.setItem(RECENT_SEARCH_TERMS_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const readRecentTerms = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCH_TERMS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      return list.map((item) => String(item).trim()).filter(Boolean).slice(0, 30);
    } catch {
      return [];
    }
  }, []);

  const [recentTerms, setRecentTerms] = useState<string[]>(() => readRecentTerms());

  useEffect(() => {
    if (!isInputFocused) return;
    setRecentTerms(readRecentTerms());
  }, [isInputFocused, readRecentTerms]);

  const startImageSearch = useCallback(async (imageBase64: string) => {
    restoredFromCacheRef.current = false;
    setRestored(false);
    setLoading(true);
    setLoadingMore(false);
    setResults([]);
    setError(null);
    setHasMore(false);
    setPage(1);
    pageRef.current = 1;
    hasMoreRef.current = false;
    inFlightMoreRef.current = false;
    scrollRatioRef.current = 0;
    setImageSearchInput(imageBase64);
    setImageSearchPreview(imageBase64);
    setActiveQuery(IMAGE_QUERY_LABEL);
    setQueryInput(IMAGE_QUERY_LABEL);
    if (inputRef.current) inputRef.current.blur();
    setIsInputFocused(false);

    try {
      const data = await searchProductsByImage(imageBase64, 1, LIMIT);
      setResults(Array.isArray(data.products) ? data.products : []);
      setHasMore(Boolean(data.hasMore));
      setPage(1);
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء البحث بالصورة');
    } finally {
      setLoading(false);
    }
  }, []);

  const clearImageSearch = useCallback(() => {
    restoredFromCacheRef.current = false;
    setRestored(false);
    setImageSearchInput(null);
    setImageSearchPreview(null);
    setResults([]);
    setHasMore(false);
    setPage(1);
    pageRef.current = 1;
    hasMoreRef.current = false;
    inFlightMoreRef.current = false;
    scrollRatioRef.current = 0;
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setQueryInput('');
    setActiveQuery('');
    navigate('/search', { replace: true });
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 50);
  }, [navigate]);

  useEffect(() => {
    // Check if we arrived here with a pending image search
    const pendingImage = sessionStorage.getItem('pendingImageSearch');
    if (pendingImage) {
      sessionStorage.removeItem('pendingImageSearch');
      void startImageSearch(pendingImage);
    }
  }, [startImageSearch]);

  useEffect(() => {
    if (initialQuery.trim()) return;
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 50);
  }, [initialQuery]);

  useEffect(() => {
    if (imageSearchInput) return;
    setQueryInput(initialQuery);
    setActiveQuery(initialQuery);
  }, [initialQuery, imageSearchInput]);

  useEffect(() => {
    if (imageSearchInput) return;
    const key = initialQuery.trim();
    if (!key) {
      restoredFromCacheRef.current = false;
      setRestored(false);
      return;
    }
    const cached = usePageCacheStore.getState().getSearchData(key);
    if (cached && Array.isArray(cached.results) && cached.results.length > 0) {
      restoredFromCacheRef.current = true;
      setConditionFilter(cached.condition as ConditionFilter);
      setPriceFilter(cached.price as PriceFilter);
      setDraftConditionFilter(cached.condition as ConditionFilter);
      setDraftPriceFilter(cached.price as PriceFilter);
      setResults(cached.results);
      setHasMore(cached.hasMore);
      setPage(cached.page);
      setError(null);
      setRestored(true);
      const pos = cached.scrollPos || 0;
      if (pos > 0) {
        setTimeout(() => {
          window.scrollTo(0, pos);
          if (document.scrollingElement) {
            document.scrollingElement.scrollTop = pos;
          }
        }, 100);
      }
      return;
    }
    restoredFromCacheRef.current = false;
    setRestored(false);
  }, [initialQuery, imageSearchInput]);

  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    conditionFilterRef.current = conditionFilter;
  }, [conditionFilter]);

  useEffect(() => {
    priceFilterRef.current = priceFilter;
  }, [priceFilter]);

  useEffect(() => {
    setDraftConditionFilter(conditionFilter);
    setDraftPriceFilter(priceFilter);
  }, [conditionFilter, priceFilter]);

  const shuffleProducts = useCallback((items: Product[]) => {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, []);

  const applyFilters = useCallback(() => {
    setConditionFilter(draftConditionFilter);
    setPriceFilter(draftPriceFilter);
  }, [draftConditionFilter, draftPriceFilter]);

  const filteredRecentTerms = useMemo(() => {
    const q = queryInput.trim().toLowerCase();
    if (!q) return recentTerms;
    return recentTerms.filter((term) => term.toLowerCase().includes(q));
  }, [queryInput, recentTerms]);

  useEffect(() => {
    const query = activeQuery.trim();
    if (!query) {
      restoredFromCacheRef.current = false;
      setResults([]);
      setHasMore(false);
      setPage(1);
      pageRef.current = 1;
      hasMoreRef.current = false;
      inFlightMoreRef.current = false;
      scrollRatioRef.current = 0;
      setError(null);
      return;
    }
    if (imageSearchInput) return;
    if (restoredFromCacheRef.current) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (restored) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    rememberSearchTerm(query);
    let cancelled = false;
    const runSearch = async () => {
      setLoading(true);
      setLoadingMore(false);
      setResults([]);
      const initialPage = Math.max(1, randomStartPageRef.current || 1);
      setPage(initialPage);
      setHasMore(false);
      pageRef.current = initialPage;
      hasMoreRef.current = false;
      inFlightMoreRef.current = false;
      scrollRatioRef.current = 0;
      setError(null);
      try {
        const maxPrice = priceFilter === '1k' ? 1000 : priceFilter === '5k' ? 5000 : priceFilter === '10k' ? 10000 : priceFilter === '25k' ? 25000 : undefined;
        const condition = conditionFilter === 'new' ? 'new' : conditionFilter === 'used' ? 'used' : undefined;
        const response = await searchProducts(query, initialPage, LIMIT, maxPrice, condition);
        if (cancelled) return;
        const randomized = Array.isArray(response.products) ? shuffleProducts(response.products) : [];
        setResults(randomized);
        setHasMore(Boolean(response.hasMore));
      } catch (searchError: any) {
        if (cancelled) return;
        const message = searchError?.message || 'فشل البحث عبر Meilisearch';
        setResults([]);
        setHasMore(false);
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    runSearch();
    return () => {
      cancelled = true;
    };
  }, [activeQuery, conditionFilter, priceFilter, restored, rememberSearchTerm, shuffleProducts, searchVersion, imageSearchInput]);

  const loadMore = useCallback(async () => {
    const query = activeQueryRef.current.trim();
    if (!query) return;
    if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
    if (inFlightMoreRef.current) return;

    inFlightMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      if (imageSearchInput) {
        const response = await searchProductsByImage(imageSearchInput, nextPage, LIMIT);
        if (!activeQueryRef.current.trim()) return;
        const incoming = Array.isArray(response.products) ? response.products : [];
        setResults((prev) => {
          const merged = [...prev, ...incoming];
          const seen = new Set<string>();
          return merged.filter((item) => {
            const key = item?.id == null ? '' : String(item.id);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
        setHasMore(Boolean(response.hasMore));
        setPage(nextPage);
        pageRef.current = nextPage;
        return;
      }
      const price = priceFilterRef.current;
      const cond = conditionFilterRef.current;
      const maxPrice = price === '1k' ? 1000 : price === '5k' ? 5000 : price === '10k' ? 10000 : price === '25k' ? 25000 : undefined;
      const condition = cond === 'new' ? 'new' : cond === 'used' ? 'used' : undefined;
      const response = await searchProducts(query, nextPage, LIMIT, maxPrice, condition);
      if (activeQueryRef.current.trim() !== query) return;
      const incoming = Array.isArray(response.products) ? shuffleProducts(response.products) : [];
      setResults((prev) => {
        const merged = [...prev, ...incoming];
        const seen = new Set<string>();
        return merged.filter((item) => {
          const key = item?.id == null ? '' : String(item.id);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      setHasMore(Boolean(response.hasMore));
      setPage(nextPage);
      pageRef.current = nextPage;
    } catch (searchError: any) {
      if (activeQueryRef.current.trim() !== query) return;
      const message = searchError?.message || 'فشل تحميل المزيد عبر Meilisearch';
      setError(message);
    } finally {
      if (activeQueryRef.current.trim() === query) setLoadingMore(false);
      inFlightMoreRef.current = false;
    }
  }, [shuffleProducts, imageSearchInput]);

  useEffect(() => {
    const query = activeQuery.trim();
    if (!query) return;

    const getScrollMetrics = () => {
      const scrollingEl = document.scrollingElement || document.documentElement;
      const scrollTop = typeof scrollingEl.scrollTop === 'number'
        ? scrollingEl.scrollTop
        : (window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0);
      const scrollHeight = Math.max(
        scrollingEl.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0
      );
      const clientHeight = scrollingEl.clientHeight || window.innerHeight || document.documentElement.clientHeight || 0;
      return { scrollTop, scrollHeight, clientHeight };
    };

    const handleScroll = () => {
      if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = getScrollMetrics();
      const scrollable = scrollHeight - clientHeight;
      if (scrollable <= 0) return;

      const ratio = scrollTop / scrollable;
      const prevRatio = scrollRatioRef.current;
      scrollRatioRef.current = ratio;
      if (prevRatio < 0.5 && ratio >= 0.5) {
        void loadMore();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
    };
  }, [activeQuery, loadMore]);

  useEffect(() => {
    const key = activeQuery.trim();
    if (!key) return;
    if (imageSearchInput) return;
    usePageCacheStore.getState().setSearchData(key, {
      results,
      page,
      hasMore,
      condition: conditionFilter as any,
      price: priceFilter as any,
    });
  }, [results, page, hasMore, activeQuery, conditionFilter, priceFilter, imageSearchInput]);

  useEffect(() => {
    const key = activeQuery.trim();
    if (!key) return;
    if (imageSearchInput) return;
    let timeoutId: any = null;
    const getScrollY = () => {
      const se = document.scrollingElement as null | { scrollTop?: unknown };
      if (se && typeof se.scrollTop === 'number') return se.scrollTop as number;
      return window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };
    const handleScroll = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        usePageCacheStore.getState().setSearchScrollPos(key, getScrollY());
      }, 150);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
    };
  }, [activeQuery, imageSearchInput]);

  const submitSearch = () => {
    if (imageSearchInput) return;
    const q = queryInput.trim();
    if (!q || q === IMAGE_QUERY_LABEL) return;
    restoredFromCacheRef.current = false;
    randomStartPageRef.current = Math.floor(Math.random() * 3) + 1;
    setRestored(false);
    setResults([]);
    setHasMore(false);
    setPage(1);
    setError(null);
    setLoading(true);
    setActiveQuery(q);
    setSearchVersion((v) => v + 1);
    rememberSearchTerm(q);
    if (inputRef.current) inputRef.current.blur();
    setRecentTerms(readRecentTerms());
    navigate(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`, { replace: true });
  };


  const onAddToWishlist = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    toggleWishlist(product.id, product);
  };

  const handleNavigateToProduct = useCallback((id: number | string, product: Product) => {
    const key = activeQueryRef.current.trim();
    if (key) {
      const scrollY = window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      usePageCacheStore.getState().setSearchScrollPos(key, scrollY);
      usePageCacheStore.getState().setSearchData(key, {
        results,
        page: pageRef.current,
        hasMore: hasMoreRef.current,
        condition: conditionFilterRef.current as any,
        price: priceFilterRef.current as any,
      });
    }
    navigate(`/product?id=${id}`, { state: { initialProduct: product } });
  }, [navigate, results]);

  const isProductInWishlist = (productId: number | string) => wishlistItems.some(item => String(item.productId) === String(productId));

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark pb-24" dir="rtl">
      <div className="sticky top-0 z-30 bg-white dark:bg-slate-900 pt-safe border-b border-slate-100 dark:border-slate-800">
        <div className="px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="size-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300"
          >
            <ArrowRight size={18} />
          </button>
          <div className="flex-1 flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5">
            {isImageSearch ? <Camera size={16} className="text-slate-500" /> : <Search size={16} className="text-slate-500" />}
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              placeholder="ابحث عن منتج..."
              readOnly={isImageSearch}
              className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            {queryInput && (
              <button
                type="button"
                onClick={() => {
                  if (isImageSearch) {
                    clearImageSearch();
                    return;
                  }
                  setQueryInput('');
                  if (inputRef.current) inputRef.current.focus();
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
            <label className="p-1 cursor-pointer text-slate-500 hover:text-primary transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg, image/png"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  // Convert to standard JPEG before sending
                  const img = new Image();
                  const objectUrl = URL.createObjectURL(file);
                  
                  img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                      ctx.drawImage(img, 0, 0);
                      const jpegBase64 = canvas.toDataURL('image/jpeg', 0.9);
                      void startImageSearch(jpegBase64);
                      URL.revokeObjectURL(objectUrl);
                    }
                  };
                  img.src = objectUrl;
                  e.target.value = '';
                }}
              />
              <Camera size={18} />
            </label>
            <button
              type="button"
              onClick={submitSearch}
              className="text-xs font-bold text-primary mr-1"
            >
              بحث
            </button>
          </div>
        </div>
        {!isImageSearch && (
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
        )}
      </div>

      {isImageSearch && imageSearchPreview && (
        <div className="px-4 pt-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3 flex items-center gap-3">
            <img
              src={imageSearchPreview}
              alt="بحث بالصورة"
              className="h-14 w-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-slate-900 dark:text-white">بحث بالصورة</div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">عرض النتائج المشابهة للصورة</div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-xs font-black"
            >
              تغيير الصورة
            </button>
            <button
              type="button"
              onClick={clearImageSearch}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white"
              aria-label="مسح البحث بالصورة"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {!isImageSearch && isInputFocused && filteredRecentTerms.length > 0 && (
        <div className="px-4 pt-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-black text-slate-700 dark:text-slate-200">عمليات البحث الأخيرة</div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  try {
                    localStorage.removeItem(RECENT_SEARCH_TERMS_KEY);
                  } catch {}
                  setRecentTerms([]);
                }}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                مسح
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {filteredRecentTerms.slice(0, 12).map((term) => (
                <button
                  key={term}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQueryInput(term);
                    restoredFromCacheRef.current = false;
                    randomStartPageRef.current = Math.floor(Math.random() * 3) + 1;
                    setRestored(false);
                    setResults([]);
                    setHasMore(false);
                    setPage(1);
                    setError(null);
                    setLoading(true);
                    setSearchVersion((prev) => prev + 1);
                    setActiveQuery(term);
                    rememberSearchTerm(term);
                    navigate(`/search?q=${encodeURIComponent(term)}`, { replace: true });
                    if (inputRef.current) inputRef.current.blur();
                  }}
                  className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-xs font-bold"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-4 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5" />
          <div className="text-sm font-semibold">{error}</div>
        </div>
      )}

      {!error && activeQuery.trim() && !loading && results.length === 0 && (
        <div className="mx-4 mt-10 text-center text-slate-500 dark:text-slate-400 font-semibold">
          لا توجد نتائج
        </div>
      )}

      {loading && (
        <div className="mx-4 mt-10 flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-t-transparent border-primary rounded-full animate-spin"></div>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="px-4 mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {results.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onNavigate={(id) => handleNavigateToProduct(id, product)}
                onAddToWishlist={onAddToWishlist}
                isProductInWishlist={isProductInWishlist}
              />
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

          {!loadingMore && !hasMore && results.length > 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
              <p className="text-sm font-bold text-slate-400 dark:text-slate-500">وصلت إلى نهاية النتائج</p>
              <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SearchResults;
