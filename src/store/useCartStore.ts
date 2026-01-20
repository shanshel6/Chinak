import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fetchCart, updateCartItem, removeFromCart, addToCart, fetchSettings } from '../services/api';
import { calculateShippingFee } from '../utils/shipping';
import type { ShippingRates } from '../types/shipping';

interface Product {
  id: number | string;
  name: string;
  price: number;
  image: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  domesticShippingFee?: number;
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
  rates: ShippingRates;
  lastSynced: number | null;
  fetchCart: (silent?: boolean) => Promise<void>;
  fetchRates: () => Promise<void>;
  addItem: (productId: number | string, quantity?: number, variantId?: number | string, productInfo?: { id: number | string; name: string; price: number; image: string; variant?: any; weight?: number; length?: number; width?: number; height?: number; domesticShippingFee?: number }, selectedOptions?: any) => Promise<void>;
  updateQuantity: (itemId: number | string, quantity: number) => Promise<void>;
  removeItem: (itemId: number | string) => Promise<void>;
  removeItems: (itemIds: (number | string)[]) => Promise<void>;
  clearCart: () => void;
  getTotalItems: () => number;
  getBaseSubtotal: () => number;
  getShippingTotal: (method: 'air' | 'sea') => number;
  getSubtotal: (method?: 'air' | 'sea') => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      error: null,
      deletingIds: [],
      lastSynced: null,
      rates: {
        airRate: 15400,
        seaRate: 182000,
        chinaDomesticRate: 1500,
        minFloor: 5000
      },

      fetchRates: async () => {
        try {
          const settings = await fetchSettings();
          if (settings) {
            set({
              rates: {
                airRate: settings.airShippingRate || 15400,
                seaRate: settings.seaShippingRate || 182000,
                chinaDomesticRate: settings.chinaDomesticShipping || 1500,
                minFloor: settings.airShippingMinFloor || 5000
              }
            });
          }
        } catch (e) {
          console.error('Failed to fetch rates in store:', e);
        }
      },

      fetchCart: async (silent = false) => {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          return; // Stay local if not logged in
        }

        // Only sync if we haven't synced in the last 5 minutes or if explicitly requested
        const { lastSynced, items: localItems } = get();
        if (silent && lastSynced && Date.now() - lastSynced < 300000) {
          return;
        }

        if (!silent || localItems.length === 0) {
          set({ isLoading: true });
        }

        try {
          const serverData = await fetchCart();
          const serverItems = Array.isArray(serverData) ? serverData : [];
          
          if (serverItems.length > 0 && localItems.length === 0) {
            // First time loading or local is empty, use server data
            set({ items: serverItems, lastSynced: Date.now(), isLoading: false });
          } else {
            // We have local items, we keep them as source of truth for this session
            // But we update the lastSynced timestamp
            set({ lastSynced: Date.now(), isLoading: false });
          }
        } catch (err) {
          console.error('Failed to sync cart:', err);
          set({ isLoading: false });
        }
      },

      addItem: async (productId, quantity = 1, variantId, productInfo, selectedOptions) => {
        const { items } = get();
        const sOptions = typeof selectedOptions === 'object' && selectedOptions !== null 
          ? JSON.stringify(selectedOptions) 
          : (selectedOptions || null);
        
        const existingItem = items.find(item => {
          const sameProduct = String(item.productId) === String(productId);
          const sameVariant = (item.variantId === variantId) || 
                            (item.variantId === null && variantId === undefined) ||
                            (item.variantId === undefined && variantId === null) ||
                            (item.variantId && variantId && String(item.variantId) === String(variantId));
          const sameOptions = (item.selectedOptions === sOptions) || 
                            (!item.selectedOptions && !sOptions);
          return sameProduct && sameVariant && sameOptions;
        });

        if (existingItem) {
          set({
            items: items.map(item => 
              item.id === existingItem.id 
                ? { ...item, quantity: item.quantity + quantity }
                : item
            )
          });
          
          // Background sync
          try {
            updateCartItem(existingItem.id, existingItem.quantity + quantity).catch(() => {});
          } catch (_e) {}
        } else if (productInfo) {
          const tempId = `local-${Date.now()}`;
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
              image: productInfo.image,
              weight: productInfo.weight,
              length: productInfo.length,
              width: productInfo.width,
              height: productInfo.height
            },
            variant: productInfo.variant
          };
          set({ items: [...items, newItem] });
          
          // Background sync
          try {
            addToCart(productId, quantity, variantId, selectedOptions).then(response => {
              if (response && response.id) {
                // Update the local item with the server ID to keep them in sync
                set({
                  items: get().items.map(item => item.id === tempId ? response : item)
                });
              }
            }).catch(() => {});
          } catch (_e) {}
        }
      },

      updateQuantity: async (itemId, quantity) => {
         if (quantity < 1) return;
         const { items } = get();
         
         set({
           items: items.map(item => 
             item.id === itemId ? { ...item, quantity } : item
           )
         });
 
         // Background sync
         if (typeof itemId === 'string' && itemId.startsWith('local-')) return;
 
         try {
           updateCartItem(itemId, quantity).catch(() => {});
         } catch (_e) {}
       },
 
       removeItem: async (itemId) => {
         const { items } = get();
         set({
           items: items.filter(item => item.id !== itemId)
         });
 
         // Background sync
         if (typeof itemId === 'string' && itemId.startsWith('local-')) return;
 
         try {
           removeFromCart(itemId).catch(() => {});
         } catch (_e) {}
       },
 
       removeItems: async (itemIds) => {
         const { items } = get();
         set({
           items: items.filter(item => !itemIds.includes(item.id))
         });
 
         // Background sync
         try {
           const serverIds = itemIds.filter(id => !(typeof id === 'string' && id.startsWith('local-')));
           if (serverIds.length > 0) {
             Promise.all(serverIds.map(id => removeFromCart(id))).catch(() => {});
           }
         } catch (_e) {}
       },

      clearCart: () => {
        set({ items: [] });
      },

      getTotalItems: () => {
        return get().items.reduce((acc, item) => acc + item.quantity, 0);
      },

      getBaseSubtotal: () => {
        return get().items.reduce((acc, item) => {
          const basePrice = item.price || item.variant?.price || item.product.price || 0;
          return acc + (basePrice * item.quantity);
        }, 0);
      },

      getShippingTotal: (method: 'air' | 'sea') => {
        const { rates } = get();
        const total = get().items.reduce((acc, item) => {
            const basePrice = item.price || item.variant?.price || item.product.price || 0;
            const shipping = calculateShippingFee(
              item.product.weight,
              item.product.length,
              item.product.width,
              item.product.height,
              rates,
              basePrice,
              method.toUpperCase() as 'AIR' | 'SEA',
              0,
              false
            );
            return acc + (shipping * item.quantity);
          }, 0);

        if (method === 'air') {
          const minWeightCost = 1 * rates.airRate;
          return Math.max(total, minWeightCost);
        } else {
          return Math.max(total, 10000);
        }
      },

      getSubtotal: (method: 'air' | 'sea' = 'sea') => {
        const baseSubtotal = get().getBaseSubtotal();
        const shippingTotal = get().getShippingTotal(method);
        return baseSubtotal + shippingTotal;
      },
    }),
    {
      name: 'cart-storage',
    }
  )
);
