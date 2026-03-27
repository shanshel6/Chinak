import React, { useEffect, useRef, useState } from 'react';
import LazyImage from '../LazyImage';
import { Check, Heart, Pencil, Star, X } from 'lucide-react';
import type { Product } from '../../types/product';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../store/useAuthStore';
import { archiveProduct, updateProduct } from '../../services/api';
import { useToastStore } from '../../store/useToastStore';

interface ProductCardProps {
  product: Product;
  onNavigate: (id: number | string) => void;
  onAddToWishlist: (e: React.MouseEvent, product: Product) => void;
  isProductInWishlist: (id: number | string) => boolean;
  allowAdminFeatureControls?: boolean;
  searchContextQuery?: string;
}

const ProductCard: React.FC<ProductCardProps> = React.memo(({
  product: initialProduct,
  onNavigate,
  onAddToWishlist,
  isProductInWishlist,
  allowAdminFeatureControls = false,
  searchContextQuery = '',
}) => {
  const [product, setProduct] = useState(initialProduct);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isTogglingFeatured, setIsTogglingFeatured] = useState(false);
  const [showFeatureEditor, setShowFeatureEditor] = useState(false);
  const [isSavingFeatureTerms, setIsSavingFeatureTerms] = useState(false);
  const [featureTerms, setFeatureTerms] = useState<string[]>(() => {
    const raw = Array.isArray(initialProduct?.aiMetadata?.featuredSearchTerms)
      ? initialProduct.aiMetadata.featuredSearchTerms
      : [];
    const terms = raw.map((v: any) => String(v || '').trim()).filter(Boolean);
    return terms.length > 0 ? terms : [''];
  });
  const user = useAuthStore(state => state.user);
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';
  const canManageFeature = Boolean(isAdmin && allowAdminFeatureControls);
  const showToast = useToastStore(state => state.showToast);

  const normalizeTerm = (value: string) => String(value || '').trim().toLowerCase();
  const normalizeUniqueTerms = (terms: string[]) => {
    const seen = new Set<string>();
    const output: string[] = [];
    terms.forEach((entry) => {
      const trimmed = String(entry || '').trim();
      if (!trimmed) return;
      const key = normalizeTerm(trimmed);
      if (!key || seen.has(key)) return;
      seen.add(key);
      output.push(trimmed);
    });
    return output;
  };
  const currentQuery = String(searchContextQuery || '').trim();
  const updateFeatureState = (nextFeatured: boolean, nextTerms: string[]) => {
    setProduct((prev) => ({
      ...prev,
      isFeatured: nextFeatured,
      aiMetadata: {
        ...(prev.aiMetadata || {}),
        featuredSearchTerms: nextTerms
      }
    }));
    setFeatureTerms(nextTerms.length > 0 ? nextTerms : ['']);
  };

  useEffect(() => {
    setProduct(initialProduct);
    const raw = Array.isArray(initialProduct?.aiMetadata?.featuredSearchTerms)
      ? initialProduct.aiMetadata.featuredSearchTerms
      : [];
    const terms = raw.map((v: any) => String(v || '').trim()).filter(Boolean);
    setFeatureTerms(terms.length > 0 ? terms : ['']);
  }, [initialProduct]);

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin || isArchiving) return;

    if (window.confirm('هل أنت متأكد من أرشفة (إخفاء) هذا المنتج؟')) {
      try {
        setIsArchiving(true);
        // Pass the token explicitly to ensure it authenticates properly
        const token = useAuthStore.getState().token || localStorage.getItem('auth_token');
        await archiveProduct(product.id, token);
        setProduct(prev => ({ ...prev, isActive: false }));
        showToast('تم إخفاء المنتج بنجاح', 'success');
      } catch (error) {
        console.error('Failed to archive product:', error);
        showToast('فشل إخفاء المنتج', 'error');
        setIsArchiving(false);
      }
    }
  };

  const handleToggleFeatured = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManageFeature || isTogglingFeatured || isSavingFeatureTerms) return;
    try {
      setIsTogglingFeatured(true);
      const token = useAuthStore.getState().token || localStorage.getItem('auth_token');
      const existingTerms = normalizeUniqueTerms(Array.isArray(product?.aiMetadata?.featuredSearchTerms) ? product.aiMetadata.featuredSearchTerms : []);
      const queryKey = normalizeTerm(currentQuery);
      const hasQueryInTerms = Boolean(queryKey && existingTerms.some((term) => normalizeTerm(term) === queryKey));
      let nextTerms: string[] = [];
      if (!product.isFeatured) {
        nextTerms = normalizeUniqueTerms([currentQuery, ...existingTerms]);
      } else if (hasQueryInTerms) {
        nextTerms = existingTerms.filter((term) => normalizeTerm(term) !== queryKey);
      } else {
        nextTerms = normalizeUniqueTerms([currentQuery, ...existingTerms]);
      }
      const nextFeatured = nextTerms.length > 0;
      await updateProduct(product.id, { isFeatured: nextFeatured, featuredSearchTerms: nextTerms }, token);
      updateFeatureState(nextFeatured, nextTerms);
      if (nextFeatured) {
        showToast('تم تثبيت المنتج لعبارة البحث الحالية', 'success');
      } else {
        showToast('تم إلغاء تثبيت المنتج من نتائج البحث', 'success');
      }
    } catch (error) {
      console.error('Failed to toggle featured status:', error);
      showToast('فشل تحديث تمييز المنتج', 'error');
    } finally {
      setIsTogglingFeatured(false);
    }
  };

  const handleOpenFeatureEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManageFeature || !product.isFeatured) return;
    const existingTerms = normalizeUniqueTerms(Array.isArray(product?.aiMetadata?.featuredSearchTerms) ? product.aiMetadata.featuredSearchTerms : []);
    setFeatureTerms(existingTerms.length > 0 ? existingTerms : ['']);
    setShowFeatureEditor((prev) => !prev);
  };

  const handleFeatureTermChange = (index: number, value: string) => {
    setFeatureTerms((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const handleFeatureTermEnter = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setFeatureTerms((prev) => {
      const next = [...prev];
      if (!String(next[index] || '').trim()) return next;
      next.splice(index + 1, 0, '');
      return next;
    });
  };

  const handleSaveFeatureTerms = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManageFeature || isSavingFeatureTerms || isTogglingFeatured) return;
    try {
      setIsSavingFeatureTerms(true);
      const token = useAuthStore.getState().token || localStorage.getItem('auth_token');
      const nextTerms = normalizeUniqueTerms(featureTerms);
      const nextFeatured = nextTerms.length > 0;
      await updateProduct(product.id, { isFeatured: nextFeatured, featuredSearchTerms: nextTerms }, token);
      updateFeatureState(nextFeatured, nextTerms);
      setShowFeatureEditor(false);
      showToast('تم حفظ كلمات تثبيت البحث', 'success');
    } catch (error) {
      console.error('Failed to save featured search terms:', error);
      showToast('فشل حفظ كلمات التثبيت', 'error');
    } finally {
      setIsSavingFeatureTerms(false);
    }
  };

  const [_currentImageIndex, _setCurrentImageIndex] = React.useState(0);
  const displayImages = React.useMemo(() => {
    // START WITH MAIN IMAGE (product.image) - This is critical for consistency with search/home
    const images = [];
    if (product.image) images.push(product.image);
    
    // Add gallery images (excluding duplicates of main image)
    if (product.images && Array.isArray(product.images)) {
      product.images.forEach(img => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && url !== product.image) images.push(url);
      });
    }
    return images;
  }, [product.image, product.images]);

  const variants = product.variants || [];
  
  // Find the cheapest variant to get the correct price AND weight
  const minVariant = React.useMemo(() => {
    if (!variants.length) return null;
    return variants.reduce((min: any, curr: any) => {
      if (!curr?.price) return min;
      if (!min) return curr;
      return Number(curr.price) < Number(min.price) ? curr : min;
    }, null);
  }, [variants]);

  const minPrice = minVariant ? minVariant.price : product.price;

  const prefetchTimerRef = useRef<any>(null);
  const isPrefetched = useRef(false);

  const handleMouseEnter = () => {
    if (isPrefetched.current) return;
    
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        // Prefetch everything needed for ProductDetails page
        // ONLY if user hovers for > 500ms
        // await Promise.all([
        //   fetchProductById(product.id),
        //   fetchProductReviews(product.id),
        //   checkProductPurchase(product.id)
        // ]);
        // isPrefetched.current = true;
        // console.log(`Prefetched product: ${product.id}`);
      } catch (e) {
        // Silently fail
      }
    }, 500); // Slightly longer delay for products to avoid excessive prefetching while scrolling
  };

  const handleMouseLeave = () => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  };

  const [_airRate] = useState<number>(15400);
  const [_seaRate] = useState<number>(182000);
  const [_minFloor] = useState<number>(0);

  // Removed individual fetchSettings call to prevent "N+1" API flood
  // Rates should be passed via props or global store if dynamic calculation is needed
  /*
  useEffect(() => {
    const loadRates = async () => {
      try {
        const settings = await fetchSettings();
        if (settings?.airShippingRate) setAirRate(settings.airShippingRate);
        if (settings?.seaShippingRate) setSeaRate(settings.seaShippingRate);
        setMinFloor(0);
      } catch (e) {}
    };
    loadRates();
  }, []);
  */

  const totalPrice = React.useMemo(() => {
    // Just return the minPrice which is already the final price from DB
    return minPrice;
  }, [minPrice]);

  // If the product is archived and we are just hiding it from view instantly
  if (product.isActive === false) {
    return null;
  }

  return (
    <motion.div 
      layoutId={`product-${product.id}`}
      onClick={() => onNavigate(product.id)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      whileHover={{ y: -5 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className="group relative flex flex-col overflow-hidden rounded-[24px] bg-white dark:bg-slate-800 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] cursor-pointer ring-1 ring-slate-100 dark:ring-slate-700/50"
    >
      {/* Admin Archive Button */}
      {isAdmin && (
        <button
          onClick={handleArchive}
          disabled={isArchiving}
          className="absolute top-3 left-3 z-20 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-md transition-colors pointer-events-auto"
          title="أرشفة المنتج (إخفاء)"
        >
          <X size={16} />
        </button>
      )}
      {canManageFeature && (
        <button
          onClick={handleToggleFeatured}
          disabled={isTogglingFeatured || isSavingFeatureTerms}
          className={`absolute top-3 left-14 z-20 p-1.5 rounded-full shadow-md transition-colors pointer-events-auto ${
            product.isFeatured
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-slate-700/85 hover:bg-slate-800 text-white'
          }`}
          title={product.isFeatured ? 'إلغاء تثبيت المنتج لعبارة البحث الحالية' : 'تثبيت المنتج لعبارة البحث الحالية'}
        >
          <Star size={16} fill={product.isFeatured ? 'currentColor' : 'none'} />
        </button>
      )}
      {canManageFeature && product.isFeatured && (
        <button
          onClick={handleOpenFeatureEditor}
          disabled={isSavingFeatureTerms || isTogglingFeatured}
          className="absolute top-3 left-24 z-20 p-1.5 rounded-full shadow-md transition-colors pointer-events-auto bg-indigo-600 hover:bg-indigo-700 text-white"
          title="تعديل عبارات التثبيت"
        >
          <Pencil size={16} />
        </button>
      )}
      {canManageFeature && showFeatureEditor && product.isFeatured && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-14 left-3 right-3 z-30 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl"
        >
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {featureTerms.map((term, index) => (
              <input
                key={`feature-term-${index}`}
                value={term}
                onChange={(e) => handleFeatureTermChange(index, e.target.value)}
                onKeyDown={(e) => handleFeatureTermEnter(e, index)}
                placeholder="اكتب عبارة بحث ثم اضغط Enter"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500"
              />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowFeatureEditor(false);
              }}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              إغلاق
            </button>
            <button
              onClick={handleSaveFeatureTerms}
              disabled={isSavingFeatureTerms}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 text-white disabled:opacity-60 flex items-center gap-1"
            >
              <Check size={14} />
              حفظ
            </button>
          </div>
        </div>
      )}

      {/* Image Container */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-slate-50 dark:bg-slate-700/50">
        <LazyImage 
          src={displayImages[_currentImageIndex] || product.image} 
          alt={product.name}
          width={300}
          quality={85}
          isThumbnail={true}
          objectFit="contain"
          className="h-full w-full bg-white transition-transform duration-700 group-hover:scale-110" 
        />
        
        {/* Top Badges */}
        <div className="absolute top-3 right-3 left-3 flex justify-between items-start z-10 pointer-events-none">
          {product.isFeatured ? (
            <div className="px-2.5 py-1 rounded-full bg-primary/90 backdrop-blur-md text-[10px] font-bold text-white shadow-sm pointer-events-auto">
              رائج
            </div>
          ) : <div />}
          
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => onAddToWishlist(e, product)}
            className={`pointer-events-auto flex size-9 items-center justify-center rounded-full backdrop-blur-md shadow-sm transition-all ${
              isProductInWishlist(product.id) 
                ? 'bg-red-50 text-red-500 hover:bg-red-100' 
                : 'bg-white/70 text-slate-700 hover:bg-primary hover:text-white dark:bg-slate-800/50 dark:text-white dark:hover:bg-primary'
            }`}
          >
            <Heart size={18} fill={isProductInWishlist(product.id) ? "currentColor" : "none"} strokeWidth={2.5} />
          </motion.button>
        </div>



        {displayImages.length > 1 && (
          <div className="absolute bottom-3 left-3 flex gap-1.5 z-10">
            {displayImages.slice(0, 5).map((_, i) => (
              <div 
                key={i} 
                className={`h-1 rounded-full transition-all duration-300 shadow-sm ${i === _currentImageIndex ? 'w-4 bg-primary dark:bg-primary-400' : 'w-1 bg-primary/30 dark:bg-primary-400/30'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info Container */}
      <div className="flex flex-col gap-2 p-4 pt-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100 h-[40px]">
          {product.name}
        </h3>
        
        <div className="flex items-end justify-between mt-1">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-medium">السعر</span>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-primary dark:text-primary-400 tracking-tight">
                {totalPrice.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-primary/80 dark:text-primary-400/80">د.ع</span>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-1 items-end justify-end max-w-[50%]">
            {/* Condition Tag - Default to Used if null */}
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              product.neworold === true
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' 
                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
            }`}>
              {product.neworold === true ? 'جديد' : 'مستعمل'}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

export default ProductCard;
