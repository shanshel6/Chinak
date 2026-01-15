import { create } from 'zustand';
import { fetchCart, updateCartItem, removeFromCart, addToCart } from '../services/api';

interface Product {
  id: number | string;
  name: string;
  price: number;
  image: string;
}

interface CartItem {
  id: number | string;
  productId: number | string;
  variantId?: number | string;
  selectedOptions?: string | any;
  quantity: number;
  price?: number; // Inclusive price from server
  product: Product;
  variant?: {
    id: number | string;
    combination: string;
    price: number;
    image?: string;
  };
}

interface CartState {
  items: CartItem[];
  isLoading: boolean;
  error: string | null;
  deletingIds: (number | string)[];
  fetchCart: (silent?: boolean) => Promise<void>;
  addItem: (productId: number | string, quantity?: number, variantId?: number | string, productInfo?: { id: number | string; name: string; price: number; image: string; variant?: any }, selectedOptions?: any) => Promise<void>;
  updateQuantity: (itemId: number | string, quantity: number) => Promise<void>;
  removeItem: (itemId: number | string) => Promise<void>;
  removeItems: (itemIds: (number | string)[]) => Promise<void>;
  clearCart: () => void;
  getTotalItems: () => number;
  getSubtotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,
  deletingIds: [],

  fetchCart: async (silent = false) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      set({ items: [], isLoading: false, error: null, deletingIds: [] });
      return;
    }

    const { items, deletingIds } = get();
    // Only set loading if not silent and we have no items
    if (!silent || items.length === 0) {
      set({ isLoading: true, error: null });
    }
    
    try {
      const data = await fetchCart();
      const serverItems = Array.isArray(data) ? data : [];
      
      // Filter out items that are currently being deleted to prevent them from reappearing
      const filteredServerItems = serverItems.filter(item => !deletingIds.includes(item.id));
      
      // Merge logic: Keep temporary items that aren't on the server yet
      const { items: currentItems } = get();
      const tempItems = currentItems.filter(item => String(item.id).startsWith('temp-'));
      
      // Also filter out server items that we've already added optimistically (to avoid duplicates)
      // but usually the server items are the "truth".
      // If a temp item's productId/variantId matches a server item, the server item should take precedence
      // as it means the sync finished.
      const uniqueTempItems = tempItems.filter(temp => 
        !filteredServerItems.some(server => 
          String(server.productId) === String(temp.productId) && 
          String(server.variantId) === String(temp.variantId)
        )
      );

      set({ 
        items: [...filteredServerItems, ...uniqueTempItems], 
        isLoading: false, 
        error: null 
      });
    } catch (err: any) {
      console.error('Fetch cart error:', err);
      // Only show error and clear items if it's a critical failure (not silent or empty)
      if (items.length === 0) {
        set({ 
          error: err.message || 'فشل في تحميل السلة. يرجى التأكد من الاتصال بالإنترنت.', 
          isLoading: false,
          items: []
        });
      } else {
        set({ isLoading: false });
      }
    }
  },

  addItem: async (productId, quantity = 1, variantId, productInfo, selectedOptions) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    const { items } = get();
    const sOptions = typeof selectedOptions === 'object' ? JSON.stringify(selectedOptions) : selectedOptions;
    
    // Find if item exists - must match product, variant AND options
    const existingItem = items.find(item => 
      String(item.productId) === String(productId) && 
      String(item.variantId) === String(variantId) &&
      (item.selectedOptions === sOptions || (!item.selectedOptions && !sOptions))
    );

    // 1. Optimistic Update
    let tempId = '';
    if (existingItem) {
      set({
        items: items.map(item => 
          item.id === existingItem.id 
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      });
    } else if (productInfo) {
      // Add new item optimistically if we have product info
      tempId = `temp-${Date.now()}`;
      const newItem: CartItem = {
        id: tempId,
        productId,
        variantId,
        selectedOptions: sOptions,
        quantity,
        product: {
          id: productInfo.id,
          name: productInfo.name,
          price: productInfo.price,
          image: productInfo.image
        },
        variant: productInfo.variant
      };
      set({ items: [...items, newItem] });
    }

    // 2. Background API call
    try {
      const response = await addToCart(productId, quantity, variantId, selectedOptions);
      
      // If the server returned the new cart item, replace the temp one
      if (response && response.id) {
        set({
          items: get().items.map(item => 
            (tempId && item.id === tempId) || (!existingItem && String(item.productId) === String(productId) && String(item.variantId) === String(variantId) && (item.selectedOptions === sOptions))
              ? response 
              : item
          ),
          error: null // Clear any previous errors on success
        });
      } else {
        // If success but no specific item returned, sync the whole cart to be safe
        await get().fetchCart(true);
      }
    } catch (err: any) {
      console.error('Failed to add to cart:', err);
      // Rollback on error: remove the temp item or revert quantity
      if (existingItem) {
        set({
          items: get().items.map(item => 
            item.id === existingItem.id 
              ? { ...item, quantity: existingItem.quantity }
              : item
          ),
          error: err.message || 'فشل في إضافة المنتج للسلة'
        });
      } else if (tempId) {
        set({
          items: get().items.filter(item => item.id !== tempId),
          error: err.message || 'فشل في إضافة المنتج للسلة'
        });
      }
      
      // Optionally re-fetch from server to ensure local state matches server exactly after error
      await get().fetchCart(true);
      
      throw err;
    }
  },

  updateQuantity: async (itemId, quantity) => {
    if (quantity < 1) return;
    const { items } = get();
    const previousItem = items.find(i => i.id === itemId);
    if (!previousItem) return;

    // Optimistic Update
    set({
      items: items.map(item => 
        item.id === itemId ? { ...item, quantity } : item
      ),
      error: null
    });

    try {
      await updateCartItem(itemId, quantity);
      // No need to fetch again if successful
    } catch (err: any) {
      console.error('Failed to update quantity:', err);
      // Rollback on error
      set({ 
        items: get().items.map(item => 
          item.id === itemId ? { ...item, quantity: previousItem.quantity } : item
        ),
        error: err.message || 'فشل في تحديث الكمية' 
      });
      
      // Sync with server to be sure
      await get().fetchCart(true);
      throw new Error(err.message);
    }
  },

  removeItem: async (itemId) => {
    const { items, deletingIds } = get();
    const previousItems = [...items];

    // Optimistic Update
    set({
      items: items.filter(item => item.id !== itemId),
      deletingIds: [...deletingIds, itemId]
    });

    try {
      await removeFromCart(itemId);
      // Remove from deletingIds once confirmed by server
      set({
        deletingIds: get().deletingIds.filter(id => id !== itemId)
      });
    } catch (err: any) {
      console.error('Failed to remove from cart:', err);
      // Rollback on error
      set({ 
        items: previousItems, 
        deletingIds: get().deletingIds.filter(id => id !== itemId),
        error: err.message || 'فشل في حذف المنتج' 
      });
      throw new Error(err.message);
    }
  },

  removeItems: async (itemIds) => {
    const { items, deletingIds } = get();
    const previousItems = [...items];

    // Optimistic Update
    set({
      items: items.filter(item => !itemIds.includes(item.id)),
      deletingIds: [...deletingIds, ...itemIds]
    });

    try {
      // Execute all deletions in parallel
      await Promise.all(itemIds.map(id => removeFromCart(id)));
      
      // Remove from deletingIds once confirmed by server
      set({
        deletingIds: get().deletingIds.filter(id => !itemIds.includes(id))
      });
    } catch (err: any) {
      console.error('Failed to remove multiple items from cart:', err);
      // Rollback on error
      set({ 
        items: previousItems, 
        deletingIds: get().deletingIds.filter(id => !itemIds.includes(id)),
        error: err.message || 'فشل في حذف المنتجات المختارة' 
      });
      throw new Error(err.message);
    }
  },

  clearCart: () => {
    set({ items: [] });
  },

  getTotalItems: () => {
    return get().items.reduce((acc, item) => acc + item.quantity, 0);
  },

  getSubtotal: () => {
    return get().items.reduce((acc, item) => {
      // Use inclusive price if available, otherwise fallback to base prices
      const price = item.price || item.variant?.price || item.product.price;
      return acc + (price * item.quantity);
    }, 0);
  },
}));
