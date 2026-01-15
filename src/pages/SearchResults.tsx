import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'none' | 'price_asc' | 'price_desc' | 'rating'>('none');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const observer = useRef<IntersectionObserver | null>(null);

  const lastProductElementRef = useCallback((node: HTMLDivElement) => {
    if (loading || loadingMore || !hasMore) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        setPage(prev => prev + 1);
      }
    });
    
    if (node) observer.current.observe(node);
  }, [loading, loadingMore, hasMore]);

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
    let isMounted = true;
    const performSearch = async () => {
      if (!searchQuery.trim()) {
        setProducts([]);
        setFilteredProducts([]);
        setError(null);
        setHasMore(false);
        return;
      }
      
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      
      setError(null);
      try {
        const data = await searchProducts(searchQuery, page);
        if (!isMounted) return;

        const newProducts = data.products || [];
        const total = data.total || 0;
        const serverHasMore = data.hasMore !== undefined ? data.hasMore : newProducts.length === 20;

        if (page === 1) {
          setProducts(newProducts);
          setFilteredProducts(newProducts);
          setTotalResults(total);
          setSearchData(newProducts, searchQuery);
          if (newProducts.length > 0 && searchQuery) {
            addToRecentSearches(searchQuery);
          }
        } else {
          setProducts(prev => {
            // Filter out any duplicates that might have been returned by the server
            const existingIds = new Set(prev.map(p => p.id));
            const uniqueNewProducts = newProducts.filter((p: Product) => !existingIds.has(p.id));
            
            const updated = [...prev, ...uniqueNewProducts];
            setSearchData(updated, searchQuery);
            return updated;
          });
        }
        
        setHasMore(serverHasMore);
      } catch (err) {
        if (!isMounted) return;
        console.error('Search failed:', err);
        setError('حدث خطأ أثناء البحث. يرجى المحاولة مرة أخرى.');
      } finally {
        if (isMounted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    };

    const timeoutId = setTimeout(performSearch, page === 1 ? 500 : 0);
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [searchQuery, page]);

  useEffect(() => {
    // Reset page when search query changes
    setPage(1);
    setHasMore(true);
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
    <div className="relative flex min-h-screen w-full flex-col bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-white antialiased selection:bg-primary/30 rtl overflow-visible" dir="rtl">
         <div className="sticky top-0 z-50 w-full bg-background-light dark:bg-background-dark border-b border-slate-200/50 dark:border-slate-800/50 shadow-sm transition-all duration-300">
           <div className="pt-1">
             <SearchHeader 
               query={searchQuery}
             onQueryChange={setSearchQuery}
             onBack={() => navigate('/')}
             onCartClick={() => navigate('/cart')}
             cartCount={cartCount}
             onFocus={() => setShowSuggestions(true)}
             onClear={() => setSearchQuery('')}
               onSubmit={() => setShowSuggestions(false)}
             />
           </div>

           <div className="pb-2">
             <FilterSortStrip 
               activeFilter={activeFilter}
               sortBy={sortBy}
               onFilterChange={setActiveFilter}
               onSortChange={setSortBy}
             />
           </div>
         </div>

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

        <main className="flex-1 p-3 pb-12">
          {searchQuery && !loading && filteredProducts.length > 0 && (
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">النتائج لـ "{searchQuery}"</h2>
              <span className="text-sm text-slate-500">{totalResults || filteredProducts.length} منتج</span>
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
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredProducts.map((product, index) => (
                  <div 
                    key={`${product.id}-${index}`}
                    ref={index === filteredProducts.length - 1 ? lastProductElementRef : null}
                  >
                    <SearchProductCard 
                      product={product}
                      onNavigate={(id) => navigate(`/product?id=${id}`, { state: { initialProduct: product } })}
                      onToggleWishlist={(p) => toggleWishlist(p.id, p)}
                      isWishlisted={isProductInWishlist(product.id)}
                    />
                  </div>
                ))}
              </div>

              {loadingMore && (
                <div className="flex flex-col items-center justify-center py-6 gap-3">
                  <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white dark:bg-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 animate-pulse">
                    <div className="h-5 w-5 border-2 border-t-transparent border-primary rounded-full animate-spin"></div>
                    <span className="text-sm font-black text-slate-900 dark:text-white">جاري تحميل المزيد...</span>
                  </div>
                </div>
              )}
              
              {!loadingMore && !hasMore && filteredProducts.length > 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
                  <p className="text-sm font-bold text-slate-400 dark:text-slate-500">وصلت إلى نهاية النتائج</p>
                  <div className="h-px w-12 bg-slate-200 dark:bg-slate-700"></div>
                </div>
              )}
            </>
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
