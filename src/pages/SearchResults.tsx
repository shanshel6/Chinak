import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Search, ArrowRight } from 'lucide-react';
import { searchProducts } from '../services/api';
import FilterBar from '../components/home/FilterBar';
import ProductCard from '../components/home/ProductCard';
import { useWishlistStore } from '../store/useWishlistStore';
import type { ConditionFilter, PriceFilter } from '../components/home/FilterBar';
import type { Product } from '../types/product';
import { usePageCacheStore } from '../store/usePageCacheStore';

const SearchResults: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const initialQuery = useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
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
  const [restored, setRestored] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    setQueryInput(initialQuery);
    setActiveQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const key = initialQuery.trim();
    if (!key) {
      setRestored(false);
      return;
    }
    const cached = usePageCacheStore.getState().getSearchData(key);
    if (cached && Array.isArray(cached.results) && cached.results.length > 0) {
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
    setRestored(false);
  }, [initialQuery]);

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

  const applyFilters = useCallback(() => {
    setConditionFilter(draftConditionFilter);
    setPriceFilter(draftPriceFilter);
  }, [draftConditionFilter, draftPriceFilter]);

  useEffect(() => {
    const query = activeQuery.trim();
    if (!query) {
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
    if (restored) return;
    let cancelled = false;
    const runSearch = async () => {
      setLoading(true);
      setLoadingMore(false);
      setPage(1);
      setHasMore(false);
      pageRef.current = 1;
      hasMoreRef.current = false;
      inFlightMoreRef.current = false;
      scrollRatioRef.current = 0;
      setError(null);
      try {
        const maxPrice = priceFilter === '1k' ? 1000 : priceFilter === '5k' ? 5000 : priceFilter === '10k' ? 10000 : priceFilter === '25k' ? 25000 : undefined;
        const condition = conditionFilter === 'new' ? 'new' : conditionFilter === 'used' ? 'used' : undefined;
        const response = await searchProducts(query, 1, LIMIT, maxPrice, condition);
        if (cancelled) return;
        setResults(Array.isArray(response.products) ? response.products : []);
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
  }, [activeQuery, conditionFilter, priceFilter, restored]);

  const loadMore = useCallback(async () => {
    const query = activeQueryRef.current.trim();
    if (!query) return;
    if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
    if (inFlightMoreRef.current) return;

    inFlightMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      const price = priceFilterRef.current;
      const cond = conditionFilterRef.current;
      const maxPrice = price === '1k' ? 1000 : price === '5k' ? 5000 : price === '10k' ? 10000 : price === '25k' ? 25000 : undefined;
      const condition = cond === 'new' ? 'new' : cond === 'used' ? 'used' : undefined;
      const response = await searchProducts(query, nextPage, LIMIT, maxPrice, condition);
      if (activeQueryRef.current.trim() !== query) return;
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
    } catch (searchError: any) {
      if (activeQueryRef.current.trim() !== query) return;
      const message = searchError?.message || 'فشل تحميل المزيد عبر Meilisearch';
      setError(message);
    } finally {
      if (activeQueryRef.current.trim() === query) setLoadingMore(false);
      inFlightMoreRef.current = false;
    }
  }, []);

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
    usePageCacheStore.getState().setSearchData(key, {
      results,
      page,
      hasMore,
      condition: conditionFilter as any,
      price: priceFilter as any,
    });
  }, [results, page, hasMore, activeQuery, conditionFilter, priceFilter]);

  useEffect(() => {
    const key = activeQuery.trim();
    if (!key) return;
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
  }, [activeQuery]);

  const submitSearch = () => {
    const q = queryInput.trim();
    setActiveQuery(q);
    if (inputRef.current) inputRef.current.blur();
    navigate(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`, { replace: true });
  };

  const onAddToWishlist = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    toggleWishlist(product.id, product);
  };

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
            <Search size={16} className="text-slate-500" />
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              placeholder="ابحث عن منتج..."
              className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={submitSearch}
              className="text-xs font-bold text-primary"
            >
              بحث
            </button>
          </div>
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
                onNavigate={(id) => navigate(`/product?id=${id}`, { state: { initialProduct: product } })}
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
