import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { fetchProductById, fetchProductReviews, checkProductPurchase, findProductInGlobalCache, fetchSettings } from '../services/api';
import { useWishlistStore } from '../store/useWishlistStore';
import { useCartStore } from '../store/useCartStore';
import { useAuthStore } from '../store/useAuthStore';
import { useToastStore } from '../store/useToastStore';
import { calculateInclusivePrice, getDefaultShippingMethod } from '../utils/shipping';
import type { ShippingRates } from '../types/shipping';
import { Clipboard } from '@capacitor/clipboard';
import LazyImage from '../components/LazyImage';
import ProductHeader from '../components/product/ProductHeader';
import ImageGallery from '../components/product/ImageGallery';
import ProductInfo from '../components/product/ProductInfo';
import ProductOptions from '../components/product/ProductOptions';
import ProductDescription from '../components/product/ProductDescription';
import ProductSpecs from '../components/product/ProductSpecs';
import ReviewsSection from '../components/product/ReviewsSection';
import SimilarProducts from '../components/product/SimilarProducts';
import AddToCartBar from '../components/product/AddToCartBar';

interface Review {
  id: number;
  rating: number;
  comment: string;
  createdAt: string;
  user: { name: string };
  images?: string[];
}

interface Product {
  id: number;
  name: string;
  chineseName?: string;
  price: number;
  image: string;
  description: string;
  specs?: any;
  reviews?: Review[];
  images?: { id: number | string; url: string; order: number; type?: string }[];
  options?: any[];
  variants?: any[];
  purchaseUrl?: string;
  videoUrl?: string;
  originalPrice?: number;
  reviewsCountShown?: string;
  storeEvaluation?: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  domesticShippingFee?: number;
  basePriceRMB?: number;
}

import { AlertCircle, Package, MessageSquareText, Store, Star } from 'lucide-react';

const ProductDetails: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const wishlistItems = useWishlistStore((state) => state.items);
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const addItem = useCartStore((state) => state.addItem);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const showToast = useToastStore((state) => state.showToast);
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('id');
  
  const isProductInWishlist = (id: number | string) => wishlistItems.some(item => String(item.productId) === String(id));
  
  const [product, setProduct] = useState<Product | null>(() => {
    // 1. Try to get initial data from navigation state for instant rendering
    if (location.state && (location.state as any).initialProduct) {
      return (location.state as any).initialProduct;
    }
    // 2. Try to find in global cache (from Home page lists)
    if (productId) {
      const globalCached = findProductInGlobalCache(productId);
      if (globalCached) return globalCached;
    }
    return null;
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [similarProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(!product); // Only show loading if we don't have initial data
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [shippingMethod, setShippingMethod] = useState<'air' | 'sea'>(() => {
    if (productId) {
      const saved = localStorage.getItem(`shipping_pref_${productId}`);
      if (saved === 'air' || saved === 'sea') return saved;
    }
    return 'air';
  });
  const userChangedShipping = useRef(false);
  const [shouldRenderDetails, setShouldRenderDetails] = useState(false);
  const [shippingRates, setShippingRates] = useState<ShippingRates & { airThreshold?: number, seaThreshold?: number }>({
    airRate: 15400,
    seaRate: 182000,
    minFloor: 0,
    airThreshold: 30000,
    seaThreshold: 80000
  });

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchSettings();
        if (settings) {
          setShippingRates({
            airRate: settings.airShippingRate || 15400,
            seaRate: settings.seaShippingRate || 182000,
            minFloor: 0,
            airThreshold: settings.airShippingThreshold || 30000,
            seaThreshold: settings.seaShippingThreshold || 80000
          });
        }
      } catch (e) { }
    };
    loadSettings();
  }, []);

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    // Try to get initial options from navigation state or global cache
    const initialProd = (location.state as any)?.initialProduct || (productId ? findProductInGlobalCache(productId) : null);
    if (initialProd?.options?.length) {
      const options: Record<string, string> = {};
      initialProd.options.forEach((opt: any) => {
        try {
          const values = typeof opt.values === 'string' ? JSON.parse(opt.values) : opt.values;
          if (Array.isArray(values) && values.length > 0) {
            const firstVal = values[0];
            options[opt.name] = typeof firstVal === 'object' 
              ? (firstVal.value || firstVal.name || String(firstVal)) 
              : String(firstVal);
          }
        } catch (e) {
          // Ignore
        }
      });
      return options;
    }
    return {};
  });

  const [currentVariant, setCurrentVariant] = useState<any>(null);

  // Effect to initialize options when product data arrives (if not already set)
  useEffect(() => {
    if (product?.options?.length) {
      setSelectedOptions(prev => {
        const newOptions = { ...prev };
        let changed = false;

        product.options!.forEach((opt: any) => {
          if (!newOptions[opt.name]) {
            try {
              const values = typeof opt.values === 'string' ? JSON.parse(opt.values) : opt.values;
              if (Array.isArray(values) && values.length > 0) {
                const firstVal = values[0];
                newOptions[opt.name] = typeof firstVal === 'object' 
                  ? (firstVal.value || firstVal.name || String(firstVal)) 
                  : String(firstVal);
                changed = true;
              }
            } catch (e) {
              // Ignore
            }
          }
        });

        return changed ? newOptions : prev;
      });
    }

    // Auto-select shipping method based on weight and dimensions
    // Only if the user hasn't manually changed it during this session
    // and there's no saved preference for this product
    if (product && !userChangedShipping.current) {
      const savedPref = localStorage.getItem(`shipping_pref_${product.id}`);
      if (!savedPref) {
        setShippingMethod(getDefaultShippingMethod(product.weight, product.length, product.width, product.height));
      }
    }
  }, [product]);

  // Defer rendering of heavy detail images
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        setShouldRenderDetails(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const cartItems = useCartStore((state) => state.items);

  // Extract review summary and actual specs from the specs string
  const { displaySpecs, reviewSummary } = useMemo(() => {
    if (!product?.specs) return { displaySpecs: '', reviewSummary: null };
    
    // If it's already an object, check if it contains review data
    if (typeof product.specs === 'object' && product.specs !== null) {
      const specsObj = product.specs as any;
      if (specsObj.reviews || specsObj.detailedReviews || specsObj.comments) {
        return { displaySpecs: '', reviewSummary: specsObj };
      }
      return { displaySpecs: JSON.stringify(product.specs), reviewSummary: null };
    }

    const specsStr = String(product.specs);
    
    // Case 1: Contains the delimiter
    if (specsStr.includes('---REVIEW_SUMMARY---')) {
      const parts = specsStr.split('---REVIEW_SUMMARY---');
      try {
        return {
          displaySpecs: parts[0].trim(),
          reviewSummary: JSON.parse(parts[1].trim())
        };
      } catch (e) {
        console.error('Error parsing review summary from specs string:', e);
        return { displaySpecs: specsStr, reviewSummary: null };
      }
    }
    
    // Case 2: The entire string is a JSON object
    if (specsStr.trim().startsWith('{') && specsStr.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(specsStr);
        if (parsed.reviews || parsed.detailedReviews || parsed.comments) {
          return { displaySpecs: '', reviewSummary: parsed };
        }
      } catch (e) {
        // Not valid JSON or not a review summary, continue to default
      }
    }
    
    return { displaySpecs: specsStr, reviewSummary: null };
  }, [product?.specs]);

  const allReviews = useMemo(() => {
    const combined: Review[] = [...reviews];
    
    // Merge reviews from summary if they aren't already in the reviews array
    if (reviewSummary?.reviews && Array.isArray(reviewSummary.reviews)) {
      reviewSummary.reviews.forEach((r: any, idx: number) => {
        const comment = r.comment || r.text || r.content || r.body || '';
        const userName = r.user || r.username || r.name || 'عميل';
        const userObj = typeof userName === 'string' ? { name: userName } : (userName.name ? userName : { name: 'عميل' });
        
        if (comment) {
          combined.push({
            id: -(idx + 100),
            rating: Number(r.rating) || 5,
            comment: String(comment),
            createdAt: r.date || r.createdAt || new Date().toISOString(),
            user: userObj,
            images: Array.isArray(r.images) ? r.images : []
          });
        }
      });
    }
    
    if (reviewSummary?.detailedReviews && Array.isArray(reviewSummary.detailedReviews)) {
      reviewSummary.detailedReviews.forEach((r: any, idx: number) => {
        const comment = Array.isArray(r.comments) ? r.comments.join(' ') : (r.comment || r.comments || r.text || '');
        if (comment) {
          combined.push({
            id: -(idx + 200),
            rating: r.rating || 5,
            comment: String(comment),
            createdAt: r.date || r.createdAt || new Date().toISOString(),
            user: { name: r.user || r.username || r.name || 'عميل' },
            images: r.images || []
          });
        }
      });
    }

    // Deduplicate by user and comment
    const seen = new Set();
    return combined.filter(r => {
      const key = `${r.user?.name || 'anonymous'}-${r.comment}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [reviews, reviewSummary]);

  const averageRating = useMemo(() => {
    return allReviews.length > 0 
      ? (allReviews.reduce((acc, rev) => acc + (rev.rating || 5), 0) / allReviews.length).toFixed(1)
      : '4.8';
  }, [allReviews]);

  const { inclusivePrice, airPrice, seaPrice } = useMemo(() => {
    const basePrice = currentVariant?.price || product?.price || 0;
    if (!product) return { inclusivePrice: basePrice, airPrice: basePrice, seaPrice: basePrice };
    
    const air = calculateInclusivePrice(
      basePrice,
      product.weight,
      product.length,
      product.width,
      product.height,
      shippingRates,
      'air',
      product.domesticShippingFee || 0,
      product.basePriceRMB,
      product.isPriceCombined
    );

    const sea = calculateInclusivePrice(
      basePrice,
      product.weight,
      product.length,
      product.width,
      product.height,
      shippingRates,
      'sea',
      product.domesticShippingFee || 0,
      product.basePriceRMB,
      product.isPriceCombined
    );

    return {
      inclusivePrice: shippingMethod === 'air' ? air : sea,
      airPrice: air,
      seaPrice: sea
    };
  }, [currentVariant, product, shippingMethod, shippingRates]);

  useEffect(() => {
    if (product) {
      const exists = cartItems.some(item => 
        item.productId === product.id && 
        (!currentVariant || item.variantId === currentVariant.id) &&
        item.shippingMethod === shippingMethod
      );
      setIsAdded(exists);
    }
  }, [product, currentVariant, cartItems, shippingMethod]);

  const galleryImages = useMemo(() => {
    if (!product) return [];
    const images: any[] = [];
    
    // Add variant image first if selected
    if (currentVariant?.image) {
      images.push({ url: currentVariant.image, order: -10 });
    }

    if (product.image) images.push({ url: product.image, order: -1 });
    if (Array.isArray(product.images)) {
      product.images.forEach((img: any) => {
        if (img.type === 'GALLERY' || !img.type) {
          const url = typeof img === 'string' ? img : (img.url || img.image);
          if (url) images.push({ url, order: img.order || 0 });
        }
      });
    }
    const uniqueImages = images.reduce((acc: any[], current) => {
      if (!acc.find(item => item.url === current.url) && current.url) acc.push(current);
      return acc;
    }, []);
    return uniqueImages.sort((a, b) => a.order - b.order);
  }, [product, currentVariant?.image]);

  const detailImages = useMemo(() => {
    if (!product || !Array.isArray(product.images)) return [];
    return product.images
      .filter((img: any) => img.type === 'DETAIL')
      .map((img: any) => ({
        url: typeof img === 'string' ? img : (img.url || img.image),
        order: img.order || 0
      }))
      .sort((a: any, b: any) => a.order - b.order);
  }, [product]);

  useEffect(() => {
    const loadData = async () => {
      if (!productId) return;
      
      // Try to load initial data for immediate rendering
      const initialData = (location.state as any)?.initialProduct || findProductInGlobalCache(productId);
      
      if (initialData) {
        setProduct(initialData);
        setLoading(false);
        
        // Initialize options for the new product immediately
        if (initialData.options?.length) {
          const options: Record<string, string> = {};
          initialData.options.forEach((opt: any) => {
            try {
              const values = typeof opt.values === 'string' ? JSON.parse(opt.values) : opt.values;
              if (Array.isArray(values) && values.length > 0) {
                const firstVal = values[0];
                options[opt.name] = typeof firstVal === 'object' 
                  ? (firstVal.value || firstVal.name || String(firstVal)) 
                  : String(firstVal);
              }
            } catch (e) {}
          });
          setSelectedOptions(options);
        } else {
          setSelectedOptions({});
        }
      } else {
        // Only if no initial data, try local storage cache
        const cacheKey = `/products/${productId}`;
        const cachedProduct = localStorage.getItem(`app_cache_${cacheKey}`);
        
        if (cachedProduct) {
          try {
            const { data } = JSON.parse(cachedProduct);
            setProduct(data);
            setLoading(false);
            
            // Initialize options from cache
            if (data.options?.length) {
              const options: Record<string, string> = {};
              data.options.forEach((opt: any) => {
                try {
                  const values = typeof opt.values === 'string' ? JSON.parse(opt.values) : opt.values;
                  if (Array.isArray(values) && values.length > 0) {
                    const firstVal = values[0];
                    options[opt.name] = typeof firstVal === 'object' 
                      ? (firstVal.value || firstVal.name || String(firstVal)) 
                      : String(firstVal);
                  }
                } catch (e) {}
              });
              setSelectedOptions(options);
            }
          } catch (e) {
            console.warn('Failed to parse cached product', e);
            setProduct(null);
            setLoading(true);
            setSelectedOptions({});
          }
        } else {
          setProduct(null);
          setLoading(true);
          setSelectedOptions({});
        }
      }

      setReviews([]);
      setShouldRenderDetails(false);

      // 1. Fetch main product info first (high priority)
      const fetchMainProduct = async () => {
        try {
          const productData = await fetchProductById(productId);
          
          // Merge with initial data if present to avoid losing already-rendered info
          setProduct(prev => {
            if (!prev) return productData;
            return { ...prev, ...productData };
          });
          
          setError(null);
        } catch (err) {
          console.error('Error fetching product info:', err);
          // Use a functional state update to check if we have any product data
          setProduct(current => {
            if (!current) setError('حدث خطأ أثناء تحميل بيانات المنتج.');
            return current;
          });
        } finally {
          setLoading(false);
        }
      };

      // 2. Fetch reviews in background (medium priority)
      const fetchReviews = async () => {
        setReviewsLoading(true);
        try {
          const reviewsData = await fetchProductReviews(productId);
          setReviews(reviewsData);
        } catch (err) {
          console.error('Error fetching reviews:', err);
        } finally {
          setReviewsLoading(false);
        }
      };

      // 3. Check purchase status in background (low priority)
      const fetchPurchaseStatus = async () => {
        try {
          await checkProductPurchase(productId);
        } catch (err) {
          console.error('Error checking purchase status:', err);
        }
      };

      // Run fetches progressively
      fetchMainProduct();
      fetchReviews();
      fetchPurchaseStatus();
    };
    
    loadData();
  }, [productId, location.state, isAuthenticated, showToast]);

  useEffect(() => {
    if (product && product.variants && product.variants.length > 0) {
      const variant = product.variants.find((v: any) => {
        try {
          const combination = typeof v.combination === 'string' ? JSON.parse(v.combination) : v.combination;
          if (!combination) return false;
          
          // Case-insensitive and trimmed matching
          return Object.entries(selectedOptions).every(([selKey, selVal]) => {
            const matchKey = Object.keys(combination).find(k => 
              k.toLowerCase().trim() === selKey.toLowerCase().trim()
            );
            if (!matchKey) return false;
            return String(combination[matchKey]).toLowerCase().trim() === String(selVal).toLowerCase().trim();
          });
        } catch (e) {
          console.error('Error matching variant:', e);
          return false;
        }
      });
      setCurrentVariant(variant || null);
    }
  }, [selectedOptions, product]);

  const allCartItems = useCartStore((state) => state.items);

  useEffect(() => {
    if (product && allCartItems.length > 0) {
      const isAlreadyInCart = allCartItems.some(item => 
        String(item.productId) === String(product.id) && 
        (item.variantId === currentVariant?.id || (!item.variantId && !currentVariant)) &&
        item.shippingMethod === shippingMethod
      );
      setIsAdded(isAlreadyInCart);
    } else {
      setIsAdded(false);
    }
  }, [product, currentVariant, shippingMethod, allCartItems]);

  const handleShippingMethodChange = (method: 'air' | 'sea') => {
    setShippingMethod(method);
    userChangedShipping.current = true;
    if (productId) {
      localStorage.setItem(`shipping_pref_${productId}`, method);
    }
  };

  const handleAddToCart = async () => {
    if (!product) return;
    if (!isAuthenticated) {
      showToast('يرجى تسجيل الدخول أولاً لإضافة منتجات إلى السلة', 'info');
      navigate('/login');
      return;
    }
    
    // Optimistic state update in the UI
    setIsAdding(true);
    setIsAdded(true);
    showToast('تمت إضافة المنتج إلى السلة بنجاح', 'success');

    try {
      await addItem(product.id, 1, currentVariant?.id, {
        id: product.id,
        name: product.name,
        price: currentVariant?.price || product.price || 0,
        image: currentVariant?.image || product.image,
        variant: currentVariant,
        weight: product.weight,
        length: product.length,
        width: product.width,
        height: product.height,
        domesticShippingFee: product.domesticShippingFee,
        basePriceRMB: product.basePriceRMB
      }, selectedOptions, shippingMethod);
    } catch (err) {
      // Rollback UI state if API fails
      setIsAdded(false);
      showToast('فشل إضافة المنتج إلى السلة', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleShare = async () => {
    if (!product) return;
    const shareData = { title: product.name, text: product.description, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await Clipboard.write({ string: window.location.href });
        showToast('تم نسخ الرابط إلى الحافظة', 'info');
      }
    } catch (err) {
      console.error('Error sharing:', err);
    }
  };

  if (loading && !product) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark pt-safe">
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce"></div>
            </div>
            <p className="text-sm font-bold text-slate-500 animate-pulse">جاري تحضير طلبك...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background-light dark:bg-background-dark items-center justify-center p-6 text-center rtl pt-safe" dir="rtl">
        <div className="w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-6 text-slate-400">
          {error ? <AlertCircle size={48} /> : <Package size={48} />}
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{error ? 'خطأ في التحميل' : 'المنتج غير موجود'}</h2>
        <p className="mt-2 text-slate-500">{error || 'عذراً، لم نتمكن من العثور على المنتج الذي تبحث عنه.'}</p>
        <div className="flex gap-4 mt-6">
          <button onClick={() => navigate('/')} className="px-6 py-2 border border-primary text-primary rounded-lg font-bold">العودة للرئيسية</button>
          {error && <button onClick={() => window.location.reload()} className="px-6 py-2 bg-primary text-white rounded-lg font-bold">إعادة المحاولة</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background-light dark:bg-background-dark pb-32 pb-safe pt-safe" dir="rtl">
      <ProductHeader 
        onBack={() => navigate(-1)}
        onShare={handleShare}
        onToggleWishlist={() => toggleWishlist(product.id, product)}
        isWishlisted={isProductInWishlist(product.id)}
      />

      <div className="md:grid md:grid-cols-2 md:gap-8 lg:gap-12 md:px-6 md:pt-6">
        <div className="md:sticky md:top-24 h-fit">
          <ImageGallery 
            images={galleryImages}
            productName={product.name}
          />
        </div>

        <main className="relative -mt-6 md:mt-0 bg-background-light dark:bg-background-dark rounded-t-3xl md:rounded-none px-5 md:px-0 pt-8 md:pt-0 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:shadow-none">
          <ProductInfo 
            price={currentVariant?.price || product?.price || 0}
            originalPrice={product.originalPrice}
            name={product.name}
            chineseName={product.chineseName}
            videoUrl={product.videoUrl}
            storeEvaluation={product.storeEvaluation}
            reviewsCountShown={product.reviewsCountShown}
            averageRating={averageRating}
            totalReviews={allReviews.length}
            weight={product.weight}
            length={product.length}
            width={product.width}
            height={product.height}
            domesticShippingFee={product.domesticShippingFee}
            basePriceRMB={product.basePriceRMB}
            airThreshold={shippingRates.airThreshold}
            seaThreshold={shippingRates.seaThreshold}
            variant={currentVariant}
            shippingMethod={shippingMethod}
            isPriceCombined={product.isPriceCombined}
          />

          {product.options && product.options.length > 0 && (
            <div className="mb-6 p-4 bg-white dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <ProductOptions 
                options={product.options}
                selectedOptions={selectedOptions}
                onOptionSelect={(name, val) => setSelectedOptions(prev => ({ ...prev, [name]: val }))}
              />
            </div>
          )}

          {/* Store Evaluation & Reviews Summary Section (Right below options) */}
          {(product.reviewsCountShown || product.storeEvaluation) && (
            <div className="mb-8 p-4 bg-white dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1.5 h-6 bg-primary rounded-full" />
                <h3 className="text-slate-900 dark:text-white text-lg font-black">تقييم المتجر والمنتج</h3>
              </div>
              
              <div className="space-y-4">
                {product.reviewsCountShown && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-white/5 last:border-0">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <MessageSquareText size={20} className="text-primary" />
                      <span className="text-sm font-bold">إجمالي المراجعات</span>
                    </div>
                    <span className="text-slate-900 dark:text-white font-black">{product.reviewsCountShown}</span>
                  </div>
                )}
                
                {product.storeEvaluation && (() => {
                  try {
                    const evalData = typeof product.storeEvaluation === 'string' 
                      ? (product.storeEvaluation.startsWith('{') ? JSON.parse(product.storeEvaluation) : { raw: product.storeEvaluation })
                      : product.storeEvaluation;
                    
                    if (!evalData) return null;
                    
                    // If it's just a raw string (not JSON), show it as individual tags split by commas or newlines
                    if (evalData.raw) {
                      const tags = evalData.raw
                        .replace('تقييم المتجر:', '')
                        .split(/[،,\n]/)
                        .map((s: string) => s.trim())
                        .filter((s: string) => s.length > 0);

                      return (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {tags.map((tag: string, idx: number) => (
                            <span key={idx} className="px-2 py-1 bg-primary/5 dark:bg-primary/10 text-primary rounded-lg text-[11px] font-bold border border-primary/10">
                              {tag}
                            </span>
                          ))}
                        </div>
                      );
                    }
                    
                    return (
                      <div className="space-y-3">
                        {evalData.shopName && (
                          <div className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-white/5 last:border-0">
                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                              <Store size={20} className="text-primary" />
                              <span className="text-sm font-bold">اسم المتجر</span>
                            </div>
                            <span className="text-slate-900 dark:text-white font-black">{evalData.shopName}</span>
                          </div>
                        )}
                        {evalData.score && (
                          <div className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-white/5 last:border-0">
                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                              <Star size={20} className="text-yellow-400 fill-yellow-400" />
                              <span className="text-sm font-bold">تقييم المتجر</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-primary font-black">{evalData.score}</span>
                              <span className="text-slate-400 text-xs">/ 5</span>
                            </div>
                          </div>
                        )}
                        {evalData.tags && Array.isArray(evalData.tags) && evalData.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {evalData.tags.map((tag: any, idx: number) => (
                              <span key={idx} className="px-2 py-1 bg-primary/5 dark:bg-primary/10 text-primary rounded-lg text-[11px] font-bold border border-primary/10">
                                {typeof tag === 'string' ? tag : (tag.text || tag.label)}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Show detailed evaluation items as tags if available */}
                        {evalData.evaluation && Array.isArray(evalData.evaluation) && evalData.evaluation.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-50 dark:border-white/5 mt-2">
                            {evalData.evaluation.map((item: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">{item.title || item.name}</span>
                                <span className="text-[11px] text-primary font-black">{item.score}</span>
                                {item.level && (
                                  <span className={`text-[9px] font-black px-1 rounded-md ${
                                    item.level.toLowerCase() === 'high' ? 'text-emerald-500 bg-emerald-500/10' : 
                                    item.level.toLowerCase() === 'medium' ? 'text-amber-500 bg-amber-500/10' : 
                                    'text-slate-400 bg-slate-400/10'
                                  }`}>
                                    {item.level.toUpperCase()}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  } catch (e) {
                    return null;
                  }
                })()}
              </div>
            </div>
          )}

          <ProductDescription 
            productName={product.name}
            description={product.description}
            specs={displaySpecs}
          />

          <ReviewsSection 
                reviews={allReviews} 
                reviewSummary={reviewSummary}
                loading={reviewsLoading}
              />

          {detailImages.length > 0 && shouldRenderDetails && (
            <div className="mt-12 space-y-4 px-0">
              <div className="flex items-center gap-3 mb-6 px-5">
                <div className="w-1.5 h-6 bg-primary rounded-full" />
                <h3 className="text-slate-900 dark:text-white text-lg font-black">تفاصيل إضافية</h3>
              </div>
              <div className="flex flex-col">
                {detailImages.map((img: any, idx: number) => (
                  <LazyImage 
                    key={idx}
                    src={img.url} 
                    alt={`Detail ${idx + 1}`}
                    width={800}
                    quality={75}
                    className="w-full h-auto"
                  />
                ))}
              </div>
            </div>
          )}

          <ProductSpecs specs={displaySpecs} />

          <SimilarProducts 
            products={similarProducts}
            onProductClick={(id) => {
              const selectedProduct = similarProducts.find(p => p.id === id);
              navigate(`/product?id=${id}`, { state: { initialProduct: selectedProduct } });
            }}
            rates={shippingRates}
          />
        </main>

        <AddToCartBar 
            price={inclusivePrice}
            onAddToCart={handleAddToCart}
            isAdding={isAdding}
            isAdded={isAdded}
            onGoToCart={() => navigate('/cart')}
            shippingMethod={shippingMethod}
            onShippingMethodChange={handleShippingMethodChange}
            airPrice={airPrice}
            seaPrice={seaPrice}
          />
      </div>
    </div>
  );
};

export default ProductDetails;
