import React, { useRef, useEffect, useState } from 'react';
import LazyImage from '../LazyImage';
import { fetchProductById, fetchProductReviews, checkProductPurchase, fetchSettings } from '../../services/api';
import { Heart } from 'lucide-react';
import { calculateShippingFee } from '../../utils/shipping';

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  images?: { id: number; url: string; order: number; type?: string }[];
  description: string;
  purchaseUrl?: string;
  variants?: any[];
  reviewsCountShown?: number;
  isFeatured?: boolean;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
}

interface ProductCardProps {
  product: Product;
  onNavigate: (id: number) => void;
  onAddToWishlist: (e: React.MouseEvent, product: Product) => void;
  isProductInWishlist: (id: number) => boolean;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onNavigate,
  onAddToWishlist,
  isProductInWishlist,
}) => {
  const [_currentImageIndex, _setCurrentImageIndex] = React.useState(0);
  const displayImages = React.useMemo(() => {
    const images = [];
    if (product.image) images.push(product.image);
    if (product.images && Array.isArray(product.images)) {
      product.images.forEach(img => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && url !== product.image) images.push(url);
      });
    }
    return images;
  }, [product.image, product.images]);

  const variants = product.variants || [];
  const variantPrices = variants.map((v: any) => v.price).filter((p: any) => p > 0);
  const minPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : product.price;

  // Simulated discovery data
  const soldCount = React.useMemo(() => (product.id * 17) % 1000 + 50, [product.id]);

  const prefetchTimerRef = useRef<any>(null);
  const isPrefetched = useRef(false);

  const handleMouseEnter = () => {
    if (isPrefetched.current) return;
    
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        // Prefetch everything needed for ProductDetails page
        await Promise.all([
          fetchProductById(product.id),
          fetchProductReviews(product.id),
          checkProductPurchase(product.id)
        ]);
        isPrefetched.current = true;
        console.log(`Prefetched product: ${product.id}`);
      } catch (e) {
        // Silently fail
      }
    }, 250); // Slightly longer delay for products to avoid excessive prefetching while scrolling
  };

  const handleMouseLeave = () => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  };

  const [airRate, setAirRate] = useState<number>(15400);
  const [seaRate, setSeaRate] = useState<number>(182000);
  const [minFloor, setMinFloor] = useState<number>(5000);

  useEffect(() => {
    const loadRates = async () => {
      try {
        const settings = await fetchSettings();
        if (settings?.airShippingRate) setAirRate(settings.airShippingRate);
        if (settings?.seaShippingRate) setSeaRate(settings.seaShippingRate);
        if (settings?.airShippingMinFloor) setMinFloor(settings.airShippingMinFloor);
      } catch (e) {}
    };
    loadRates();
  }, []);

  const totalPrice = React.useMemo(() => {
    const base = minPrice;
    const shipping = calculateShippingFee(
      product.weight,
      product.length,
      product.width,
      product.height,
      {
        airRate,
        seaRate,
        minFloor
      }
    );

    return base + shipping;
  }, [minPrice, product.weight, product.length, product.width, product.height, airRate, seaRate, minFloor]);

  return (
    <div 
      onClick={() => onNavigate(product.id)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-800 shadow-md transition-all hover:shadow-xl hover:-translate-y-1 cursor-pointer border border-slate-100 dark:border-slate-700/50"
    >
      {/* Image Container */}
      <div className="relative aspect-square w-full overflow-hidden bg-slate-100 dark:bg-slate-700">
        <LazyImage 
          src={displayImages[_currentImageIndex] || product.image} 
          alt={product.name}
          width={250}
          quality={60}
          isThumbnail={true}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
        />
        
        {/* Top Badges */}
        <div className="absolute top-2 right-2 left-2 flex justify-between items-start z-10 pointer-events-none">
          {product.isFeatured && (
            <div className="px-2 py-0.5 rounded-md bg-orange-500 text-[10px] font-black text-white uppercase tracking-wider shadow-sm pointer-events-auto">
              رائج
            </div>
          )}
          <button 
            onClick={(e) => onAddToWishlist(e, product)}
            className={`pointer-events-auto flex size-8 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur-sm transition hover:bg-white hover:scale-110 ${isProductInWishlist(product.id) ? 'text-red-500' : 'text-slate-400'}`}
          >
            <Heart size={18} fill={isProductInWishlist(product.id) ? "currentColor" : "none"} strokeWidth={2.5} />
          </button>
        </div>

        {displayImages.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {displayImages.slice(0, 5).map((_, i) => (
              <div 
                key={i} 
                className={`h-1 rounded-full transition-all ${i === _currentImageIndex ? 'w-4 bg-primary' : 'w-1 bg-white/40'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info Container */}
      <div className="flex flex-col gap-1.5 p-2.5">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-700 dark:text-slate-200 h-[38px]">
          {product.name}
        </h3>
        
        <div className="flex flex-col gap-1 mt-auto">
          {/* Price */}
          <div className="flex items-center gap-1">
            <div className="flex items-baseline gap-1">
              <span className="text-[15px] font-black text-primary">
                {totalPrice.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-primary/70">د.ع</span>
            </div>
          </div>

          {/* Sold & Rating info */}
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500 border-t border-slate-50 dark:border-slate-700/50 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1">
              <span className="text-orange-400 text-[12px]">★</span>
              <span>4.8</span>
            </div>
            <span>تم بيع {soldCount}+</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
