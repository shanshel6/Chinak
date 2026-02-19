import React, { useRef, useState } from 'react';
import LazyImage from '../LazyImage';
import { Heart, Plus } from 'lucide-react';
import type { Product } from '../../types/product';
import { motion } from 'framer-motion';

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
    <motion.div 
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
      {/* Image Container */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-slate-50 dark:bg-slate-700/50">
        <LazyImage 
          src={displayImages[_currentImageIndex] || product.image} 
          alt={product.name}
          width={300}
          quality={85}
          isThumbnail={true}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
        />
        
        {/* Top Badges */}
        <div className="absolute top-3 right-3 left-3 flex justify-between items-start z-10 pointer-events-none">
          {product.isFeatured ? (
            <div className="px-2.5 py-1 rounded-full bg-black/80 backdrop-blur-md text-[10px] font-bold text-white shadow-sm pointer-events-auto">
              رائج
            </div>
          ) : <div />}
          
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => onAddToWishlist(e, product)}
            className={`pointer-events-auto flex size-9 items-center justify-center rounded-full backdrop-blur-md shadow-sm transition-all ${
              isProductInWishlist(product.id) 
                ? 'bg-red-50 text-red-500' 
                : 'bg-white/70 text-slate-700 hover:bg-white dark:bg-black/30 dark:text-white'
            }`}
          >
            <Heart size={18} fill={isProductInWishlist(product.id) ? "currentColor" : "none"} strokeWidth={2.5} />
          </motion.button>
        </div>

        {/* Quick Add Button - Floating on Image */}
        <div className="absolute bottom-3 right-3 z-10 pointer-events-auto">
          <motion.button 
             whileHover={{ scale: 1.1 }}
             whileTap={{ scale: 0.9 }}
             onClick={(e) => {
               e.stopPropagation();
               onNavigate(product.id);
             }}
             className="size-10 rounded-full bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl text-slate-900 dark:text-white flex items-center justify-center hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors shadow-lg"
          >
            <Plus size={20} strokeWidth={2.5} />
          </motion.button>
        </div>

        {displayImages.length > 1 && (
          <div className="absolute bottom-3 left-3 flex gap-1.5 z-10">
            {displayImages.slice(0, 5).map((_, i) => (
              <div 
                key={i} 
                className={`h-1 rounded-full transition-all duration-300 shadow-sm ${i === _currentImageIndex ? 'w-4 bg-black dark:bg-white' : 'w-1 bg-black/20 dark:bg-white/30'}`}
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
              <span className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                {totalPrice.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-slate-500">د.ع</span>
            </div>
          </div>
          
          <div className="flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-50 dark:bg-slate-700/50 px-2 py-1 rounded-md">
            <span>{soldCount}+ بيع</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default ProductCard;
