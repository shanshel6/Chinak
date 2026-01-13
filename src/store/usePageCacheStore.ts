import { create } from 'zustand';

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  description: string;
  images?: { id: number; url: string; order: number; type?: string }[];
  purchaseUrl?: string;
}

interface PageCacheState {
  homeProducts: Product[];
  homePage: number;
  homeScrollPos: number;
  homeCategoryId: string;
  
  searchResults: Product[];
  searchQuery: string;
  searchScrollPos: number;
  
  setHomeData: (products: Product[], page: number, categoryId: string) => void;
  setHomeScrollPos: (pos: number) => void;
  
  setSearchData: (products: Product[], query: string) => void;
  setSearchScrollPos: (pos: number) => void;
  
  clearCache: () => void;
}

export const usePageCacheStore = create<PageCacheState>((set) => ({
  homeProducts: [],
  homePage: 1,
  homeScrollPos: 0,
  homeCategoryId: 'all',
  
  searchResults: [],
  searchQuery: '',
  searchScrollPos: 0,
  
  setHomeData: (products, page, categoryId) => set({ 
    homeProducts: products, 
    homePage: page, 
    homeCategoryId: categoryId 
  }),
  setHomeScrollPos: (pos) => set({ homeScrollPos: pos }),
  
  setSearchData: (products, query) => set({ 
    searchResults: products, 
    searchQuery: query 
  }),
  setSearchScrollPos: (pos) => set({ searchScrollPos: pos }),
  
  clearCache: () => set({
    homeProducts: [],
    homePage: 1,
    homeScrollPos: 0,
    homeCategoryId: 'all',
    searchResults: [],
    searchQuery: '',
    searchScrollPos: 0,
  }),
}));
