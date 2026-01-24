import React from 'react';
import { ShoppingCart, RefreshCw, Plus, ShoppingBag, Plane, Ship, Flame } from 'lucide-react';

interface AddToCartBarProps {
  price: number;
  onAddToCart: () => void;
  isAdding: boolean;
  isAdded?: boolean;
  onGoToCart?: () => void;
  shippingMethod: 'air' | 'sea';
  onShippingMethodChange: (method: 'air' | 'sea') => void;
  airPrice?: number;
  seaPrice?: number;
}

const AddToCartBar: React.FC<AddToCartBarProps> = ({
  price,
  onAddToCart,
  isAdding,
  isAdded,
  onGoToCart,
  shippingMethod,
  onShippingMethodChange,
  airPrice,
  seaPrice,
}) => {
  const discountPercentage = React.useMemo(() => {
    if (airPrice && seaPrice && airPrice > seaPrice) {
      return Math.round(((airPrice - seaPrice) / airPrice) * 100);
    }
    return 0;
  }, [airPrice, seaPrice]);
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-900/5 dark:border-white/10 px-6 py-4 pb-safe transition-colors shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
      <div className="flex flex-col gap-5">
        {/* Shipping Method Toggle */}
        <div className="relative flex p-1 bg-slate-100 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10">
          {/* Background Slider */}
          <div 
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white dark:bg-slate-800 rounded-xl shadow-md transition-all duration-300 ease-out ${
              shippingMethod === 'sea' ? 'translate-x-[calc(-100%-8px)]' : 'translate-x-0'
            }`}
          />
          
          <button
            onClick={() => onShippingMethodChange('air')}
            className={`relative flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-xs font-black transition-all duration-300 ${
              shippingMethod === 'air'
                ? 'text-primary'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <div className={`p-1.5 rounded-lg transition-colors ${shippingMethod === 'air' ? 'bg-primary/10' : 'bg-transparent'}`}>
              <Plane size={16} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span>شحن جوي</span>
              <span className="text-[9px] opacity-60 font-bold">7-14 يوم</span>
            </div>
          </button>

          <button
            onClick={() => onShippingMethodChange('sea')}
            className={`relative flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-xs font-black transition-all duration-300 ${
              shippingMethod === 'sea'
                ? 'text-primary'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {discountPercentage > 0 && (
              <div className="absolute -top-2 -right-1 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-red-500 to-orange-500 shadow-[0_4px_12px_rgba(239,68,68,0.4)] animate-[bounce_2s_infinite] rotate-3 border border-white dark:border-slate-800">
                <Flame size={10} className="text-white fill-white" />
                <span className="text-white text-[9px] font-black whitespace-nowrap">
                  توفير {discountPercentage}%
                </span>
              </div>
            )}
            <div className={`p-1.5 rounded-lg transition-colors ${shippingMethod === 'sea' ? 'bg-primary/10' : 'bg-transparent'}`}>
              <Ship size={16} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span>شحن بحري</span>
              <span className="text-[9px] opacity-60 font-bold">35-60 يوم</span>
            </div>
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col min-w-[120px]">
            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">السعر الإجمالي</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-primary leading-none tracking-tight">
                {price.toLocaleString()}
              </span>
              <span className="text-[10px] font-black text-primary/70">د.ع</span>
            </div>
          </div>
          
          <div className="flex-1 flex gap-2.5">
            {isAdded && (
              <button 
                onClick={onGoToCart}
                className="flex-1 flex h-14 items-center justify-center rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xl transition-all hover:scale-[1.02] active:scale-95"
              >
                <div className="flex items-center gap-2">
                  <ShoppingBag size={20} strokeWidth={2.5} />
                  <span className="text-sm font-black">السلة</span>
                </div>
              </button>
            )}

            <button 
              onClick={onAddToCart}
              disabled={isAdding}
              className={`flex-[1.8] flex h-14 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/30 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isAdding ? 'animate-pulse' : ''}`}
            >
              {isAdding ? (
                <div className="flex items-center gap-2">
                  <RefreshCw size={20} className="animate-spin" strokeWidth={2.5} />
                  <span className="text-sm font-black">جاري...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  {isAdded ? <Plus size={22} strokeWidth={3} /> : <ShoppingCart size={22} strokeWidth={2.5} />}
                  <span className="text-sm font-black uppercase tracking-wider">
                    {isAdded ? 'إضافة المزيد' : 'أضف للسلة'}
                  </span>
                </div>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddToCartBar;