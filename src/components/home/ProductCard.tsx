import React, { useRef, useState } from 'react';
import LazyImage from '../LazyImage';
import { Heart } from 'lucide-react';
import type { Product } from '../../types/product';

interface ProductCardProps {
  product: Product;
  onNavigate: (id: number | string) => void;
  onAddToWishlist: (e: React.MouseEvent, product: Product) => void;
  isProductInWishlist: (id: number | string) => boolean;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onNavigate,
  onAddToWishlist,
  isProductInWishlist,
}) => {
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

  // Simulated discovery data
  const soldCount = React.useMemo(() => {
    const numericId = typeof product.id === 'number' ? product.id : Number.parseInt(String(product.id), 10) || 0;
    return (numericId * 17) % 1000 + 50;
  }, [product.id]);

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

  return (
    <div 
      onClick={() => onNavigate(product.id)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-800 shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer"
    >
      {/* Image Container */}
      <div className="relative aspect-square w-full overflow-hidden bg-slate-100 dark:bg-slate-700">
        <LazyImage 
          src={displayImages[_currentImageIndex] || product.image} 
          alt={product.name}
          width={300}
          quality={80}
          isThumbnail={true}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" 
        />
        
        {/* Top Badges */}
        <div className="absolute top-2 right-2 left-2 flex justify-between items-start z-10 pointer-events-none">
          {product.isFeatured && (
            <div className="px-2 py-1 rounded-full bg-orange-500/90 backdrop-blur-sm text-[9px] font-black text-white uppercase tracking-wider shadow-sm pointer-events-auto">
              رائج
            </div>
          )}
          <button 
            onClick={(e) => onAddToWishlist(e, product)}
            className={`pointer-events-auto flex size-8 items-center justify-center rounded-full bg-white/60 dark:bg-black/20 backdrop-blur-md shadow-sm transition-all hover:bg-white hover:scale-110 active:scale-95 ${isProductInWishlist(product.id) ? 'text-red-500' : 'text-slate-600 dark:text-white'}`}
          >
            <Heart size={16} fill={isProductInWishlist(product.id) ? "currentColor" : "none"} strokeWidth={2.5} />
          </button>
        </div>

        {/* Quick Add Button - Floating on Image */}
        <div className="absolute bottom-2 left-2 z-10 pointer-events-auto opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
          <button 
             onClick={(e) => {
               e.stopPropagation();
               onNavigate(product.id);
             }}
             className="size-8 rounded-full bg-white/90 dark:bg-slate-800/90 backdrop-blur-md text-slate-900 dark:text-white flex items-center justify-center hover:bg-primary hover:text-white transition-colors shadow-sm"
          >
            <span className="text-xl leading-none mb-0.5">+</span>
          </button>
        </div>

        {displayImages.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            {displayImages.slice(0, 5).map((_, i) => (
              <div 
                key={i} 
                className={`h-1 rounded-full transition-all shadow-sm ${i === _currentImageIndex ? 'w-4 bg-white' : 'w-1 bg-white/50'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info Container */}
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-800 dark:text-slate-100 h-[38px]">
          {product.name}
        </h3>
        
        <div className="flex flex-col gap-1 mt-auto">
          {/* Price */}
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-0.5">
              <span className="text-lg font-black text-primary -mb-1">
                {totalPrice.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">د.ع</span>
            </div>
            
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <span>{soldCount}+ بيع</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
