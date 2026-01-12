import React from 'react';
import { ShoppingCart, RefreshCw, Plus, ShoppingBag } from 'lucide-react';

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
    <div className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-md bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-t border-slate-900/5 dark:border-white/10 px-6 py-4 pb-6 transition-colors shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col min-w-[100px]">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">السعر الإجمالي</span>
          <span className="text-xl font-black text-primary leading-none">
            {price.toLocaleString()} <span className="text-xs font-bold opacity-80">د.ع</span>
          </span>
        </div>
        
        <div className="flex-1 flex gap-2">
          {isAdded && (
            <button 
              onClick={onGoToCart}
              className="flex-1 flex h-14 items-center justify-center rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xl transition-all active:scale-95"
            >
              <div className="flex items-center gap-2">
                <ShoppingBag size={20} />
                <span className="text-sm font-bold">السلة</span>
              </div>
            </button>
          )}

          <button 
            onClick={onAddToCart}
            disabled={isAdding}
            className={`flex-[1.5] flex h-14 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/25 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isAdding ? 'animate-pulse' : ''}`}
          >
            {isAdding ? (
              <div className="flex items-center gap-2">
                <RefreshCw size={20} className="animate-spin" />
                <span className="text-sm font-bold">جاري...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {isAdded ? <Plus size={20} /> : <ShoppingCart size={20} />}
                <span className="text-sm font-bold uppercase tracking-wide">
                  {isAdded ? 'إضافة المزيد' : 'أضف للسلة'}
                </span>
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddToCartBar;