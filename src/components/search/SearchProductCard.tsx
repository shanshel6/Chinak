import React, { useState, useEffect } from 'react';
import { Heart, Star } from 'lucide-react';
import LazyImage from '../LazyImage';
import { calculateInclusivePrice } from '../../utils/shipping';
import { fetchSettings } from '../../services/api';

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
}

interface SearchProductCardProps {
  product: Product;
  onNavigate: (id: number) => void;
  onToggleWishlist: (product: Product) => void;
  isWishlisted: boolean;
}

const SearchProductCard: React.FC<SearchProductCardProps> = ({
  product,
  onNavigate,
  onToggleWishlist,
  isWishlisted,
}) => {
  const [rates, setRates] = useState<any>({
    airRate: 15400,
    seaRate: 182000,
    minFloor: 0
  });

  useEffect(() => {
    const loadRates = async () => {
      try {
        const settings = await fetchSettings();
        if (settings) {
          setRates({
            airRate: settings.airShippingRate || 15400,
            seaRate: settings.seaShippingRate || 182000,
            minFloor: 0
          });
        }
      } catch (error) {}
    };
    loadRates();
  }, []);

  const totalPrice = React.useMemo(() => {
    return calculateInclusivePrice(
      product.price,
      product.weight,
      product.length,
      product.width,
      product.height,
      rates
    );
  }, [product, rates]);

  return (
    <div 
      onClick={() => onNavigate(product.id)}
      className="group bg-surface-light dark:bg-surface-dark rounded-xl overflow-hidden border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="aspect-square relative overflow-hidden bg-slate-100 dark:bg-slate-700">
        <LazyImage 
          src={product.image} 
          alt={product.name}
          className="w-full h-full object-cover"
        />
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onToggleWishlist(product);
          }}
          className={`absolute top-2 left-2 w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            isWishlisted 
              ? 'bg-red-50 dark:bg-red-900/30 text-red-500' 
              : 'bg-white/80 dark:bg-slate-900/80 text-slate-400'
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
        <div className="flex items-center gap-1 mb-2">
          <Star size={14} className="text-yellow-400 fill-yellow-400" />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 pt-0.5">4.8</span>
          <span className="text-[10px] text-slate-400 pt-0.5">(128)</span>
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
};

export default SearchProductCard;
