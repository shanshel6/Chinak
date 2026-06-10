import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  isDarkMode: boolean;
  toggleTheme: () => void;
  setTheme: (isDark: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (_set) => ({
      isDarkMode: false,
      toggleTheme: () => {
        // Dark mode disabled
        document.documentElement.classList.remove('dark');
      },
      setTheme: (_isDark) => {
        // Always force light mode
        document.documentElement.classList.remove('dark');
      },
    }),
    {
      name: 'theme-storage',
    }
  )
);
