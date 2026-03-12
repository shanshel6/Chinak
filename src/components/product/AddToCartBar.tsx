import React from 'react';
import { ShoppingCart, RefreshCw, ShoppingBag } from 'lucide-react';

interface AddToCartBarProps {
  price: number;
  productId: string | number;
  onAddToCart: () => void;
  isAdding: boolean;
  isAdded?: boolean;
  onGoToCart?: () => void;
  isActive?: boolean;
}

const AddToCartBar: React.FC<AddToCartBarProps> = ({
  price,
  productId,
  onAddToCart,
  isAdding,
  isAdded,
  onGoToCart,
  isActive = true,
}) => {
  const handleWhatsAppClick = () => {
    const message = encodeURIComponent(`مرحباً، أود الاستفسار عن هذا المنتج: ${productId}`);
    window.open(`https://wa.me/13223001309?text=${message}`, '_blank');
  };

  if (!isActive) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-800/60 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] transition-all">
        <div className="flex items-center gap-4 h-[64px]">
          {/* WhatsApp Button */}
          <button
            onClick={handleWhatsAppClick}
            className="relative w-[28%] h-full flex flex-col items-center justify-center gap-1 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-2xl shadow-lg shadow-green-500/20 transition-all duration-300 active:scale-[0.95] overflow-hidden group border border-white/10"
            title="Ask about this product"
          >
             <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <span className="text-[10px] font-bold leading-none">استفسار</span>
          </button>

          {/* Sold Out Button */}
          <button
            disabled
            className="relative w-[72%] h-full flex items-center justify-center px-6 bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-2xl font-black shadow-none cursor-not-allowed border border-slate-200 dark:border-slate-600"
          >
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xl font-black">نفدت الكمية</span>
              <span className="text-xs font-medium opacity-80">المنتج غير متوفر حالياً</span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-800/60 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] transition-all">
      <div className="flex items-center gap-4 h-[64px]">
        {/* WhatsApp Button */}
        <button
          onClick={handleWhatsAppClick}
          className="relative w-[28%] h-full flex flex-col items-center justify-center gap-1 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-2xl shadow-lg shadow-green-500/20 transition-all duration-300 active:scale-[0.95] overflow-hidden group border border-white/10"
          title="Ask about this product"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <span className="text-[10px] font-bold leading-none">استفسار</span>
        </button>

        {/* Add to Cart Button */}
        {isAdded && onGoToCart ? (
          <button
            onClick={onGoToCart}
            className="relative w-[72%] h-full flex items-center justify-between px-6 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-500/25 transition-all duration-300 active:scale-[0.98] overflow-hidden group border border-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/0 via-white/10 to-emerald-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-medium opacity-90">تمت الإضافة</span>
              <span className="text-xl font-black">إتمام الشراء</span>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm shadow-inner">
              <ShoppingBag size={24} strokeWidth={2.5} />
            </div>
          </button>
        ) : (
          <button
            onClick={onAddToCart}
            disabled={isAdding}
            className="relative w-[72%] h-full flex items-center justify-between px-2 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black shadow-lg shadow-primary/25 transition-all duration-300 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden group border border-white/10"
          >
            {isAdding ? (
              <div className="w-full flex items-center justify-center gap-3">
                <RefreshCw size={24} className="animate-spin" />
                <span className="text-lg font-bold">جاري الإضافة...</span>
              </div>
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                {/* Price Tag */}
                <div className="flex flex-col items-start pl-4 justify-center h-full">
                  <span className="text-[10px] font-bold opacity-70 mb-0.5">السعر الإجمالي</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black tracking-tight leading-none">{price.toLocaleString()}</span>
                    <span className="text-xs font-bold opacity-80">د.ع</span>
                  </div>
                </div>

                {/* Icon & Action Text */}
                <div className="flex items-center gap-3 pr-4 pl-3 h-[50px]">
                  <span className="text-base font-bold">إضافة</span>
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <ShoppingCart size={18} strokeWidth={3} />
                  </div>
                </div>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default AddToCartBar;
