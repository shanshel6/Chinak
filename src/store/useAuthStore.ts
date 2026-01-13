import { create } from 'zustand';
import { fetchMe, logout as apiLogout, performCacheMaintenance } from '../services/api';

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
  updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('auth_token'),
  isAuthenticated: !!localStorage.getItem('auth_token'),
  isLoading: true,

  setAuth: (token, user) => {
    try {
      const trimmedToken = token?.trim();
      localStorage.setItem('auth_token', trimmedToken);
      set({ token: trimmedToken, user, isAuthenticated: true, isLoading: false });
    } catch (e) {
      // If setting token fails, perform emergency cleanup
      performCacheMaintenance();
      try {
        const trimmedToken = token?.trim();
        localStorage.setItem('auth_token', trimmedToken);
        set({ token: trimmedToken, user, isAuthenticated: true, isLoading: false });
      } catch (retryError) {
        console.error('Critical: Failed to save auth token even after cleanup');
      }
    }
  },

  logout: async () => {
    await apiLogout();
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
  },

  checkAuth: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
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
    } catch (error) {
      localStorage.removeItem('auth_token');
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },

  updateUser: (user) => {
    set({ user });
  },
}));
