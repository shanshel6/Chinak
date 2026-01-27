import React, { useEffect, useState } from 'react';
import { Video, Info as _Info } from 'lucide-react';
import { fetchSettings } from '../../services/api';
import { calculateInclusivePrice } from '../../utils/shipping';

interface ProductInfoProps {
  price: number;
  originalPrice?: number;
  name: string;
  chineseName?: string;
  videoUrl?: string;
  storeEvaluation?: string;
  reviewsCountShown?: string | number;
  averageRating: string;
  totalReviews: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  domesticShippingFee?: number;
  basePriceRMB?: number;
  isPriceCombined?: boolean;
  airThreshold?: number;
  seaThreshold?: number;
  variant?: any;
  shippingMethod?: 'air' | 'sea';
}

const ProductInfo: React.FC<ProductInfoProps> = ({
  price,
  originalPrice,
  name,
  chineseName,
  videoUrl,
  weight,
  length,
  width,
  height,
  domesticShippingFee,
  basePriceRMB,
  isPriceCombined,
  shippingMethod = 'air'
}) => {
  const [airRate, setAirRate] = useState<number>(15400); 
  const [seaRate, setSeaRate] = useState<number>(182000);
  const [_chinaDomesticRate, setChinaDomesticRate] = useState<number>(1500);
  const [shippingMinFloor, setShippingMinFloor] = useState<number>(2200);
  
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchSettings();
        if (settings?.airShippingRate) setAirRate(settings.airShippingRate);
        if (settings?.seaShippingRate) setSeaRate(settings.seaShippingRate);
        if (settings?.chinaDomesticShipping) setChinaDomesticRate(settings.chinaDomesticShipping);
        if (settings?.shippingMinFloor) setShippingMinFloor(settings.shippingMinFloor);
      } catch (error) {
        console.error('Failed to load shipping rates:', error);
      }
    };
    loadSettings();
  }, []);

  const airPrice = React.useMemo(() => {
    return calculateInclusivePrice(price, weight, length, width, height, {
      airRate,
      seaRate,
      minFloor: shippingMinFloor
    }, 'air', domesticShippingFee || 0, basePriceRMB, isPriceCombined);
  }, [price, weight, length, width, height, airRate, seaRate, shippingMinFloor, domesticShippingFee, basePriceRMB, isPriceCombined]);

  const seaPrice = React.useMemo(() => {
    return calculateInclusivePrice(price, weight, length, width, height, {
      airRate,
      seaRate,
      minFloor: shippingMinFloor
    }, 'sea', domesticShippingFee || 0, basePriceRMB, isPriceCombined);
  }, [price, weight, length, width, height, airRate, seaRate, shippingMinFloor, domesticShippingFee, basePriceRMB, isPriceCombined]);

  const totalPrice = shippingMethod === 'air' ? airPrice : seaPrice;

  const inclusiveOriginalPrice = React.useMemo(() => {
    if (!originalPrice) return null;
    return calculateInclusivePrice(originalPrice, weight, length, width, height, {
      airRate,
      seaRate,
      minFloor: shippingMinFloor
    }, shippingMethod, domesticShippingFee || 0, basePriceRMB, isPriceCombined);
  }, [originalPrice, weight, length, width, height, airRate, seaRate, shippingMinFloor, shippingMethod, domesticShippingFee, basePriceRMB, isPriceCombined]);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col">
          <h1 className="text-primary text-2xl font-black tracking-tight drop-shadow-sm">
            {totalPrice > 0 ? `${totalPrice.toLocaleString()} د.ع` : 'السعر عند الطلب'}
          </h1>
          {inclusiveOriginalPrice && inclusiveOriginalPrice > totalPrice && (
            <span className="text-slate-400 text-sm line-through">
              {inclusiveOriginalPrice.toLocaleString()} د.ع
            </span>
          )}
        </div>
        {videoUrl && (
          <a 
            href={videoUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all hover:scale-105 active:scale-95 border border-red-100 dark:border-red-500/20"
          >
            <Video size={16} />
            <span>مشاهدة الفيديو</span>
          </a>
        )}
      </div>

      <h2 className="text-slate-900 dark:text-white text-xl font-bold leading-tight mt-3">{name}</h2>
      {chineseName && chineseName !== name && (
        <p className="text-slate-400 dark:text-slate-500 text-sm mt-1 font-medium">{chineseName}</p>
      )}
    </div>
  );
};

export default ProductInfo;
