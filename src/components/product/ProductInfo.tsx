import React from 'react';
import { calculateInclusivePrice } from '../../utils/shipping';
import { fixMojibake } from '../../utils/mojibakeFixer';

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
  shippingMethod?: 'air' | 'sea' | null;
  onShippingMethodChange?: (method: 'air' | 'sea') => void;
  isAirRestricted?: boolean;
  neworold?: boolean | null;
}

const ProductInfo: React.FC<ProductInfoProps> = ({
  price,
  originalPrice,
  name,
  domesticShippingFee,
  basePriceIQD,
  calculatedAirPrice,
  calculatedSeaPrice,
  shippingMethod,
  deliveryTime,
  neworold,
  // onShippingMethodChange, // Unused for now
  // isAirRestricted, // Unused for now
}) => {
  // @ts-ignore
  const totalPrice = React.useMemo(() => {
    // If shipping method is explicitly null, we might want to show a "Select Shipping" state or a range?
    // For now, let's show the sea price (usually cheaper) as a base, or 0 if user must select.
    if (shippingMethod === 'air' && calculatedAirPrice) return calculatedAirPrice;
    if (shippingMethod === 'sea' && calculatedSeaPrice) return calculatedSeaPrice;
    
    // If no method selected, show the lower price (Sea) as a preview
    return calculatedSeaPrice || calculateInclusivePrice(price, domesticShippingFee || 0, basePriceIQD);
  }, [price, domesticShippingFee, basePriceIQD, calculatedAirPrice, calculatedSeaPrice, shippingMethod]);

  // @ts-ignore
  const inclusiveOriginalPrice = React.useMemo(() => {
    if (!originalPrice) return null;
    return calculateInclusivePrice(originalPrice, domesticShippingFee || 0, basePriceIQD);
  }, [originalPrice, domesticShippingFee, basePriceIQD]);

  return (
    <div className="mb-6">
      {/* Price section removed as requested */}
      
      {/* New/Used Tag */}
      {neworold !== null && neworold !== undefined && (
        <div className="mb-2">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold ${
            neworold 
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' 
              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
          }`}>
            {neworold ? 'جديد' : 'مستعمل'}
          </span>
        </div>
      )}

      <h2 className="text-slate-900 dark:text-white text-xl font-bold leading-tight mt-1">{fixMojibake(name)}</h2>


      {deliveryTime && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-100 dark:border-slate-700">
            وقت تجهيز البضاعة: {fixMojibake(deliveryTime)} يوم
          </span>
        </div>
      )}
    </div>
  );
};

export default ProductInfo;
