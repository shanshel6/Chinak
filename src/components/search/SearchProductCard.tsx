import React, { useState } from 'react';
import { Heart, Star } from 'lucide-react';
import LazyImage from '../LazyImage';
import type { Product } from '../../types/product';

interface SearchProductCardProps {
  product: Product;
  onNavigate: (id: number | string) => void;
  onToggleWishlist: (product: Product) => void;
  isWishlisted: boolean;
}

const SearchProductCard: React.FC<SearchProductCardProps> = React.memo(({
  product,
  onNavigate,
  onToggleWishlist,
  isWishlisted,
}) => {
  // Use default rates to avoid per-card API calls.
  // If dynamic rates are needed, they should be passed as props from the parent.
  const [rates] = useState<any>({
    airRate: 15400,
    seaRate: 182000,
    minFloor: 0
  });

  /* 
    Removed redundant fetchSettings useEffect that caused N+1 API calls.
    The rates state is kept minimal as it was used in dependency arrays, 
    but actual calculation logic was using local variables.
  */

  const totalPrice = React.useMemo(() => {
    const variants = (product as any).variants || [];
    
    // Find the cheapest variant to get the correct price AND weight
    const minVariant = variants.reduce((min: any, curr: any) => {
      if (!curr.price) return min;
      if (!min) return curr;
      return curr.price < min.price ? curr : min;
    }, null);

    const minPrice = minVariant ? minVariant.price : product.price;
    // const effectiveWeight = (minVariant && minVariant.weight) ? minVariant.weight : product.weight;
    // const effectiveLength = (minVariant && minVariant.length) ? minVariant.length : product.length;
    // const effectiveWidth = (minVariant && minVariant.width) ? minVariant.width : product.width;
    // const effectiveHeight = (minVariant && minVariant.height) ? minVariant.height : product.height;

    return minPrice;
  }, [product, rates]);

  const displayImages = React.useMemo(() => {
    // START WITH MAIN IMAGE (product.image) - This is critical for consistency with search/home
    const images = [];
    if (product.image) images.push(product.image);
    
    // Add gallery images (excluding duplicates of main image)
    if ((product as any).images && Array.isArray((product as any).images)) {
      (product as any).images.forEach((img: any) => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && url !== product.image) images.push(url);
      });
    }
    return images;
  }, [product.image, (product as any).images]);

  return (
    <div 
      onClick={() => onNavigate(product.id)}
      className="group relative flex flex-col overflow-hidden rounded-[20px] bg-white dark:bg-slate-800 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07)] hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.1)] cursor-pointer ring-1 ring-slate-100 dark:ring-slate-700/50 transition-all duration-300 hover:-translate-y-1"
    >
      <div className="aspect-[4/5] relative overflow-hidden bg-slate-50 dark:bg-slate-700/50">
        <LazyImage 
          src={displayImages[0] || product.image} 
          alt={product.name}
          width={300}
          quality={80}
          isThumbnail={true}
          objectFit="contain"
          className="w-full h-full bg-white transition-transform duration-700 group-hover:scale-110"
        />
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onToggleWishlist(product);
          }}
          className={`absolute top-2 left-2 w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-300 shadow-sm hover:scale-110 active:scale-90 ${
            isWishlisted 
              ? 'bg-red-50 dark:bg-red-900/30 text-red-500' 
              : 'bg-white/70 dark:bg-black/30 text-slate-700 hover:bg-white dark:text-white'
          }`}
        >
          <Heart 
            size={18} 
            fill={isWishlisted ? "currentColor" : "none"} 
          />
        </button>
        {totalPrice < 30000 && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-red-500 text-white text-[10px] font-bold">
            وفر 20%
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight mb-2 line-clamp-2 min-h-[2.5em]">
          {product.name}
        </h3>
        <div className="flex flex-wrap gap-1 mb-2 min-h-[1.5em]">
          {/* Condition Tag */}
          {product.neworold !== null && product.neworold !== undefined && (
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              product.neworold 
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' 
                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
            }`}>
              {product.neworold ? 'جديد' : 'مستعمل'}
            </div>
          )}

          {/* Brand Tag */}
          {product.aiMetadata?.isRealBrand !== null && product.aiMetadata?.isRealBrand !== undefined && (
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              product.aiMetadata.isRealBrand 
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' 
                : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
            }`}>
              {product.aiMetadata.isRealBrand ? 'أصلي' : 'تقليد'}
            </div>
          )}
        </div>
        <div className="flex items-center">
          <div className="flex flex-col">
            <span className="text-base font-bold text-primary">{totalPrice.toLocaleString()} د.ع</span>
            <span className="text-[10px] text-slate-400 line-through">{(totalPrice * 1.2).toLocaleString()} د.ع</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default SearchProductCard;
