import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'

// Immediate LocalStorage Cleanup to prevent QuotaExceededError
try {
  const CACHE_PREFIX = 'app_cache_';
  const keys = Object.keys(localStorage);
  const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
  
  // If we have many cache keys, clear them all immediately before App starts
  if (cacheKeys.length > 10) {
    cacheKeys.forEach(k => localStorage.removeItem(k));
  }
} catch (e) {
  // Ignore localStorage errors here
}

// Disable console.log in production
if (import.meta.env.PROD) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
