import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Search, ArrowRight, Camera, X } from 'lucide-react';
import { searchProductsByImage, searchProductsByImageCrop, searchProducts } from '../services/api';
import { warmupClipService, isClipReady } from '../services/clipService';
import { useAuthStore } from '../store/useAuthStore';
import { normalizeWishlistProductId, useWishlistStore } from '../store/useWishlistStore';
import { usePageCacheStore } from '../store/usePageCacheStore';
import { useToastStore } from '../store/useToastStore';
import { normalizeArabicSearchTerm } from '../data/arabicSearchNormalization';
import ProductCard from '../components/home/ProductCard';
import type { Product } from '../types/product';

const SearchResults: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const { setSearchData, getSearchData } = usePageCacheStore();
  const { showToast } = useToastStore();
  const isFirstRender = useRef(true);



  // Preload CLIP models on component mount
  useEffect(() => {
    if (!isClipReady()) {
      warmupClipService().catch(err => {
        console.warn('[SearchResults] CLIP warmup failed:', err);
      });
    }
  }, []);
  
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialQuery = searchParams.get('q') || '';
  const IMAGE_QUERY_LABEL = 'بحث بالصورة';
  const IMAGE_SEARCH_STATE_STORAGE_KEY = 'image_search_state_v1';
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [imageSearchInput, setImageSearchInput] = useState<string | null>(null);
  const [imageSearchPreview, setImageSearchPreview] = useState<string | null>(null);
  const [imageOriginalSize, setImageOriginalSize] = useState<{width: number, height: number} | null>(null);
  const [showImagePopup, setShowImagePopup] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<any[]>([]);
  const [selectedObjectBox, setSelectedObjectBox] = useState<number[] | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  
  // Create cache key based on search query
  const cacheKey = useMemo(() => {
    if (imageSearchInput) return '';
    return `${activeQuery.trim()}`;
  }, [activeQuery, imageSearchInput]);
  
  // Check for cached data on mount
  const cachedData = useMemo(() => cacheKey ? getSearchData(cacheKey) : undefined, [cacheKey, getSearchData]);
  
  const [results, setResults] = useState<Product[]>(cachedData?.results || []);
  const [loading, setLoading] = useState(!!initialQuery.trim() && !cachedData);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(cachedData?.page || 1);
  const [hasMore, setHasMore] = useState(cachedData?.hasMore || false);
  const [error, setError] = useState<string | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeQueryRef = useRef(activeQuery);
  const pageRef = useRef(page);
  const loadingRef = useRef(loading);
  const loadingMoreRef = useRef(loadingMore);
  const hasMoreRef = useRef(hasMore);

  const inFlightMoreRef = useRef(false);
  const scrollRatioRef = useRef(0);
  // MUST match the server's default page size (server/index.js -> /api/search/embedding).
  // If these don't match, "load more" will skip or duplicate items.
  const LIMIT = 20;
  const RECENT_SEARCH_TERMS_KEY = 'recent_search_terms_v1';
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isImageSearch = Boolean(imageSearchInput && imageSearchPreview);

  // NOTE: Scroll position save/restore is now handled globally by
  // <ScrollToTop /> in App.tsx, which saves on every scroll (debounced
  // via rAF) and restores on POP navigation. No page-level logic
  // is needed here anymore.

  // Manual Crop State
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null); // 'nw', 'ne', 'sw', 'se'
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialBox, setInitialBox] = useState<{ xmin: number; ymin: number; xmax: number; ymax: number } | null>(null);

  const persistImageSearchState = useCallback((payload: {
    imageSearchInput: string;
    imageSearchPreview: string;
    imageOriginalSize: { width: number; height: number } | null;
    selectedObjectBox: number[] | null;
  }) => {
    try {
      sessionStorage.setItem(IMAGE_SEARCH_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, []);

  const readImageSearchState = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(IMAGE_SEARCH_STATE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const input = String(parsed.imageSearchInput || '').trim();
      const preview = String(parsed.imageSearchPreview || '').trim();
      if (!input || !preview) return null;
      return {
        imageSearchInput: input,
        imageSearchPreview: preview,
        imageOriginalSize: parsed.imageOriginalSize
          && typeof parsed.imageOriginalSize.width === 'number'
          && typeof parsed.imageOriginalSize.height === 'number'
          ? { width: parsed.imageOriginalSize.width, height: parsed.imageOriginalSize.height }
          : null,
        selectedObjectBox: Array.isArray(parsed.selectedObjectBox)
          ? parsed.selectedObjectBox.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
          : null
      };
    } catch {
      return null;
    }
  }, []);

  const clearImageSearchStateCache = useCallback(() => {
    try {
      sessionStorage.removeItem(IMAGE_SEARCH_STATE_STORAGE_KEY);
    } catch {}
  }, []);

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

  const startImageSearch = useCallback(async (imageBase64: string, width?: number, height?: number) => {
    setLoading(false); 
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
    if (width && height) setImageOriginalSize({width, height});
    setActiveQuery(IMAGE_QUERY_LABEL);
    setQueryInput(IMAGE_QUERY_LABEL);
    if (inputRef.current) inputRef.current.blur();
    setIsInputFocused(false);

    setDetectedObjects([]);
    setSelectedObjectBox(null);
    setShowImagePopup(true);
    setIsAnalyzingImage(false); // We no longer analyze
    persistImageSearchState({
      imageSearchInput: imageBase64,
      imageSearchPreview: imageBase64,
      imageOriginalSize: width && height ? { width, height } : null,
      selectedObjectBox: null
    });

    // Calculate initial box based on actual image dimensions
    const img = new Image();
    img.decoding = 'async';
    img.src = imageBase64;
    img.onload = () => {
      const width = img.width;
      const height = img.height;
      const cx = width / 2;
      const cy = height / 2;
      const bw = width * 0.5;
      const bh = height * 0.5;
      const xmin = cx - bw / 2;
      const ymin = cy - bh / 2;
      const xmax = cx + bw / 2;
      const ymax = cy + bh / 2;
      
      setImageOriginalSize({ width, height });
      setDetectedObjects([{ label: 'manual', score: 1, box: [xmin, ymin, xmax, ymax] }]);
    };
    img.onerror = () => {
      setImageOriginalSize(null);
      setDetectedObjects([]);
    };
  }, [persistImageSearchState]);

  // Handle Drag & Resize for manual crop box
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!imageOriginalSize || detectedObjects.length === 0) return;
      
      const el = cropBoxRef.current?.parentElement;
      if (!el) return;

      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      const parentRect = el.getBoundingClientRect();
      const dx = ((clientX - dragStart.x) / parentRect.width) * imageOriginalSize.width;
      const dy = ((clientY - dragStart.y) / parentRect.height) * imageOriginalSize.height;

      const currentBox = detectedObjects[0].box;
      let [xmin, ymin, xmax, ymax] = initialBox ? [initialBox.xmin, initialBox.ymin, initialBox.xmax, initialBox.ymax] : currentBox;

      if (isDragging) {
        xmin += dx;
        xmax += dx;
        ymin += dy;
        ymax += dy;
        
        // Boundaries
        const width = xmax - xmin;
        const height = ymax - ymin;
        if (xmin < 0) { xmin = 0; xmax = width; }
        if (ymin < 0) { ymin = 0; ymax = height; }
        if (xmax > imageOriginalSize.width) { xmax = imageOriginalSize.width; xmin = xmax - width; }
        if (ymax > imageOriginalSize.height) { ymax = imageOriginalSize.height; ymin = ymax - height; }
      } else if (isResizing) {
        if (isResizing.includes('w')) xmin += dx;
        if (isResizing.includes('e')) xmax += dx;
        if (isResizing.includes('n')) ymin += dy;
        if (isResizing.includes('s')) ymax += dy;

        // Minimum size
        const minSize = imageOriginalSize.width * 0.1;
        if (xmax - xmin < minSize) {
          if (isResizing.includes('w')) xmin = xmax - minSize;
          if (isResizing.includes('e')) xmax = xmin + minSize;
        }
        if (ymax - ymin < minSize) {
          if (isResizing.includes('n')) ymin = ymax - minSize;
          if (isResizing.includes('s')) ymax = ymin + minSize;
        }

        // Boundaries
        xmin = Math.max(0, Math.min(xmin, xmax - minSize));
        ymin = Math.max(0, Math.min(ymin, ymax - minSize));
        xmax = Math.min(imageOriginalSize.width, Math.max(xmax, xmin + minSize));
        ymax = Math.min(imageOriginalSize.height, Math.max(ymax, ymin + minSize));
      }

      setDetectedObjects([{ label: 'manual', score: 1, box: [xmin, ymin, xmax, ymax] }]);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, isResizing, dragStart, imageOriginalSize, initialBox, detectedObjects]);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent, action: string) => {
    e.stopPropagation();
    if (action === 'drag') e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    setDragStart({ x: clientX, y: clientY });
    setInitialBox({
      xmin: detectedObjects[0].box[0],
      ymin: detectedObjects[0].box[1],
      xmax: detectedObjects[0].box[2],
      ymax: detectedObjects[0].box[3],
    });
    if (action === 'drag') setIsDragging(true);
    else setIsResizing(action);
  };

  const handleObjectSelection = useCallback(async (box: number[] | null) => {
    if (!imageSearchInput) return;
    setShowImagePopup(false);
    setSelectedObjectBox(box);
    setLoading(true);
    setResults([]);
    setError(null);

    try {
      if (box) {
        const data = await searchProductsByImageCrop(imageSearchInput, box, 1, LIMIT);
        setResults(Array.isArray(data.products) ? data.products : []);
        setHasMore(Boolean(data.hasMore));
        hasMoreRef.current = Boolean(data.hasMore);
        setPage(1);
        pageRef.current = 1;
      } else {
        const data = await searchProductsByImage(imageSearchInput, 1, LIMIT);
        setResults(Array.isArray(data.products) ? data.products : []);
        setHasMore(Boolean(data.hasMore));
        hasMoreRef.current = Boolean(data.hasMore);
        setPage(1);
        pageRef.current = 1;
      }
    } catch (err: any) {
      setError('فشل البحث في المنطقة المحددة.');
    } finally {
      setLoading(false);
    }
  }, [imageSearchInput]);

  const clearImageSearch = useCallback(() => {
    
    setImageSearchInput(null);
    setImageSearchPreview(null);
    setImageOriginalSize(null);
    setSelectedObjectBox(null);
    setDetectedObjects([]);
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
    clearImageSearchStateCache();
    
    // Reset file input to ensure it works for photo search again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    
    navigate('/search', { replace: true });
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 50);
  }, [clearImageSearchStateCache, navigate]);

  useEffect(() => {
    // Check if we arrived here with a pending image search
    const pendingImage = sessionStorage.getItem('pendingImageSearch');
    if (pendingImage) {
      sessionStorage.removeItem('pendingImageSearch');
      void startImageSearch(pendingImage);
      return;
    }
    const cachedImageState = readImageSearchState();
    if (!cachedImageState) return;
    setImageSearchInput(cachedImageState.imageSearchInput);
    setImageSearchPreview(cachedImageState.imageSearchPreview);
    setImageOriginalSize(cachedImageState.imageOriginalSize);
    setSelectedObjectBox(cachedImageState.selectedObjectBox);
    setShowImagePopup(false);
    setIsAnalyzingImage(false);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setActiveQuery(IMAGE_QUERY_LABEL);
    setQueryInput(IMAGE_QUERY_LABEL);
  }, [IMAGE_QUERY_LABEL, readImageSearchState, startImageSearch]);

  useEffect(() => {
    if (!imageSearchInput || !imageSearchPreview) return;
    persistImageSearchState({
      imageSearchInput,
      imageSearchPreview,
      imageOriginalSize,
      selectedObjectBox
    });
  }, [imageSearchInput, imageSearchPreview, imageOriginalSize, persistImageSearchState, selectedObjectBox]);

  useEffect(() => {
    if (initialQuery.trim()) return;
    // Focus the input when component mounts or when user navigates to search without query
    const focusInput = () => {
      if (inputRef.current) {
        inputRef.current.focus();
        // On mobile, we might need to ensure the virtual keyboard shows
        inputRef.current.setAttribute('inputmode', 'search');
      }
    };
    
    // Try focusing immediately, then again after a short delay for safety
    focusInput();
    const timer = setTimeout(focusInput, 100);
    
    return () => clearTimeout(timer);
  }, [initialQuery]);

  useEffect(() => {
    if (imageSearchInput) return;
    const normalizedInitialQuery = normalizeArabicSearchTerm(initialQuery);
    setQueryInput(normalizedInitialQuery);
    setActiveQuery(normalizedInitialQuery);
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
  
  const filteredRecentTerms = useMemo(() => {
    const q = queryInput.trim().toLowerCase();
    if (!q) return recentTerms;
    return recentTerms.filter((term) => term.toLowerCase().includes(q));
  }, [queryInput, recentTerms]);

  // New search effect using embedding search
  useEffect(() => {
    const query = activeQuery.trim();
    if (!query || imageSearchInput) return;

    let cancelled = false;
    const runSearch = async () => {
      // Only use cache on first render (when user didn't explicitly submit a new search)
      // When searchVersion increments, it means user explicitly searched, so ignore cache
      if (isFirstRender.current && cacheKey && cachedData) {
        return;
      }
      
      setLoading(true);
      setLoadingMore(false);
      setResults([]);
      const initialPage = 1;
      setPage(initialPage);
      setHasMore(false);
      pageRef.current = initialPage;
      hasMoreRef.current = false;
      inFlightMoreRef.current = false;
      scrollRatioRef.current = 0;
      setError(null);
      rememberSearchTerm(query);

      try {
        const response = await searchProducts(query, initialPage, LIMIT);
        if (cancelled) return;

        // Translation toast removed - no longer needed
        // const methodLabel = translationMethodLabel(response.translationMethod);
        // const methodText = methodLabel ? ` [${methodLabel}]` : '';
        // showToast(`تم الترجمة إلى: ${response.translatedQuery}${methodText}`, 'info', 5000);
        
        const orderedResults = Array.isArray(response.products) ? response.products : [];
        setResults(orderedResults);
        setHasMore(Boolean(response.hasMore));
        
        // Save to cache
        if (cacheKey) {
          setSearchData(cacheKey, {
            results: orderedResults,
            page: initialPage,
            hasMore: Boolean(response.hasMore),
            condition: null,
            price: null,
            scrollPos: 0
          });
        }
      } catch (searchError: any) {
        if (cancelled) return;
        const message = searchError?.message || 'فشل البحث';
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
  }, [activeQuery, rememberSearchTerm, searchVersion, imageSearchInput, cacheKey, setSearchData, showToast]);

  // Mark first render as done
  useEffect(() => {
    isFirstRender.current = false;
  }, []);

  // New loadMore using embedding search
  const loadMore = useCallback(async () => {
    const query = activeQueryRef.current.trim();
    if (imageSearchInput) {
      // Keep image search logic
      if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
      if (inFlightMoreRef.current) return;

      inFlightMoreRef.current = true;
      setLoadingMore(true);
      const nextPage = pageRef.current + 1;
      try {
        const response = selectedObjectBox
          ? await searchProductsByImageCrop(imageSearchInput, selectedObjectBox, nextPage, LIMIT)
          : await searchProductsByImage(imageSearchInput, nextPage, LIMIT);
        if (!activeQueryRef.current.trim()) return;
        const incoming = Array.isArray(response.products) ? response.products : [];
        const newResults = (prev: Product[]) => {
          const merged = [...prev, ...incoming];
          const seen = new Set<string>();
          return merged.filter((item) => {
            const key = item?.id == null ? '' : String(item.id);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        };
        setResults(newResults);
        setHasMore(Boolean(response.hasMore));
        setPage(nextPage);
        pageRef.current = nextPage;
      } catch (searchError: any) {
        setError(searchError?.message || 'فشل تحميل المزيد');
      } finally {
        setLoadingMore(false);
        inFlightMoreRef.current = false;
      }
      return;
    }

    if (!query || !hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
    if (inFlightMoreRef.current) return;

    inFlightMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      const response = await searchProducts(query, nextPage, LIMIT);
      if (activeQueryRef.current.trim() !== query) return;
      const incoming = Array.isArray(response.products) ? response.products : [];
      let updatedResults: Product[] = [];
      setResults((prev) => {
        const merged = [...prev, ...incoming];
        const seen = new Set<string>();
        updatedResults = merged.filter((item) => {
          const key = item?.id == null ? '' : String(item.id);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return updatedResults;
      });
      setHasMore(Boolean(response.hasMore));
      setPage(nextPage);
      pageRef.current = nextPage;
      
      // Save to cache
      if (cacheKey) {
        setSearchData(cacheKey, {
          results: updatedResults,
          page: nextPage,
          hasMore: Boolean(response.hasMore),
          condition: null,
          price: null
        });
      }
    } catch (searchError: any) {
      setError(searchError?.message || 'فشل تحميل المزيد');
    } finally {
      setLoadingMore(false);
      inFlightMoreRef.current = false;
    }
  }, [imageSearchInput, selectedObjectBox, cacheKey, setSearchData]);

  useEffect(() => {
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
  }, [loadMore]);

  const submitSearch = () => {
    if (imageSearchInput) return;
    const q = queryInput.trim();
    if (!q || q === IMAGE_QUERY_LABEL) return;
    const normalizedQuery = normalizeArabicSearchTerm(q);
    setActiveQuery(normalizedQuery);
    setSearchVersion((v) => v + 1);
    setIsInputFocused(false);
    // Blur the input to dismiss keyboard on mobile
    if (inputRef.current) {
      inputRef.current.blur();
    }
    setRecentTerms(readRecentTerms());
    navigate(`/search?q=${encodeURIComponent(normalizedQuery)}`, { replace: true });
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
    if (imageSearchInput && imageSearchPreview) {
      persistImageSearchState({
        imageSearchInput,
        imageSearchPreview,
        imageOriginalSize,
        selectedObjectBox
      });
    }
    navigate(`/product?id=${id}`, { state: { initialProduct: product } });
  }, [imageOriginalSize, imageSearchInput, imageSearchPreview, navigate, persistImageSearchState, selectedObjectBox]);

  const isProductInWishlist = (productId: number | string) => {
    const normalizedProductId = normalizeWishlistProductId(productId);
    if (!normalizedProductId) return false;
    return wishlistItems.some(item => normalizeWishlistProductId(item.productId) === normalizedProductId);
  };

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
          <div 
            className="flex-1 flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5 cursor-text"
            onClick={() => {
              if (inputRef.current) {
                // If we're in image search mode and user clicks, clear it first
                if (isImageSearch) {
                  clearImageSearch();
                  // Focus after a brief delay to ensure state is cleared
                  setTimeout(() => {
                    if (inputRef.current) inputRef.current.focus();
                  }, 10);
                } else {
                  inputRef.current.focus();
                }
              }
            }}
          >
            {isImageSearch ? <Camera size={16} className="text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400" /> : <Search size={16} className="text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400" />}
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onFocus={() => {
                setIsInputFocused(true);
                // If we're in image search mode and user focuses, clear it
                if (isImageSearch) {
                  clearImageSearch();
                }
              }}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitSearch();
                }
              }}
              placeholder="ابحث عن منتج..."
              className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400"
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
                className="p-1 text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
            <label className="p-1 cursor-pointer text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 hover:text-primary transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const fileToDataUrl = (selectedFile: File) => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.onerror = () => reject(new Error('read_failed'));
                    reader.readAsDataURL(selectedFile);
                  });

                  const fileToJpegDataUrl = (selectedFile: File) => new Promise<string>((resolve, reject) => {
                    const img = new Image();
                    img.decoding = 'async';
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
                      void startImageSearch(payload);
                    }
                  } finally {
                    e.target.value = '';
                  }
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
      </div>

      {showImagePopup && imageSearchPreview && (
        <div className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 flex flex-col items-center justify-center p-4">
          {isAnalyzingImage ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-background-light dark:bg-background-dark min-h-[60vh] w-full absolute inset-0 relative">
              <div className="absolute top-4 left-4 z-50">
                <button 
                  onClick={() => {
                    setShowImagePopup(false);
                    clearImageSearch();
                  }} 
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:hover:text-white p-2 rounded-full bg-slate-100 dark:bg-slate-800"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300 text-center mb-2">
                    هذا قد يستغرق حتى 10 ثوانٍ لذا انتظر بصبر
                  </p>
                  <div className="flex gap-1 mb-2">
                    <div className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="size-1.5 rounded-full bg-primary animate-bounce"></div>
                  </div>
                  <p className="text-sm font-bold text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 animate-pulse">
                    جاري تحليل الصورة...
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center w-full max-w-2xl mb-4 relative z-10">
                <h3 className="text-slate-900 dark:text-white font-bold text-lg">
                  اختر العنصر للبحث
                </h3>
                <button 
                  onClick={() => {
                    setShowImagePopup(false);
                    if (detectedObjects.length > 0) {
                       handleObjectSelection(detectedObjects[0].box);
                    } else {
                       handleObjectSelection(null);
                    }
                  }} 
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:hover:text-white p-2 rounded-full bg-slate-100 dark:bg-slate-800"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="relative inline-block max-w-full z-10">
                <img 
                  src={imageSearchPreview} 
                  className="max-w-full max-h-[70vh] block object-contain" 
                  alt="Preview"
                />
                {/* Show a helpful message when waiting for manual crop */}
                {detectedObjects.length === 1 && detectedObjects[0].label === 'manual' && !selectedObjectBox && !isAnalyzingImage && (
                  <div style={{
                    position: 'absolute',
                    top: '10%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    zIndex: 20,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none'
                  }}>
                    قم بتغيير حجم المربع لتحديد المنتج الذي تبحث عنه
                  </div>
                )}
                {/* Box overlays */}
                {detectedObjects.map((obj, idx) => {
                   if (!imageOriginalSize) return null;
                   const [xmin, ymin, xmax, ymax] = obj.box;
                   const isManual = obj.label === 'manual';
                   const left = (xmin / imageOriginalSize.width) * 100;
                   const top = (ymin / imageOriginalSize.height) * 100;
                   const width = ((xmax - xmin) / imageOriginalSize.width) * 100;
                   const height = ((ymax - ymin) / imageOriginalSize.height) * 100;

                   return (
                     <div
                       key={idx}
                       ref={isManual ? cropBoxRef : null}
                       onClick={() => !isManual && handleObjectSelection(obj.box)}
                       onMouseDown={(e) => isManual && handlePointerDown(e, 'drag')}
                       onTouchStart={(e) => isManual && handlePointerDown(e, 'drag')}
                       className={`absolute border-[3px] border-primary transition-colors flex items-center justify-center rounded-sm ${isManual ? '' : 'bg-primary/10 cursor-pointer hover:bg-primary/30'}`}
                       style={{
                         left: `${left}%`,
                         top: `${top}%`,
                         width: `${width}%`,
                         height: `${height}%`
                       }}
                     >
                       {isManual && (
                         <>
                           {/* Resize handles */}
                           <div 
                             className="absolute -right-1.5 -top-1.5 size-3 bg-white rounded-full border border-primary"
                             onMouseDown={(e) => handlePointerDown(e, 'ne')}
                             onTouchStart={(e) => handlePointerDown(e, 'ne')}
                           />
                           <div 
                             className="absolute -left-1.5 -top-1.5 size-3 bg-white rounded-full border border-primary"
                             onMouseDown={(e) => handlePointerDown(e, 'nw')}
                             onTouchStart={(e) => handlePointerDown(e, 'nw')}
                           />
                           <div 
                             className="absolute -right-1.5 -bottom-1.5 size-3 bg-white rounded-full border border-primary"
                             onMouseDown={(e) => handlePointerDown(e, 'se')}
                             onTouchStart={(e) => handlePointerDown(e, 'se')}
                           />
                           <div 
                             className="absolute -left-1.5 -bottom-1.5 size-3 bg-white rounded-full border border-primary"
                             onMouseDown={(e) => handlePointerDown(e, 'sw')}
                             onTouchStart={(e) => handlePointerDown(e, 'sw')}
                           />
                         </>
                       )}
                     </div>
                   );
                })}
              </div>
              <div className="mt-6 w-full max-w-md">
                <button 
                  onClick={() => {
                    if (detectedObjects.length > 0) {
                      handleObjectSelection(detectedObjects[0].box);
                    } else {
                      handleObjectSelection(null);
                    }
                  }}
                  className="w-full bg-primary text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Search size={16} />
                  بحث
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isInputFocused && !isImageSearch && (
        <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 max-h-[40vh] overflow-y-auto">
          {filteredRecentTerms.length > 0 && (
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 mb-2">بحث حديث</h3>
              <div className="flex flex-wrap gap-2">
                {filteredRecentTerms.map((term, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const normalizedTerm = normalizeArabicSearchTerm(term);
                      setQueryInput(normalizedTerm);
                      setActiveQuery(normalizedTerm);
                      setSearchVersion((v) => v + 1);
                      setIsInputFocused(false);
                      if (inputRef.current) inputRef.current.blur();
                      navigate(`/search?q=${encodeURIComponent(normalizedTerm)}`, { replace: true });
                    }}
                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-full"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}



      {loading ? (
        <div className="px-4 py-12">
          <div className="flex flex-col items-center justify-center gap-4 mb-8">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 text-center mb-2">
              هذا قد يستغرق حتى 10 ثوانٍ لذا انتظر بصبر
            </p>
            <div className="flex gap-1">
              <div className="size-3 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
              <div className="size-3 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
              <div className="size-3 rounded-full bg-primary animate-bounce"></div>
            </div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 animate-pulse">
              جاري البحث...
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden">
                <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-700 animate-pulse" />
                <div className="p-3 flex flex-col gap-2">
                  <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-4 w-1/3 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="px-4 py-12">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500">
              <AlertCircle size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">حصل خطأ</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setSearchVersion((v) => v + 1)}
              className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-xs font-bold"
            >
              إعادة المحاولة
            </button>
          </div>
        </div>
      ) : results.length > 0 ? (
        <>
          <div className="px-4 pb-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 font-medium mt-1 mb-3">
              {hasMore ? `+${results.length} منتجات` : `${results.length} منتجات`}
            </p>
          </div>
          <div className="px-4 pb-6">
            <div className="grid grid-cols-2 gap-4">
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
          </div>
          {loadingMore && (
            <div className="px-4 pb-12">
              <div className="grid grid-cols-2 gap-4">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden">
                    <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-700 animate-pulse" />
                    <div className="p-3 flex flex-col gap-2">
                      <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                      <div className="h-3 w-1/2 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                      <div className="h-4 w-1/3 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        !activeQuery.trim() && !isImageSearch ? (
          <div className="px-4 py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400">
                <Search size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">ابحث عن منتجات</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400">اكتب ما تبحث عنه أو اختر صورة للبحث</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400">
                <Search size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">لم نجد نتائج</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400 dark:text-slate-500 dark:text-slate-400">حاول استخدام كلمات بحث أخرى</p>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default SearchResults;
