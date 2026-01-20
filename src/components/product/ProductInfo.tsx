import React, { useEffect, useState } from 'react';
import { Video, Store, Star, Plane, Ship, Info as _Info } from 'lucide-react';
import { fetchSettings } from '../../services/api';
import { calculateShippingFee } from '../../utils/shipping';

interface ProductInfoProps {
  price: number;
  originalPrice?: number;
  name: string;
  chineseName?: string;
  videoUrl?: string;
  storeEvaluation?: string;
  reviewsCountShown?: string;
  averageRating?: string;
  totalReviews?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  domesticShippingFee?: number;
  airThreshold?: number;
  seaThreshold?: number;
}

const ProductInfo: React.FC<ProductInfoProps> = ({
  price,
  originalPrice,
  name,
  chineseName,
  videoUrl,
  storeEvaluation,
  reviewsCountShown,
  averageRating,
  totalReviews,
  weight,
  length,
  width,
  height,
  domesticShippingFee: _domesticShippingFee,
  airThreshold = 50000,
  seaThreshold = 50000
}) => {
  const [airRate, setAirRate] = useState<number>(15400); 
  const [seaRate, setSeaRate] = useState<number>(182000);
  const [chinaDomesticRate, setChinaDomesticRate] = useState<number>(1500);
  const [shippingMinFloor, setShippingMinFloor] = useState<number>(5000);
  const [thresholds, setThresholds] = useState({ air: airThreshold, sea: seaThreshold });
  
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchSettings();
        if (settings?.airShippingRate) setAirRate(settings.airShippingRate);
        if (settings?.seaShippingRate) setSeaRate(settings.seaShippingRate);
        if (settings?.chinaDomesticShipping) setChinaDomesticRate(settings.chinaDomesticShipping);
        if (settings?.airShippingMinFloor) setShippingMinFloor(settings.airShippingMinFloor);
        if (settings?.airShippingThreshold || settings?.seaShippingThreshold) {
          setThresholds({
            air: settings.airShippingThreshold || airThreshold,
            sea: settings.seaShippingThreshold || seaThreshold
          });
        }
      } catch (error) {
        console.error('Failed to load shipping rates:', error);
      }
    };
    loadSettings();
  }, [airThreshold, seaThreshold]);

  const shippingFees = React.useMemo(() => {
    if (!weight && !length && !width && !height) return null;
    
    const fee = calculateShippingFee(weight, length, width, height, {
      airRate,
      seaRate,
      chinaDomesticRate,
      minFloor: shippingMinFloor
    }, price, 'SEA', 0, false); // Domestic fee is now included in price, applyMinimum is false for display

    const activeMethod = 'SEA';
    const threshold = thresholds.sea;
    const isThresholdMet = price >= threshold;

    return { 
      total: fee,
      activeMethod,
      threshold,
      isThresholdMet
    };
  }, [weight, length, width, height, airRate, seaRate, chinaDomesticRate, shippingMinFloor, price, thresholds]);

  // Always default to SEA if no automatic selection
  const activeMethod = shippingFees?.activeMethod || 'SEA';
  
  const totalPrice = React.useMemo(() => {
    return price;
  }, [price]);

  const parsedEvaluation = React.useMemo(() => {
    if (!storeEvaluation) return null;
    try {
      if (typeof storeEvaluation === 'string' && storeEvaluation.trim().startsWith('{')) {
        return JSON.parse(storeEvaluation);
      }
      if (typeof storeEvaluation === 'object') return storeEvaluation;
      return null;
    } catch (e) {
      return null;
    }
  }, [storeEvaluation]);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col">
          <h1 className="text-primary text-2xl font-black tracking-tight drop-shadow-sm">
            {totalPrice > 0 ? `${totalPrice.toLocaleString()} د.ع` : 'السعر عند الطلب'}
          </h1>
          {originalPrice && originalPrice > price && (
            <span className="text-slate-400 text-sm line-through">
              {(originalPrice + (totalPrice - price)).toLocaleString()} د.ع
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

      {/* Store Evaluation & Review Count Badge */}
      {(parsedEvaluation || averageRating || totalReviews || reviewsCountShown) && (
        <div className="flex flex-wrap gap-2 mt-2">
          {parsedEvaluation && (
            <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-lg text-[10px] font-bold border border-blue-100 dark:border-blue-500/20">
              <Store size={14} />
              <span>{parsedEvaluation.shopName || 'تقييم المتجر'}</span>
              {parsedEvaluation.score && <span className="ml-0.5">{parsedEvaluation.score}</span>}
            </div>
          )}
          
          {(averageRating !== '0.0' || totalReviews! > 0 || reviewsCountShown) && (
            <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg text-[10px] font-bold border border-amber-100 dark:border-amber-500/20">
              <Star size={14} fill="currentColor" />
              <span>{averageRating && averageRating !== '0.0' ? averageRating : '5.0'}</span>
              <span className="mx-1 opacity-40">|</span>
              <span>{totalReviews! > 0 ? totalReviews : (reviewsCountShown || '0')} تقييم</span>
            </div>
          )}
        </div>
      )}

      <h2 className="text-slate-900 dark:text-white text-xl font-bold leading-tight mt-3">{name}</h2>
      {chineseName && chineseName !== name && (
        <p className="text-slate-400 dark:text-slate-500 text-sm mt-1 font-medium">{chineseName}</p>
      )}

      {/* Shipping Details */}
      {shippingFees && (
        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                {activeMethod === 'AIR' ? <Plane size={14} /> : <Ship size={14} />}
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                شحن {activeMethod === 'AIR' ? 'جوي' : 'بحري'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {shippingFees.total === 0 ? (
                <span className="text-[10px] font-black text-green-600 bg-green-500/10 px-2 py-0.5 rounded-lg uppercase tracking-wider">مجاني</span>
              ) : (
                <span className="text-xs font-black text-primary">+{shippingFees.total.toLocaleString()} د.ع</span>
              )}
            </div>
          </div>

          {/* Threshold notice removed as per request */}
        </div>
      )}
    </div>
  );
};

export default ProductInfo;
