import { create } from 'zustand';
import type { Product } from '../types/product';

// =====================================================================
// SEARCH CACHING IS DISABLED.
//
// We were hitting a bug where stale cached results were being served for
// Arabic queries whose translation had been cached at a moment when the
// AI translator was failing (it would echo the Arabic back, CLIP would
// embed raw Arabic, and the user would see random products forever).
//
// Rather than try to make the cache "smart enough" to know when it's
// stale, we just turn it off. Every search now hits the network fresh.
// If perf becomes a concern later we can revisit with a much smaller
// in-memory LRU and a strict TTL, but right now correctness > speed.
// =====================================================================

interface SearchCacheEntry {
  results: Product[];
  page: number;
  hasMore: boolean;
  scrollPos: number;
  condition: string | null;
  price: string | null;
}

interface PageCacheState {
  homeScrollPos: number;
  homeCategoryId: string;
  setHomeScrollPos: (pos: number) => void;
  clearCache: () => void;
  searchCache: Record<string, SearchCacheEntry>;
  setSearchData: (key: string, entry: Omit<SearchCacheEntry, 'scrollPos'> & { scrollPos?: number }) => void;
  setSearchScrollPos: (key: string, pos: number) => void;
  getSearchData: (key: string) => SearchCacheEntry | undefined;
}

// Best-effort wipe of every old prefix so we don't leave dead entries
// around in localStorage. Safe to run multiple times.
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

export const usePageCacheStore = create<PageCacheState>(() => ({
  homeScrollPos: 0,
  homeCategoryId: 'all',

  setHomeScrollPos: () => {
    /* no-op while search caching is disabled */
  },

  clearCache: () => {
    wipeLegacySearchCache();
  },

  searchCache: {},

  // Disabled: do not write search results to localStorage.
  setSearchData: () => {
    /* no-op */
  },

  // Disabled: do not persist scroll positions for cached searches.
  setSearchScrollPos: () => {
    /* no-op */
  },

  // Disabled: always return undefined so the caller falls through to the
  // live network request.
  getSearchData: () => undefined,
}));