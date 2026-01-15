import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { performCacheMaintenance, searchProducts } from '../services/api';
import { useWishlistStore } from '../store/useWishlistStore';
import { useCartStore } from '../store/useCartStore';
import { useAuthStore } from '../store/useAuthStore';
import { useToastStore } from '../store/useToastStore';
import { usePageCacheStore } from '../store/usePageCacheStore';
import SearchHeader from '../components/search/SearchHeader';
import SearchSuggestions from '../components/search/SearchSuggestions';
import FilterSortStrip from '../components/search/FilterSortStrip';
import SearchEmptyState from '../components/search/SearchEmptyState';
import SearchLoadingState from '../components/search/SearchLoadingState';
import SearchProductCard from '../components/search/SearchProductCard';

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  description?: string;
}

import { AlertCircle, ArrowUp } from 'lucide-react';

const SearchResults: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const cartItems = useCartStore((state) => state.items);
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  const isProductInWishlist = (productId: number) => wishlistItems.some(item => String(item.productId) === String(productId));
  
  // Get query from URL if present
  const queryParams = new URLSearchParams(location.search);
  const initialQuery = queryParams.get('q') || '';

  const { 
    searchResults, 
    searchQuery: cachedQuery, 
    searchScrollPos,
    setSearchData, 
    setSearchScrollPos 
  } = usePageCacheStore();

  const [searchQuery, setSearchQuery] = useState(initialQuery || cachedQuery);
  const [products, setProducts] = useState<Product[]>(searchResults);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>(searchResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'none' | 'price_asc' | 'price_desc' | 'rating'>('none');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const popularSearches = ['سماعات لاسلكية', 'آيفون 15', 'ساعة ذكية', 'أحذية رياضية', 'عطور رجالية'];

  useEffect(() => {
    const saved = localStorage.getItem('recent_searches');
    if (saved) {
      setRecentSearches(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    // If query in URL changes, update search query state
    const q = queryParams.get('q');
    if (q && q !== searchQuery) {
      setSearchQuery(q);
    }
  }, [location.search]);

  const addToRecentSearches = (query: string) => {
    if (!query.trim()) return;
    const newRecent = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5);
    setRecentSearches(newRecent);
    try {
      localStorage.setItem('recent_searches', JSON.stringify(newRecent));
    } catch (e) {
      // If it fails, we just don't save the recent search, no big deal
      performCacheMaintenance();
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem('recent_searches');
  };

  useEffect(() => {
    if (products.length > 0) {
      setTimeout(() => {
        window.scrollTo(0, searchScrollPos);
      }, 50);
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setSearchScrollPos(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [setSearchScrollPos]);

  useEffect(() => {
    const performSearch = async () => {
      if (!searchQuery.trim()) {
        setProducts([]);
        setFilteredProducts([]);
        setError(null);
        return;
      }
      
      setLoading(true);
      setError(null);
      try {
        const data = await searchProducts(searchQuery);
        setProducts(data);
        setFilteredProducts(data);
        setSearchData(data, searchQuery);
        if (data.length > 0 && searchQuery) {
          addToRecentSearches(searchQuery);
        }
      } catch (err) {
        console.error('Search failed:', err);
        setError('حدث خطأ أثناء البحث. يرجى المحاولة مرة أخرى.');
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(performSearch, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    let result = [...products];

    // Apply filters
    if (activeFilter === 'free_shipping') {
      // Products over 50,000 IQD get free shipping in our business logic
      result = result.filter(p => p.price >= 50000); 
    } else if (activeFilter === 'top_rated') {
      // Simulated top rated (products with even IDs for demo)
      result = result.filter(p => p.id % 2 === 0);
    } else if (activeFilter === 'under_25k') {
      result = result.filter(p => p.price < 25000);
    }

    // Apply sorting
    if (sortBy === 'price_asc') {
      result.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price_desc') {
      result.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'rating') {
      // Sort by simulated rating (higher IDs first for demo)
      result.sort((a, b) => b.id - a.id);
    }

    setFilteredProducts(result);
  }, [activeFilter, sortBy, products]);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const showToast = useToastStore((state) => state.showToast);



  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background-light dark:bg-background-dark shadow-2xl font-display text-slate-900 dark:text-white antialiased selection:bg-primary/30 rtl pb-safe pt-safe" dir="rtl">
        <SearchHeader 
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onBack={() => navigate(-1)}
          onCartClick={() => navigate('/cart')}
          cartCount={cartCount}
          onFocus={() => setShowSuggestions(true)}
          onClear={() => setSearchQuery('')}
          onSubmit={() => setShowSuggestions(false)}
        />

        {showSuggestions && (searchQuery === '' || products.length === 0) && (
          <SearchSuggestions 
            recentSearches={recentSearches}
            popularSearches={popularSearches}
            onSelect={(q) => {
              setSearchQuery(q);
              setShowSuggestions(false);
            }}
            onClearRecent={clearRecentSearches}
            onClose={() => setShowSuggestions(false)}
          />
        )}

        <FilterSortStrip 
          activeFilter={activeFilter}
          sortBy={sortBy}
          onFilterChange={setActiveFilter}
          onSortChange={setSortBy}
        />

        <main className="flex-1 p-3 pb-24 overflow-y-auto">
          {searchQuery && !loading && filteredProducts.length > 0 && (
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">النتائج لـ "{searchQuery}"</h2>
              <span className="text-sm text-slate-500">{filteredProducts.length} منتج</span>
            </div>
          )}

          {loading && <SearchLoadingState query={searchQuery} />}

          {error && (
            <div className="p-6 text-center">
              <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={40} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">عذراً، حدث خطأ</h3>
              <p className="text-slate-500 text-sm mb-6">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-primary text-white rounded-xl font-bold"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {!loading && !error && searchQuery && filteredProducts.length === 0 && (
            <SearchEmptyState 
              query={searchQuery}
              popularSearches={popularSearches}
              onSelect={setSearchQuery}
            />
          )}

          {!loading && !error && !searchQuery && (
            <SearchEmptyState 
              query=""
              popularSearches={popularSearches}
              onSelect={setSearchQuery}
            />
          )}

          {!loading && !error && filteredProducts.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredProducts.map((product) => (
                <SearchProductCard 
                  key={product.id}
                  product={product}
                  onNavigate={(id) => navigate(`/product?id=${id}`, { state: { initialProduct: product } })}
                  onToggleWishlist={(p) => toggleWishlist(p.id, p)}
                  isWishlisted={isProductInWishlist(product.id)}
                />
              ))}
            </div>
          )}
        </main>

        {/* Floating Action Button: Scroll to Top */}
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-24 left-6 z-40 size-12 rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-white/5 flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-90 transition-all"
        >
          <ArrowUp size={24} />
        </button>
      </div>
  );
};

export default SearchResults;
