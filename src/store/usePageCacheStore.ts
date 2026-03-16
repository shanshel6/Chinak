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
}

export const usePageCacheStore = create<PageCacheState>((set, get) => {
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
  return ({
    homeProducts: [],
    homePage: 1,
    homeScrollPos: 0,
    homeCategoryId: 'all',

    setHomeData: (products, page, categoryId) => set({ 
      homeProducts: products, 
      homePage: page, 
      homeCategoryId: categoryId 
    }),
    setHomeScrollPos: (pos) => set({ homeScrollPos: pos }),

    clearCache: () => set({
      homeProducts: [],
      homePage: 1,
      homeScrollPos: 0,
      homeCategoryId: 'all',
      searchCache: {},
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
  });
});
