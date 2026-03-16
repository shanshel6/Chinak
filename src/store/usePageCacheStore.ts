import { create } from 'zustand';
import type { Product } from '../types/product';

interface PageCacheState {
  homeProducts: Product[];
  homePage: number;
  homeScrollPos: number;
  homeCategoryId: string;
  setHomeData: (products: Product[], page: number, categoryId: string) => void;
  setHomeScrollPos: (pos: number) => void;
  clearCache: () => void;
}

export const usePageCacheStore = create<PageCacheState>((set) => ({
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
  }),
}));
