import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../types/product';
import { addToWishlist, fetchWishlist, removeFromWishlist } from '../services/api';

interface WishlistItem {
  id: number | string;
  productId: number | string;
  product: Product;
}

interface WishlistState {
  items: WishlistItem[];
  isLoading: boolean;
  error: string | null;
  fetchWishlist: (silent?: boolean) => Promise<void>;
  toggleWishlist: (productId: number | string, productInfo?: any) => Promise<void>;
  isProductInWishlist: (productId: number | string) => boolean;
  clearWishlist: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      error: null,

      fetchWishlist: async (silent = false) => {
        const token = localStorage.getItem('auth_token')?.trim();
        if (!token) {
          if (!silent) set({ items: [], isLoading: false, error: null });
          return;
        }
        if (!silent) set({ isLoading: true, error: null });
        try {
          const serverData = await fetchWishlist();
          const normalized = Array.isArray(serverData) ? serverData : [];
          set({ items: normalized, isLoading: false, error: null });
        } catch (error: any) {
          set({ isLoading: false, error: error?.message || 'Failed to fetch wishlist' });
        }
      },

      toggleWishlist: async (productId: number | string, productInfo?: any) => {
        const { items } = get();
        const isInWishlist = items.some(item => String(item.productId) === String(productId));
        const token = localStorage.getItem('auth_token')?.trim();

        if (isInWishlist) {
          const nextItems = items.filter(item => String(item.productId) !== String(productId));
          set({ items: nextItems, error: null });
          if (token) {
            try {
              await removeFromWishlist(productId);
            } catch (error: any) {
              set({ items, error: error?.message || 'Failed to update wishlist' });
            }
          }
        } else if (productInfo) {
          const newItem: WishlistItem = {
            id: `local-${Date.now()}`,
            productId,
            product: {
              id: productInfo.id,
              name: productInfo.name,
              price: productInfo.price,
              image: productInfo.image,
              description: productInfo.description || '',
              weight: productInfo.weight,
              length: productInfo.length,
              width: productInfo.width,
              height: productInfo.height
            }
          };
          const nextItems = [...items, newItem];
          set({ items: nextItems, error: null });
          if (token) {
            try {
              await addToWishlist(productId);
              await get().fetchWishlist(true);
            } catch (error: any) {
              set({ items, error: error?.message || 'Failed to update wishlist' });
            }
          }
        }
      },

      isProductInWishlist: (productId: number | string) => {
        return get().items.some(item => String(item.productId) === String(productId));
      },

      clearWishlist: () => {
        set({ items: [], error: null, isLoading: false });
      },
    }),
    {
      name: 'user-wishlist',
    }
  )
);
