import { create } from 'zustand';
import type { Product } from '../types/product';

interface SearchCacheEntry {
  results: Product[];
  page: number;
  hasMore: boolean;
  scrollPos: number;
  condition: string | null;
  price: string | null;
}

interface PageCacheState {
  homeProducts: Product[];
  homePage: number;
  homeScrollPos: number;
  homeCategoryId: string;
  setHomeData: (products: Product[], page: number, categoryId: string) => void;
  setHomeScrollPos: (pos: number) => void;
  clearCache: () => void;
  searchCache: Record<string, SearchCacheEntry>;
  setSearchData: (key: string, entry: Omit<SearchCacheEntry, 'scrollPos'> & { scrollPos?: number }) => void;
  setSearchScrollPos: (key: string, pos: number) => void;
  getSearchData: (key: string) => SearchCacheEntry | undefined;
  removeProductFromCache: (productId: number | string) => void;
}

export const usePageCacheStore = create<PageCacheState>((set, get) => {
  const normalizeProductId = (value: unknown) => String(value ?? '').trim().replace(/^rapid-/i, '');
  const filterProducts = (products: Product[], productId: string) => (
    Array.isArray(products)
      ? products.filter((product) => normalizeProductId((product as any)?.id) !== productId)
      : []
  );
  const readHome = () => {
    try {
      const raw = localStorage.getItem('home_cache_v1');
      if (!raw) return null;
      return JSON.parse(raw) as { products: Product[]; page: number; scrollPos: number; categoryId: string };
    } catch {
      return null;
    }
  };
  const writeHome = (data: { products: Product[]; page: number; scrollPos: number; categoryId: string }) => {
    try {
      localStorage.setItem('home_cache_v1', JSON.stringify(data));
    } catch {}
  };
  const readSearch = (key: string): SearchCacheEntry | undefined => {
    try {
      const raw = localStorage.getItem(`search_cache_v1:${key}`);
      if (!raw) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const writeSearch = (key: string, entry: SearchCacheEntry) => {
    try {
      localStorage.setItem(`search_cache_v1:${key}`, JSON.stringify(entry));
    } catch {}
  };
  const readAllSearchEntries = () => {
    const entries: Record<string, SearchCacheEntry> = {};
    try {
      Object.keys(localStorage).forEach((storageKey) => {
        if (!storageKey.startsWith('search_cache_v1:')) return;
        const key = storageKey.slice('search_cache_v1:'.length);
        const entry = readSearch(key);
        if (entry) {
          entries[key] = entry;
        }
      });
    } catch {}
    return entries;
  };
  const initialHome = readHome();
  return ({
    homeProducts: initialHome?.products ?? [],
    homePage: initialHome?.page ?? 1,
    homeScrollPos: initialHome?.scrollPos ?? 0,
    homeCategoryId: initialHome?.categoryId ?? 'all',

    setHomeData: (products, page, categoryId) => set((s) => {
      const next = {
        products,
        page,
        scrollPos: s.homeScrollPos,
        categoryId,
      };
      writeHome(next);
      return {
        homeProducts: products,
        homePage: page,
        homeCategoryId: categoryId
      };
    }),
    setHomeScrollPos: (pos) => set((s) => {
      writeHome({
        products: s.homeProducts,
        page: s.homePage,
        scrollPos: pos,
        categoryId: s.homeCategoryId,
      });
      return { homeScrollPos: pos };
    }),

    clearCache: () => set(() => {
      try {
        localStorage.removeItem('home_cache_v1');
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('search_cache_v1:')) {
            localStorage.removeItem(key);
          }
        });
      } catch {}
      return {
        homeProducts: [],
        homePage: 1,
        homeScrollPos: 0,
        homeCategoryId: 'all',
        searchCache: {},
      };
    }),

    searchCache: {},
    setSearchData: (key, entry) => {
      const current = get().searchCache[key] || readSearch(key) || { results: [], page: 1, hasMore: false, scrollPos: 0, condition: null, price: null };
      const next: SearchCacheEntry = {
        results: entry.results ?? current.results,
        page: entry.page ?? current.page,
        hasMore: entry.hasMore ?? current.hasMore,
        scrollPos: entry.scrollPos ?? current.scrollPos,
        condition: entry.condition ?? current.condition,
        price: entry.price ?? current.price,
      };
      writeSearch(key, next);
      set((s) => ({ searchCache: { ...s.searchCache, [key]: next } }));
    },
    setSearchScrollPos: (key, pos) => {
      const current = get().searchCache[key] || readSearch(key) || { results: [], page: 1, hasMore: false, scrollPos: 0, condition: null, price: null };
      const next: SearchCacheEntry = { ...current, scrollPos: pos };
      writeSearch(key, next);
      set((s) => ({ searchCache: { ...s.searchCache, [key]: next } }));
    },
    getSearchData: (key) => get().searchCache[key] || readSearch(key),
    removeProductFromCache: (productId) => set((s) => {
      const normalizedProductId = normalizeProductId(productId);
      if (!normalizedProductId) return {};

      const nextHomeProducts = filterProducts(s.homeProducts, normalizedProductId);
      writeHome({
        products: nextHomeProducts,
        page: s.homePage,
        scrollPos: s.homeScrollPos,
        categoryId: s.homeCategoryId,
      });

      const nextSearchCache = {
        ...readAllSearchEntries(),
        ...s.searchCache,
      };

      Object.entries(nextSearchCache).forEach(([key, entry]) => {
        const nextEntry: SearchCacheEntry = {
          ...entry,
          results: filterProducts(entry.results, normalizedProductId),
        };
        nextSearchCache[key] = nextEntry;
        writeSearch(key, nextEntry);
      });

      return {
        homeProducts: nextHomeProducts,
        searchCache: nextSearchCache,
      };
    }),
  });
});
