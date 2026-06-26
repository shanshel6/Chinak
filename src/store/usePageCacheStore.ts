import { create } from 'zustand';
import type { Product } from '../types/product';

// =====================================================================
// SESSION-ONLY PAGE CACHE (in-memory).
//
// Caches the Home feed and search results for the current app session so
// that navigating into a product and pressing "back" restores the exact
// list (and, via <ScrollToTop>, the exact scroll position) instead of
// refetching and showing a different set of products.
//
// IMPORTANT: this cache lives in memory ONLY. It is intentionally NOT
// persisted to localStorage. A previous version persisted search results
// to localStorage and served stale results for Arabic queries whose
// translation had been cached while the AI translator was failing (it
// echoed the Arabic back, CLIP embedded raw Arabic, and the user saw
// random products forever — across app restarts). Keeping the cache
// in-memory means every fresh app launch starts clean, so that class of
// staleness cannot survive a restart. Within a session, an explicit new
// search always re-fetches (SearchResults only reads the cache on the
// first render / back navigation, never on an explicit submit).
// =====================================================================

interface SearchCacheEntry {
  results: Product[];
  page: number;
  hasMore: boolean;
  scrollPos: number;
  condition: string | null;
  price: string | null;
}

interface HomeCacheEntry {
  products: Product[];
  page: number;
  hasMore: boolean;
  scrollPos: number;
}

interface PageCacheState {
  homeScrollPos: number;
  homeCategoryId: string;
  setHomeScrollPos: (pos: number) => void;

  // Home feed cache (session-only).
  homeCache: HomeCacheEntry | null;
  setHomeData: (entry: Omit<HomeCacheEntry, 'scrollPos'> & { scrollPos?: number }) => void;
  getHomeData: () => HomeCacheEntry | undefined;

  clearCache: () => void;

  // Search results cache (session-only), keyed by the trimmed query.
  searchCache: Record<string, SearchCacheEntry>;
  setSearchData: (key: string, entry: Omit<SearchCacheEntry, 'scrollPos'> & { scrollPos?: number }) => void;
  setSearchScrollPos: (key: string, pos: number) => void;
  getSearchData: (key: string) => SearchCacheEntry | undefined;
}

// Keep at most this many distinct search queries cached so the in-memory
// map can't grow without bound over a long session.
const MAX_SEARCH_ENTRIES = 25;

// Best-effort wipe of every old localStorage prefix so we don't leave dead
// entries around from the previous persisted-cache implementation. Safe to
// run multiple times.
function wipeLegacySearchCache(): void {
  try {
    Object.keys(localStorage).forEach((key) => {
      if (
        key.startsWith('search_cache_v1:') ||
        key.startsWith('search_cache_v2:') ||
        key.startsWith('search_cache_v3:')
      ) {
        localStorage.removeItem(key);
      }
    });
  } catch {}
}
wipeLegacySearchCache();

export const usePageCacheStore = create<PageCacheState>((set, get) => ({
  homeScrollPos: 0,
  homeCategoryId: 'all',

  setHomeScrollPos: (pos: number) => {
    set({ homeScrollPos: pos });
  },

  homeCache: null,

  setHomeData: (entry) => {
    const prev = get().homeCache;
    set({
      homeCache: {
        products: entry.products,
        page: entry.page,
        hasMore: entry.hasMore,
        // Preserve a previously stored scroll position unless a new one is
        // explicitly provided.
        scrollPos: entry.scrollPos ?? prev?.scrollPos ?? 0,
      },
    });
  },

  getHomeData: () => get().homeCache ?? undefined,

  clearCache: () => {
    wipeLegacySearchCache();
    set({ searchCache: {}, homeCache: null, homeScrollPos: 0 });
  },

  searchCache: {},

  setSearchData: (key, entry) => {
    if (!key) return;
    const searchCache = { ...get().searchCache };
    const prev = searchCache[key];
    searchCache[key] = {
      results: entry.results,
      page: entry.page,
      hasMore: entry.hasMore,
      condition: entry.condition,
      price: entry.price,
      scrollPos: entry.scrollPos ?? prev?.scrollPos ?? 0,
    };

    // Enforce a soft cap (drop the oldest inserted keys first).
    const keys = Object.keys(searchCache);
    if (keys.length > MAX_SEARCH_ENTRIES) {
      for (const stale of keys.slice(0, keys.length - MAX_SEARCH_ENTRIES)) {
        delete searchCache[stale];
      }
    }

    set({ searchCache });
  },

  setSearchScrollPos: (key, pos) => {
    if (!key) return;
    const searchCache = { ...get().searchCache };
    const prev = searchCache[key];
    if (!prev) return;
    searchCache[key] = { ...prev, scrollPos: pos };
    set({ searchCache });
  },

  getSearchData: (key) => (key ? get().searchCache[key] : undefined),
}));
