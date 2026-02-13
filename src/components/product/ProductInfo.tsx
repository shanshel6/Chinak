import React, { useEffect, useState } from 'react';
import { Info, Plane, Ship } from 'lucide-react';
import { calculateInclusivePrice } from '../../utils/shipping';

interface ProductInfoProps {
  price: number;
  originalPrice?: number;
  name: string;
  deliveryTime?: string;
  averageRating: string | number;
  totalReviews: number;
  domesticShippingFee?: number;
  basePriceIQD?: number;
  calculatedAirPrice?: number;
  calculatedSeaPrice?: number;
  shippingMethod?: 'air' | 'sea';
  onShippingMethodChange?: (method: 'air' | 'sea') => void;
  isAirRestricted?: boolean;
}

const ProductInfo: React.FC<ProductInfoProps> = ({
  price,
  originalPrice,
  name,
  deliveryTime,
  domesticShippingFee,
  basePriceIQD,
  calculatedAirPrice,
  calculatedSeaPrice,
  shippingMethod,
  onShippingMethodChange,
  isAirRestricted,
}) => {
  const totalPrice = React.useMemo(() => {
    // If explicit calculated prices are passed, use them based on method
    if (shippingMethod === 'air' && calculatedAirPrice) return calculatedAirPrice;
    if (shippingMethod === 'sea' && calculatedSeaPrice) return calculatedSeaPrice;
    
    // Otherwise fallback to default calculation (usually air)
    return calculateInclusivePrice(price, domesticShippingFee || 0, basePriceIQD);
  }, [price, domesticShippingFee, basePriceIQD, calculatedAirPrice, calculatedSeaPrice, shippingMethod]);

  const inclusiveOriginalPrice = React.useMemo(() => {
    if (!originalPrice) return null;
    return calculateInclusivePrice(originalPrice, domesticShippingFee || 0, basePriceIQD);
  }, [originalPrice, domesticShippingFee, basePriceIQD]);

  return (
    <div className="mb-6">
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <h1 className="text-primary text-3xl font-black tracking-tight drop-shadow-sm">
              {totalPrice > 0 ? `${totalPrice.toLocaleString()} د.ع` : 'السعر عند الطلب'}
            </h1>
            {inclusiveOriginalPrice && inclusiveOriginalPrice > totalPrice && (
              <span className="text-slate-400 text-sm line-through font-bold mt-1">
                {inclusiveOriginalPrice.toLocaleString()} د.ع
              </span>
            )}
          </div>
        </div>

        {/* Shipping Method Toggles - Enhanced UI */}
        {onShippingMethodChange && (
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700/50 w-full sm:w-fit">
            <button
              onClick={() => onShippingMethodChange('air')}
              disabled={isAirRestricted}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all duration-300 ${
                shippingMethod === 'air'
                  ? 'bg-white dark:bg-slate-700 text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10 scale-[1.02]'
                  : isAirRestricted 
                    ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50 bg-slate-50 dark:bg-slate-800/50' 
                    : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
              }`}
            >
              <Plane size={18} className={shippingMethod === 'air' ? 'text-primary' : (isAirRestricted ? 'text-slate-300' : 'text-slate-400')} />
              <div className="flex flex-col items-center leading-none gap-0.5">
                <span>شحن جوي</span>
                {isAirRestricted && <span className="text-[10px] font-medium">غير متوفر</span>}
              </div>
            </button>
            <button
              onClick={() => onShippingMethodChange('sea')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all duration-300 ${
                shippingMethod === 'sea'
                  ? 'bg-white dark:bg-slate-700 text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10 scale-[1.02]'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
              }`}
            >
              <Ship size={18} className={shippingMethod === 'sea' ? 'text-primary' : 'text-slate-400'} />
              شحن بحري
            </button>
          </div>
        )}
      </div>

      <h2 className="text-slate-900 dark:text-white text-xl font-bold leading-tight mt-3">{name}</h2>

      {deliveryTime && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-100 dark:border-slate-700">
            وقت تجهيز البضاعة: {deliveryTime} يوم
          </span>
        </div>
      )}

      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
           <p className="text-sm text-blue-700 dark:text-blue-300 font-medium flex items-center gap-2">
             <Info size={16} />
             سيتم احتساب رسوم التوصيل وإرسالها إليك عبر الواتساب بعد إتمام الطلب
           </p>
      </div>
    </div>
  );
};

export default ProductInfo;
