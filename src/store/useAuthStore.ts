import { create } from 'zustand';
import { fetchMe, logout as apiLogout, performCacheMaintenance } from '../services/api';
import { useCartStore } from './useCartStore';
import { useWishlistStore } from './useWishlistStore';

interface User {
  id: string; 
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
  role: string;
  permissions?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  ensureGuestSession: () => void;
  updateUser: (user: User) => void;
}

const GUEST_AUTOLOGIN_DISABLED_KEY = 'guest_autologin_disabled_v1';

const buildGuestUser = (): User => ({
  id: 'guest-user',
  name: 'زائر',
  phone: '',
  role: 'GUEST',
  email: 'guest@local.app'
});

const buildGuestToken = () => `guest-token-${Date.now()}`;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('auth_token'),
  isAuthenticated: !!localStorage.getItem('auth_token'),
  isLoading: true,

  setAuth: (token, user) => {
    try {
      const trimmedToken = token?.trim();
      localStorage.removeItem(GUEST_AUTOLOGIN_DISABLED_KEY);
      localStorage.setItem('auth_token', trimmedToken);
      set({ token: trimmedToken, user, isAuthenticated: true, isLoading: false });
    } catch (_e) {
      // If setting token fails, perform emergency cleanup
      performCacheMaintenance();
      try {
        const trimmedToken = token?.trim();
        localStorage.removeItem(GUEST_AUTOLOGIN_DISABLED_KEY);
        localStorage.setItem('auth_token', trimmedToken);
        set({ token: trimmedToken, user, isAuthenticated: true, isLoading: false });
      } catch (_retryError) {
        console.error('Critical: Failed to save auth token even after cleanup');
      }
    }
  },

  logout: async () => {
    try {
      await apiLogout();
    } catch (_e) {
      // ignore
    }
    localStorage.setItem(GUEST_AUTOLOGIN_DISABLED_KEY, '1');
    useCartStore.getState().clearCart();
    useWishlistStore.getState().clearWishlist();
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
  },

  checkAuth: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        const guestDisabled = localStorage.getItem(GUEST_AUTOLOGIN_DISABLED_KEY) === '1';
        if (!guestDisabled) {
          const guestToken = buildGuestToken();
          localStorage.setItem('auth_token', guestToken);
          set({ user: buildGuestUser(), token: guestToken, isAuthenticated: true, isLoading: false });
          return;
        }
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        return;
      }

      if (token.startsWith('guest-token-')) {
        set({ user: buildGuestUser(), token, isAuthenticated: true, isLoading: false });
        return;
      }

      if (token.startsWith('test-token-') || token.startsWith('demo-token-')) {
        const user = await fetchMe();
        if (user) {
          set({ user, token, isAuthenticated: true, isLoading: false });
        } else {
          localStorage.removeItem('auth_token');
          set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        }
        return;
      }

      const user = await fetchMe();
      
      if (!user) {
        localStorage.removeItem('auth_token');
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        return;
      }

      set({ 
        user, 
        token, 
        isAuthenticated: true, 
        isLoading: false 
      });
    } catch (_error) {
      localStorage.removeItem('auth_token');
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },

  ensureGuestSession: () => {
    const token = localStorage.getItem('auth_token')?.trim();
    const guestDisabled = localStorage.getItem(GUEST_AUTOLOGIN_DISABLED_KEY) === '1';
    if (token || guestDisabled) return;
    const guestToken = buildGuestToken();
    localStorage.setItem('auth_token', guestToken);
    set({ user: buildGuestUser(), token: guestToken, isAuthenticated: true, isLoading: false });
  },

  updateUser: (user) => {
    set({ user });
  },
}));
