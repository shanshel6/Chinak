import React from 'react';
import { Heart, Star, Plus } from 'lucide-react';
import LazyImage from '../LazyImage';

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
}

interface SearchProductCardProps {
  product: Product;
  onNavigate: (id: number) => void;
  onToggleWishlist: (product: Product) => void;
  isWishlisted: boolean;
  onAddToCart: (product: Product) => void;
}

const SearchProductCard: React.FC<SearchProductCardProps> = ({
  product,
  onNavigate,
  onToggleWishlist,
  isWishlisted,
  onAddToCart,
}) => {
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
        {product.price < 50000 && (
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
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-base font-bold text-primary">{product.price.toLocaleString()} د.ع</span>
            <span className="text-[10px] text-slate-400 line-through">{(product.price * 1.2).toLocaleString()} د.ع</span>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onAddToCart(product);
            }}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary text-white shadow-lg shadow-primary/20 active:scale-90 transition-transform"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SearchProductCard;
