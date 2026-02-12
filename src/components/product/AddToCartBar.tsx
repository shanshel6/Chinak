import React from 'react';
import { ShoppingCart, RefreshCw, Plus, ShoppingBag, Plane, Ship, Flame, AlertCircle } from 'lucide-react';

interface AddToCartBarProps {
  price: number;
  onAddToCart: () => void;
  isAdding: boolean;
  isAdded?: boolean;
  onGoToCart?: () => void;
}

const AddToCartBar: React.FC<AddToCartBarProps> = ({
  price,
  onAddToCart,
  isAdding,
  isAdded,
  onGoToCart,
}) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-900/5 dark:border-white/10 px-6 py-4 pb-safe transition-colors shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-4">
        {/* Price Display */}
        <div className="flex flex-col">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">الإجمالي</span>
          <span className="text-xl font-black text-primary">
            {price > 0 ? `${price.toLocaleString()} د.ع` : 'السعر عند الطلب'}
          </span>
        </div>

        {/* Add to Cart Button */}
        {isAdded && onGoToCart ? (
          <button
            onClick={onGoToCart}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 px-6 rounded-xl font-black shadow-lg shadow-emerald-500/20 transition-all duration-300 active:scale-[0.98]"
          >
            <ShoppingBag size={20} strokeWidth={2.5} />
            <span>إتمام الشراء</span>
          </button>
        ) : (
          <button
            onClick={onAddToCart}
            disabled={isAdding}
            className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white py-3.5 px-6 rounded-xl font-black shadow-lg shadow-primary/25 transition-all duration-300 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isAdding ? (
              <>
                <RefreshCw size={20} className="animate-spin" />
                <span>جاري الإضافة...</span>
              </>
            ) : (
              <>
                <ShoppingCart size={20} strokeWidth={2.5} />
                <span>إضافة للسلة</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default AddToCartBar;
