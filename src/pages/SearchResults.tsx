import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Search, ArrowRight, Camera, X } from 'lucide-react';
import {
  searchCategorySuggestions,
  searchProductsByCategory,
  searchProductsByImage,
  searchProductsByImageCrop
} from '../services/api';
import type { CategorySuggestion } from '../services/api';
import FilterBar from '../components/home/FilterBar';
import ProductCard from '../components/home/ProductCard';
import { normalizeWishlistProductId, useWishlistStore } from '../store/useWishlistStore';
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
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialQuery = searchParams.get('q') || '';
  const initialCategoryId = searchParams.get('categoryId') || '';
  const initialCategoryName = searchParams.get('categoryName') || '';
  const IMAGE_QUERY_LABEL = 'بحث بالصورة';
  const IMAGE_SEARCH_CACHE_KEY = '__image_search__';
  const IMAGE_SEARCH_STATE_STORAGE_KEY = 'image_search_state_v1';
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialCategoryName || initialQuery);
  const [activeCategory, setActiveCategory] = useState<CategorySuggestion | null>(
    initialCategoryId
      ? {
          id: initialCategoryId,
          nameAr: initialCategoryName || initialQuery,
          pathAr: initialCategoryName || initialQuery
        }
      : null
  );
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [imageSearchInput, setImageSearchInput] = useState<string | null>(null);
  const [imageSearchPreview, setImageSearchPreview] = useState<string | null>(null);
  const [imageOriginalSize, setImageOriginalSize] = useState<{width: number, height: number} | null>(null);
  const [showImagePopup, setShowImagePopup] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<any[]>([]);
  const [selectedObjectBox, setSelectedObjectBox] = useState<number[] | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
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
  const restoredFromCacheRef = useRef(false);
  const activeQueryRef = useRef(activeQuery);
  const activeCategoryRef = useRef(activeCategory);
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
  const RECENT_CATEGORY_CLICKS_KEY = 'recent_category_clicks_v1';
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isImageSearch = Boolean(imageSearchInput && imageSearchPreview);
  const activeCategoryKey = activeCategory?.id ? `category:${activeCategory.id}` : '';

  type RecentCategoryEntry = Pick<CategorySuggestion, 'id' | 'nameAr' | 'pathAr'>;

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

  const normalizeRecentCategory = useCallback((value: any): RecentCategoryEntry | null => {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || '').trim();
    const nameAr = String(value.nameAr || value.pathAr || '').trim();
    const pathAr = String(value.pathAr || value.nameAr || '').trim();
    if (!id || !nameAr) return null;
    return { id, nameAr, pathAr: pathAr || nameAr };
  }, []);

  const readRecentCategories = useCallback((): RecentCategoryEntry[] => {
    try {
      const raw = localStorage.getItem(RECENT_CATEGORY_CLICKS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      return list
        .map((item) => normalizeRecentCategory(item))
        .filter((item): item is RecentCategoryEntry => Boolean(item))
        .slice(0, 12);
    } catch {
      return [];
    }
  }, [normalizeRecentCategory]);

  const rememberRecentCategory = useCallback((category: CategorySuggestion) => {
    const normalized = normalizeRecentCategory(category);
    if (!normalized) return;
    try {
      const current = readRecentCategories();
      const next = [normalized, ...current.filter((item) => item.id !== normalized.id)].slice(0, 12);
      localStorage.setItem(RECENT_CATEGORY_CLICKS_KEY, JSON.stringify(next));
    } catch {}
  }, [normalizeRecentCategory, readRecentCategories]);

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
  const [recentCategories, setRecentCategories] = useState<RecentCategoryEntry[]>(() => readRecentCategories());

  useEffect(() => {
    if (!isInputFocused) return;
    setRecentTerms(readRecentTerms());
    setRecentCategories(readRecentCategories());
  }, [isInputFocused, readRecentCategories, readRecentTerms]);

  const startImageSearch = useCallback(async (imageBase64: string, width?: number, height?: number) => {
    restoredFromCacheRef.current = false;
    setRestored(false);
    setLoading(false); // don't show loading on main screen yet
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
    restoredFromCacheRef.current = false;
    setRestored(false);
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
    usePageCacheStore.getState().setSearchData(IMAGE_SEARCH_CACHE_KEY, {
      results: [],
      page: 1,
      hasMore: false,
      condition: null,
      price: null,
      scrollPos: 0
    });
    usePageCacheStore.getState().setSearchScrollPos(IMAGE_SEARCH_CACHE_KEY, 0);
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
    if (initialQuery.trim()) return;
    const cachedImageState = readImageSearchState();
    const cachedSearch = usePageCacheStore.getState().getSearchData(IMAGE_SEARCH_CACHE_KEY);
    if (!cachedImageState || !cachedSearch || !Array.isArray(cachedSearch.results) || cachedSearch.results.length === 0) return;
    restoredFromCacheRef.current = true;
    setRestored(true);
    setImageSearchInput(cachedImageState.imageSearchInput);
    setImageSearchPreview(cachedImageState.imageSearchPreview);
    setImageOriginalSize(cachedImageState.imageOriginalSize);
    setSelectedObjectBox(cachedImageState.selectedObjectBox);
    setShowImagePopup(false);
    setIsAnalyzingImage(false);
    setConditionFilter(null);
    setPriceFilter(null);
    setDraftConditionFilter(null);
    setDraftPriceFilter(null);
    setResults(cachedSearch.results);
    setHasMore(Boolean(cachedSearch.hasMore));
    hasMoreRef.current = Boolean(cachedSearch.hasMore);
    const restoredPage = Math.max(1, Number(cachedSearch.page || 1));
    setPage(restoredPage);
    pageRef.current = restoredPage;
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setActiveQuery(IMAGE_QUERY_LABEL);
    setQueryInput(IMAGE_QUERY_LABEL);
    const pos = Number(cachedSearch.scrollPos || 0);
    if (pos > 0) {
      setTimeout(() => {
        window.scrollTo(0, pos);
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop = pos;
        }
      }, 100);
    }
  }, [IMAGE_QUERY_LABEL, initialQuery, readImageSearchState, startImageSearch]);

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
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 50);
  }, [initialQuery]);

  useEffect(() => {
    if (imageSearchInput) return;
    setQueryInput(initialQuery);
    setActiveQuery(initialCategoryName || initialQuery);
    setActiveCategory(
      initialCategoryId
        ? {
            id: initialCategoryId,
            nameAr: initialCategoryName || initialQuery,
            pathAr: initialCategoryName || initialQuery
          }
        : null
    );
  }, [initialCategoryId, initialCategoryName, initialQuery, imageSearchInput]);

  useEffect(() => {
    if (imageSearchInput) return;
    const key = initialCategoryId ? `category:${initialCategoryId}` : '';
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
  }, [initialCategoryId, imageSearchInput]);

  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  useEffect(() => {
    activeCategoryRef.current = activeCategory;
  }, [activeCategory]);

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

  const filteredRecentTerms = useMemo(() => {
    const q = queryInput.trim().toLowerCase();
    if (!q) return recentTerms;
    return recentTerms.filter((term) => term.toLowerCase().includes(q));
  }, [queryInput, recentTerms]);

  const filteredRecentCategories = useMemo(() => {
    const q = queryInput.trim().toLowerCase();
    if (!q) return recentCategories;
    return recentCategories.filter((category) => {
      const name = category.nameAr.toLowerCase();
      const path = category.pathAr.toLowerCase();
      return name.includes(q) || path.includes(q);
    });
  }, [queryInput, recentCategories]);

  useEffect(() => {
    if (isImageSearch) {
      setCategorySuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const q = queryInput.trim();
    if (!q || q === IMAGE_QUERY_LABEL) {
      setCategorySuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    const timerId = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const response = await searchCategorySuggestions(q, 20);
        if (cancelled) return;
        setCategorySuggestions(Array.isArray(response.categories) ? response.categories : []);
      } catch {
        if (cancelled) return;
        setCategorySuggestions([]);
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [IMAGE_QUERY_LABEL, isImageSearch, queryInput]);

  useEffect(() => {
    const query = activeQuery.trim();
    const category = activeCategory;
    if (!category?.id) {
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
    rememberSearchTerm(query || category.nameAr || category.pathAr || '');
    let cancelled = false;
    const runSearch = async () => {
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
      try {
        const maxPrice = priceFilter === '1k' ? 1000 : priceFilter === '5k' ? 5000 : priceFilter === '10k' ? 10000 : priceFilter === '25k' ? 25000 : undefined;
        const condition = conditionFilter === 'new' ? 'new' : conditionFilter === 'used' ? 'used' : undefined;
        const response = await searchProductsByCategory(category, initialPage, LIMIT, maxPrice, condition);
        if (cancelled) return;
        const orderedResults = Array.isArray(response.products) ? response.products : [];
        setResults(orderedResults);
        setHasMore(Boolean(response.hasMore));
      } catch (searchError: any) {
        if (cancelled) return;
        const message = searchError?.message || 'فشل تحميل منتجات القسم';
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
  }, [activeCategory, activeQuery, conditionFilter, priceFilter, restored, rememberSearchTerm, searchVersion, imageSearchInput]);

  const loadMore = useCallback(async () => {
    const query = activeQueryRef.current.trim();
    const category = activeCategoryRef.current;
    if (!imageSearchInput && !category?.id) return;
    if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
    if (inFlightMoreRef.current) return;

    inFlightMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      if (imageSearchInput) {
        const response = selectedObjectBox
          ? await searchProductsByImageCrop(imageSearchInput, selectedObjectBox, nextPage, LIMIT)
          : await searchProductsByImage(imageSearchInput, nextPage, LIMIT);
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
      const response = await searchProductsByCategory(category, nextPage, LIMIT, maxPrice, condition);
      if (activeQueryRef.current.trim() !== query || activeCategoryRef.current?.id !== category?.id) return;
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
      if (activeQueryRef.current.trim() !== query || activeCategoryRef.current?.id !== category?.id) return;
      const message = searchError?.message || 'فشل تحميل المزيد من منتجات القسم';
      setError(message);
    } finally {
      if (activeQueryRef.current.trim() === query && (imageSearchInput || activeCategoryRef.current?.id === category?.id)) {
        setLoadingMore(false);
      }
      inFlightMoreRef.current = false;
    }
  }, [imageSearchInput, selectedObjectBox]);

  useEffect(() => {
    const key = imageSearchInput ? IMAGE_SEARCH_CACHE_KEY : activeCategoryKey;
    if (!key) return;

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
  }, [IMAGE_SEARCH_CACHE_KEY, activeCategoryKey, imageSearchInput, loadMore]);

  useEffect(() => {
    const key = imageSearchInput ? IMAGE_SEARCH_CACHE_KEY : activeCategoryKey;
    if (!key) return;
    usePageCacheStore.getState().setSearchData(key, {
      results,
      page,
      hasMore,
      condition: imageSearchInput ? null : conditionFilter as any,
      price: imageSearchInput ? null : priceFilter as any,
    });
  }, [IMAGE_SEARCH_CACHE_KEY, activeCategoryKey, conditionFilter, hasMore, imageSearchInput, page, priceFilter, results]);

  useEffect(() => {
    const key = imageSearchInput ? IMAGE_SEARCH_CACHE_KEY : activeCategoryKey;
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
  }, [IMAGE_SEARCH_CACHE_KEY, activeCategoryKey, imageSearchInput]);

  const selectCategory = useCallback((category: CategorySuggestion) => {
    const label = category.nameAr || category.pathAr || queryInput.trim();
    restoredFromCacheRef.current = false;
    setRestored(false);
    setResults([]);
    setHasMore(false);
    setPage(1);
    setError(null);
    setLoading(true);
    setCategorySuggestions([]);
    setActiveCategory(category);
    setActiveQuery(label);
    setQueryInput(label);
    setSearchVersion((v) => v + 1);
    setIsInputFocused(false);
    rememberSearchTerm(label);
    rememberRecentCategory(category);
    if (inputRef.current) inputRef.current.blur();
    setRecentTerms(readRecentTerms());
    setRecentCategories(readRecentCategories());
    navigate(`/search?q=${encodeURIComponent(label)}&categoryId=${encodeURIComponent(category.id)}&categoryName=${encodeURIComponent(label)}`, { replace: true });
  }, [navigate, queryInput, readRecentCategories, readRecentTerms, rememberRecentCategory, rememberSearchTerm]);

  const submitSearch = () => {
    if (imageSearchInput) return;
    const q = queryInput.trim();
    if (!q || q === IMAGE_QUERY_LABEL) return;
    const exactMatch = categorySuggestions.find((item) => item.nameAr === q || item.pathAr === q);
    if (exactMatch) {
      selectCategory(exactMatch);
      return;
    }
    if (categorySuggestions.length > 0) {
      selectCategory(categorySuggestions[0]);
      return;
    }
    setActiveCategory(null);
    setActiveQuery(q);
    setResults([]);
    setHasMore(false);
    setPage(1);
    setLoading(false);
    setError('اختر قسمًا من القائمة لعرض المنتجات.');
    navigate(`/search?q=${encodeURIComponent(q)}`, { replace: true });
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
    const key = imageSearchInput
      ? IMAGE_SEARCH_CACHE_KEY
      : (activeCategoryRef.current?.id ? `category:${activeCategoryRef.current.id}` : '');
    if (key) {
      const scrollY = window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      usePageCacheStore.getState().setSearchScrollPos(key, scrollY);
      usePageCacheStore.getState().setSearchData(key, {
        results,
        page: pageRef.current,
        hasMore: hasMoreRef.current,
        condition: imageSearchInput ? null : conditionFilterRef.current as any,
        price: imageSearchInput ? null : priceFilterRef.current as any,
      });
    }
    if (imageSearchInput && imageSearchPreview) {
      persistImageSearchState({
        imageSearchInput,
        imageSearchPreview,
        imageOriginalSize,
        selectedObjectBox
      });
    }
    navigate(`/product?id=${id}`, { state: { initialProduct: product } });
  }, [imageOriginalSize, imageSearchInput, imageSearchPreview, navigate, persistImageSearchState, results, selectedObjectBox]);

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
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white p-2 rounded-full bg-slate-100 dark:bg-slate-800"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-1">
                  <div className="flex gap-1 mb-2">
                    <div className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="size-1.5 rounded-full bg-primary animate-bounce"></div>
                  </div>
                  <p className="text-sm font-bold text-slate-500 animate-pulse">
                    جاري تحليل الصورة...
                  </p>
                  <p className="text-xs font-semibold text-slate-400 mt-2 text-center max-w-[200px]">
                    قد يستغرق هذا بضع ثوانٍ، يرجى الانتظار
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
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white p-2 rounded-full bg-slate-100 dark:bg-slate-800"
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
                         height: `${height}%`,
                         boxShadow: isManual ? '0 0 0 9999px rgba(0, 0, 0, 0.5)' : 'none',
                         cursor: isManual ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                         zIndex: 10,
                         touchAction: 'none'
                       }}
                     >
                       {isManual && (
                         <>
                           {/* Resize Handles */}
                           <div
                             onMouseDown={(e) => handlePointerDown(e, 'nw')}
                             onTouchStart={(e) => handlePointerDown(e, 'nw')}
                             className="absolute -top-2 -left-2 w-5 h-5 bg-white border-2 border-primary rounded-full cursor-nwse-resize z-20"
                           />
                           <div
                             onMouseDown={(e) => handlePointerDown(e, 'ne')}
                             onTouchStart={(e) => handlePointerDown(e, 'ne')}
                             className="absolute -top-2 -right-2 w-5 h-5 bg-white border-2 border-primary rounded-full cursor-nesw-resize z-20"
                           />
                           <div
                             onMouseDown={(e) => handlePointerDown(e, 'sw')}
                             onTouchStart={(e) => handlePointerDown(e, 'sw')}
                             className="absolute -bottom-2 -left-2 w-5 h-5 bg-white border-2 border-primary rounded-full cursor-nesw-resize z-20"
                           />
                           <div
                             onMouseDown={(e) => handlePointerDown(e, 'se')}
                             onTouchStart={(e) => handlePointerDown(e, 'se')}
                             className="absolute -bottom-2 -right-2 w-5 h-5 bg-white border-2 border-primary rounded-full cursor-nwse-resize z-20"
                           />
                         </>
                       )}
                       {!isManual && (
                         <span className="bg-primary text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg transform -translate-y-1/2 -translate-x-1/2 absolute top-0 left-1/2 whitespace-nowrap">
                           {`عنصر ${idx + 1}`}
                         </span>
                       )}
                     </div>
                   )
                })}
              </div>

              <button 
                onClick={() => {
                   if (detectedObjects.length > 0 && detectedObjects[0].label === 'manual') {
                      handleObjectSelection(detectedObjects[0].box);
                   }
                }}
                className="mt-8 bg-primary hover:bg-primary/90 text-white px-8 py-3 rounded-xl font-bold transition-colors z-10 shadow-lg"
              >
                البحث عن الجزء المحدد
              </button>
            </>
          )}
        </div>
      )}

      {isImageSearch && imageSearchPreview && !showImagePopup && (
        <div className="px-4 pt-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="relative w-24 h-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 overflow-hidden group">
                <img
                  src={imageSearchPreview}
                  alt="بحث بالصورة"
                  className="w-full h-full object-contain"
                />
                
                {/* Object Selection Overlay */}
                {detectedObjects.length > 0 && (
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    {/* Visual indicators for detected objects on the image thumbnail */}
                    <div className="absolute inset-0 bg-black/10"></div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-2 w-full overflow-hidden">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">بحث بالصورة</div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                      {detectedObjects.length > 0 
                        ? `تم اكتشاف ${detectedObjects.length} عناصر.` 
                        : 'جاري تحليل الصورة...'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowImagePopup(true)}
                    className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-lg"
                  >
                    تعديل التحديد
                  </button>
                </div>

                {/* Detected Objects List - Now as Image Thumbnails */}
                {detectedObjects.length > 0 && imageOriginalSize && (
                  <div className="flex overflow-x-auto gap-2 pb-2 hide-scrollbar w-full" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {detectedObjects.map((obj, idx) => {
                      const isSelected = selectedObjectBox && 
                        JSON.stringify(selectedObjectBox) === JSON.stringify(obj.box);
                      
                      const [xmin, ymin, xmax, ymax] = obj.box;
                      
                      // Calculate the crop coordinates for background-position
                      // We use percentage to position the background image inside the square thumbnail
                      const widthPercent = (imageOriginalSize.width / (xmax - xmin)) * 100;
                      const heightPercent = (imageOriginalSize.height / (ymax - ymin)) * 100;
                      
                      const leftPercent = (xmin / (imageOriginalSize.width - (xmax - xmin))) * 100 || 0;
                      const topPercent = (ymin / (imageOriginalSize.height - (ymax - ymin))) * 100 || 0;

                      return (
                        <button
                          key={idx}
                          onClick={() => handleObjectSelection(obj.box)}
                          className={`relative flex-shrink-0 size-16 rounded-xl overflow-hidden transition-all border-2 ${
                            isSelected 
                              ? 'border-primary shadow-md shadow-primary/20 ring-2 ring-primary ring-offset-2 ring-offset-white dark:ring-offset-slate-800' 
                              : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                        >
                          <div 
                            className="absolute inset-0 bg-no-repeat"
                            style={{
                              backgroundImage: `url(${imageSearchPreview})`,
                              backgroundSize: `${widthPercent}% ${heightPercent}%`,
                              backgroundPosition: `${leftPercent}% ${topPercent}%`
                            }}
                          />
                          {isSelected && (
                            <div className="absolute inset-0 border-[2px] border-primary rounded-xl z-10 pointer-events-none" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-xs font-black hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                تغيير الصورة
              </button>
              <button
                type="button"
                onClick={clearImageSearch}
                className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-black hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                مسح
              </button>
            </div>
          </div>
        </div>
      )}

      {!isImageSearch && isInputFocused && queryInput.trim() && (
        <div className="px-4 pt-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-black text-slate-700 dark:text-slate-200">الأقسام المطابقة</div>
              {suggestionsLoading && (
                <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500">جاري البحث...</div>
              )}
            </div>
            {categorySuggestions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {categorySuggestions.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectCategory(category)}
                    className="w-full text-right px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <div className="text-sm font-black text-slate-900 dark:text-white">
                      {category.nameAr}
                    </div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                      {category.pathAr}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              !suggestionsLoading && (
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  لا توجد أقسام مطابقة، جرّب كتابة اسم مختلف.
                </div>
              )
            )}
          </div>
        </div>
      )}

      {!isImageSearch && isInputFocused && !queryInput.trim() && (filteredRecentCategories.length > 0 || filteredRecentTerms.length > 0) && (
        <div className="px-4 pt-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-black text-slate-700 dark:text-slate-200">آخر ما فتحت في البحث</div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  try {
                    localStorage.removeItem(RECENT_SEARCH_TERMS_KEY);
                    localStorage.removeItem(RECENT_CATEGORY_CLICKS_KEY);
                  } catch {}
                  setRecentTerms([]);
                  setRecentCategories([]);
                }}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                مسح
              </button>
            </div>
            {filteredRecentCategories.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                <div className="text-[11px] font-black text-slate-500 dark:text-slate-400">الأقسام الأخيرة</div>
                {filteredRecentCategories.slice(0, 6).map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectCategory(category)}
                    className="w-full text-right px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <div className="text-sm font-black text-slate-900 dark:text-white">
                      {category.nameAr}
                    </div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                      {category.pathAr}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {filteredRecentTerms.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] font-black text-slate-500 dark:text-slate-400">عمليات البحث الأخيرة</div>
                <div className="flex flex-wrap gap-2">
                  {filteredRecentTerms.slice(0, 12).map((term) => (
                    <button
                      key={term}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setQueryInput(term);
                        restoredFromCacheRef.current = false;
                        setRestored(false);
                        setResults([]);
                        setHasMore(false);
                        setPage(1);
                        setError(null);
                        setLoading(false);
                        setActiveCategory(null);
                        setActiveQuery(term);
                        navigate(`/search?q=${encodeURIComponent(term)}`, { replace: true });
                        if (inputRef.current) inputRef.current.focus();
                      }}
                      className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-xs font-bold"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-4 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5" />
          <div className="text-sm font-semibold">{error}</div>
        </div>
      )}

      {!error && activeCategory?.id && activeQuery.trim() && !loading && results.length === 0 && (
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
                allowAdminFeatureControls={!imageSearchInput && Boolean(activeQuery.trim())}
                searchContextQuery={activeQuery}
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
