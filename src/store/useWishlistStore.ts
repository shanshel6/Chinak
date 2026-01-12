import { create } from 'zustand';
import { fetchWishlist, addToWishlist, removeFromWishlist } from '../services/api';

interface WishlistItem {
  id: number | string;
  productId: number | string;
  product: {
    id: number | string;
    name: string;
    price: number;
    image: string;
    description: string;
  };
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

export const useWishlistStore = create<WishlistState>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,

  fetchWishlist: async (silent = false) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      set({ items: [], isLoading: false });
      return;
    }

    const { items } = get();
    if (!silent || items.length === 0) {
      set({ isLoading: true, error: null });
    }

    try {
      const data = await fetchWishlist();
      const serverItems = Array.isArray(data) ? data : [];
      
      // Merge logic: Keep temporary items that aren't on the server yet
      const { items: currentItems } = get();
      const tempItems = currentItems.filter(item => String(item.id).startsWith('temp-'));
      
      const uniqueTempItems = tempItems.filter(temp => 
        !serverItems.some(server => String(server.productId) === String(temp.productId))
      );

      set({ 
        items: [...serverItems, ...uniqueTempItems], 
        isLoading: false 
      });
    } catch (err: any) {
      if (items.length === 0) {
        set({ error: err.message || 'Failed to fetch wishlist', isLoading: false });
      } else {
        set({ isLoading: false });
      }
    }
  },

  toggleWishlist: async (productId: number | string, productInfo?: any) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    const { items } = get();
    const isInWishlist = items.some(item => String(item.productId) === String(productId));
    const previousItems = [...items];

    // 1. Optimistic Update
    if (isInWishlist) {
      set({ items: items.filter(item => String(item.productId) !== String(productId)) });
    } else if (productInfo) {
      const tempItem: WishlistItem = {
        id: `temp-${Date.now()}`,
        productId,
        product: {
          id: productInfo.id,
          name: productInfo.name,
          price: productInfo.price,
          image: productInfo.image,
          description: productInfo.description || ''
        }
      };
      set({ items: [...items, tempItem] });
    }

    // 2. Background API call
    try {
      if (isInWishlist) {
        await removeFromWishlist(productId);
      } else {
        const newItem = await addToWishlist(productId);
        // If we didn't have productInfo or want to ensure correct ID from server
        if (!productInfo) {
          set({ items: [...get().items, newItem] });
        } else {
          // Replace temp item with real item
          set({
            items: get().items.map(item => 
              String(item.productId) === String(productId) ? newItem : item
            )
          });
        }
      }
    } catch (err: any) {
      // Rollback on error
      set({ items: previousItems, error: err.message || 'Failed to update wishlist' });
    }
  },

  isProductInWishlist: (productId: number | string) => {
    return get().items.some(item => item.productId === productId);
  },

  clearWishlist: () => {
    set({ items: [], error: null, isLoading: false });
  },
}));
