import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../types/product';
import { addToWishlist, fetchWishlist, removeFromWishlist } from '../services/api';

interface WishlistItem {
  id: number | string;
  productId: number | string;
  product: Product;
}

export const normalizeWishlistProductId = (value: number | string | null | undefined) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^rapid-/i, '');
};

const isGuestWishlistSession = (token?: string | null) => {
  const normalizedToken = String(token ?? '').trim();
  return normalizedToken.startsWith('guest-token-');
};

const normalizeWishlistItem = (item: any): WishlistItem | null => {
  if (!item || typeof item !== 'object') return null;
  const normalizedProductId = normalizeWishlistProductId(item.productId ?? item.product?.id);
  if (!normalizedProductId) return null;
  const product = item.product && typeof item.product === 'object' ? item.product : {};

  return {
    id: item.id ?? `wishlist-${normalizedProductId}`,
    productId: normalizedProductId,
    product: {
      ...product,
      id: normalizeWishlistProductId(product.id ?? normalizedProductId) || normalizedProductId,
      name: product.name ?? '',
      price: Number(product.price ?? 0),
      image: product.image ?? '',
      description: product.description ?? '',
    }
  };
};

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
        if (isGuestWishlistSession(token)) {
          set({ isLoading: false, error: null });
          return;
        }
        if (!silent) set({ isLoading: true, error: null });
        try {
          const serverData = await fetchWishlist();
          const normalized = Array.isArray(serverData)
            ? serverData.map(normalizeWishlistItem).filter(Boolean) as WishlistItem[]
            : [];
          set({ items: normalized, isLoading: false, error: null });
        } catch (error: any) {
          set({ isLoading: false, error: error?.message || 'Failed to fetch wishlist' });
        }
      },

      toggleWishlist: async (productId: number | string, productInfo?: any) => {
        const { items } = get();
        const normalizedProductId = normalizeWishlistProductId(productId);
        if (!normalizedProductId) return;
        const isInWishlist = items.some(item => normalizeWishlistProductId(item.productId) === normalizedProductId);
        const token = localStorage.getItem('auth_token')?.trim();
        const shouldSyncWithServer = Boolean(token && !isGuestWishlistSession(token));

        if (isInWishlist) {
          const nextItems = items.filter(item => normalizeWishlistProductId(item.productId) !== normalizedProductId);
          set({ items: nextItems, error: null });
          if (shouldSyncWithServer) {
            try {
              await removeFromWishlist(normalizedProductId);
            } catch (error: any) {
              set({ items, error: error?.message || 'Failed to update wishlist' });
            }
          }
        } else if (productInfo) {
          const newItem: WishlistItem = {
            id: `local-${Date.now()}`,
            productId: normalizedProductId,
            product: {
              ...productInfo,
              id: normalizeWishlistProductId(productInfo.id ?? normalizedProductId) || normalizedProductId,
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
          if (shouldSyncWithServer) {
            try {
              await addToWishlist(normalizedProductId);
              await get().fetchWishlist(true);
            } catch (error: any) {
              set({ items, error: error?.message || 'Failed to update wishlist' });
            }
          }
        }
      },

      isProductInWishlist: (productId: number | string) => {
        const normalizedProductId = normalizeWishlistProductId(productId);
        if (!normalizedProductId) return false;
        return get().items.some(item => normalizeWishlistProductId(item.productId) === normalizedProductId);
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
