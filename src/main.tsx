import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './loader.css'
import './i18n'
import App from './App.tsx'
import packageJson from '../package.json';

// Version Check & Cache Busting
try {
  const CURRENT_VERSION = packageJson?.version || '1.0.0';
  const STORED_VERSION_KEY = 'app_version';
  const storedVersion = localStorage.getItem(STORED_VERSION_KEY);

  if (storedVersion && storedVersion !== CURRENT_VERSION) {
    console.log(`New version detected: ${CURRENT_VERSION} (was ${storedVersion}). Clearing cache.`);
    
    // Clear all local storage except critical auth tokens if needed
    // We keep 'app_version' to avoid loop
    localStorage.clear();
    
    // Clear session storage
    sessionStorage.clear();
    
    // Update version immediately
    localStorage.setItem(STORED_VERSION_KEY, CURRENT_VERSION);
  } else if (!storedVersion) {
    localStorage.setItem(STORED_VERSION_KEY, CURRENT_VERSION);
  }
} catch (e) {
  // Silent fail for version check to prevent startup crash
  try { console.error('Version check failed:', e); } catch(_err) {}
}

// Immediate LocalStorage Cleanup to prevent QuotaExceededError
try {
  const CACHE_PREFIX = 'app_cache_';
  const keys = Object.keys(localStorage);
  const cacheKeys = keys.filter(k => k && k.startsWith(CACHE_PREFIX));
  
  if (cacheKeys.length > 10) {
    cacheKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch(_e) {}
    });
  }
} catch (e) {
  // Ignore localStorage errors
}

try {
  if (!CSS.supports('color', 'oklch(0% 0 0)')) {
    const fallbackVars: Record<string, string> = {
      '--color-slate-50': '#f8fafc',
      '--color-slate-100': '#f1f5f9',
      '--color-slate-200': '#e2e8f0',
      '--color-slate-300': '#cbd5e1',
      '--color-slate-400': '#94a3b8',
      '--color-slate-500': '#64748b',
      '--color-slate-600': '#475569',
      '--color-slate-700': '#334155',
      '--color-slate-800': '#1e293b',
      '--color-slate-900': '#0f172a',
      '--color-slate-950': '#020617',

      '--color-gray-50': '#f9fafb',
      '--color-gray-100': '#f3f4f6',
      '--color-gray-200': '#e5e7eb',
      '--color-gray-300': '#d1d5db',
      '--color-gray-400': '#9ca3af',
      '--color-gray-500': '#6b7280',
      '--color-gray-600': '#4b5563',
      '--color-gray-700': '#374151',
      '--color-gray-800': '#1f2937',
      '--color-gray-900': '#111827',
      '--color-gray-950': '#030712',

      '--color-rose-50': '#fff1f2',
      '--color-rose-100': '#ffe4e6',
      '--color-rose-200': '#fecdd3',
      '--color-rose-300': '#fda4af',
      '--color-rose-400': '#fb7185',
      '--color-rose-500': '#f43f5e',
      '--color-rose-600': '#e11d48',
      '--color-rose-700': '#be123c',
      '--color-rose-800': '#9f1239',
      '--color-rose-900': '#881337',
      '--color-rose-950': '#4c0519',

      '--color-blue-50': '#eff6ff',
      '--color-blue-100': '#dbeafe',
      '--color-blue-200': '#bfdbfe',
      '--color-blue-300': '#93c5fd',
      '--color-blue-400': '#60a5fa',
      '--color-blue-500': '#3b82f6',
      '--color-blue-600': '#2563eb',
      '--color-blue-700': '#1d4ed8',
      '--color-blue-800': '#1e40af',
      '--color-blue-900': '#1e3a8a',
      '--color-blue-950': '#172554',

      '--color-green-50': '#f0fdf4',
      '--color-green-100': '#dcfce7',
      '--color-green-200': '#bbf7d0',
      '--color-green-300': '#86efac',
      '--color-green-400': '#4ade80',
      '--color-green-500': '#22c55e',
      '--color-green-600': '#16a34a',
      '--color-green-700': '#15803d',
      '--color-green-800': '#166534',
      '--color-green-900': '#14532d',
      '--color-green-950': '#052e16',

      '--color-amber-50': '#fffbeb',
      '--color-amber-100': '#fef3c7',
      '--color-amber-200': '#fde68a',
      '--color-amber-300': '#fcd34d',
      '--color-amber-400': '#fbbf24',
      '--color-amber-500': '#f59e0b',
      '--color-amber-600': '#d97706',
      '--color-amber-700': '#b45309',
      '--color-amber-800': '#92400e',
      '--color-amber-900': '#78350f',
      '--color-amber-950': '#451a03',
    };

    for (const [key, value] of Object.entries(fallbackVars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }
} catch (_e) {}

// Force light mode - remove dark class and prevent it from being added
try {
  // Remove dark class if it exists
  document.documentElement.classList.remove('dark');
  
  // Ensure light class is present
  document.documentElement.classList.add('light');
  
  // Prevent dark mode from being detected by media queries
  const style = document.createElement('style');
  style.textContent = `
    @media (prefers-color-scheme: dark) {
      /* Override any system dark mode preferences */
      :root {
        color-scheme: light !important;
      }
    }
  `;
  document.head.appendChild(style);
} catch (_e) {}

// Disable console.log in production
if (import.meta.env.PROD) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

// Global error handler: if React fails to mount, show error instead of infinite loading
const showErrorScreen = (error: Error) => {
  console.error('App failed to start:', error);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;padding:2rem;text-align:center;background:#fef2f2;">
        <div style="max-width:500px;">
          <h1 style="color:#dc2626;font-size:1.5rem;margin-bottom:1rem;">⚠️ Something went wrong</h1>
          <p style="color:#666;margin-bottom:1rem;">The app failed to load. Try clearing your browser cache and refreshing.</p>
          <pre style="background:#fee2e2;padding:1rem;border-radius:0.5rem;font-size:0.75rem;text-align:left;overflow:auto;color:#991b1b;">${error.message}\n${error.stack || ''}</pre>
          <button onclick="localStorage.clear();location.reload()" style="margin-top:1rem;padding:0.75rem 1.5rem;background:#2563eb;color:white;border:none;border-radius:0.5rem;cursor:pointer;font-size:1rem;">Clear Cache & Reload</button>
        </div>
      </div>`;
  }
};

// Catch errors during module initialization (before React mounts)
window.addEventListener('error', (event) => {
  const root = document.getElementById('root');
  // Only show error screen if React hasn't rendered yet (root still has the initial loader)
  if (root && root.querySelector('.initial-loader')) {
    showErrorScreen(new Error(event.message || 'Unknown error'));
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const root = document.getElementById('root');
  if (root && root.querySelector('.initial-loader')) {
    showErrorScreen(new Error(String(event.reason || 'Unhandled promise rejection')));
  }
});

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error: any) {
  showErrorScreen(error);
}
