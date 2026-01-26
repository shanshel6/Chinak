import type { ShippingRates } from '../types/shipping';

export const calculateShippingFee = (
  _weight: number | undefined,
  _length: number | undefined,
  _width: number | undefined,
  _height: number | undefined,
  _rates: ShippingRates,
  _price: number = 0,
  _forcedMethod?: 'AIR' | 'SEA' | 'air' | 'sea',
  _domesticShippingFee: number = 0,
  _applyMinimum: boolean = true,
  _variant?: { weight?: number | null; length?: number | null; width?: number | null; height?: number | null }
) => {
  // International shipping fee is now free for all methods as per request
  return 0;
};

export const getDefaultShippingMethod = (weight?: number, _length?: number, _width?: number, _height?: number): 'air' | 'sea' => {
  // weight in database is already in kg
  const weightInKg = weight || 0.5;

  if (weightInKg > 0 && weightInKg < 2) {
    return 'air';
  }
  
  if (weightInKg >= 2) {
    return 'sea';
  }

  return 'air'; // Default to air for small/unknown items
};

export const calculateInclusivePrice = (
  basePrice: number, // This is product.price (already marked up in DB)
  weight: number | undefined,
  length: number | undefined,
  width: number | undefined,
  height: number | undefined,
  _rates: ShippingRates,
  method?: 'air' | 'sea' | 'AIR' | 'SEA',
  domesticShippingFee: number = 0,
  basePriceRMB?: number | null,
  isPriceCombined?: boolean
) => {
  const defaultMethod = getDefaultShippingMethod(weight, length, width, height);
  const selectedMethod = (method || defaultMethod).toLowerCase() as 'air' | 'sea';

  // If we have the original RMB price, it's our absolute source of truth
  if (basePriceRMB && basePriceRMB > 0) {
    const originalPrice = basePriceRMB;
    const domesticFee = domesticShippingFee || 0;
    const weightVal = weight || 0.5;

    if (selectedMethod === 'air') {
      const airRate = _rates?.airRate || 15400;
      const shippingCost = weightVal * airRate;
      const airPrice = (originalPrice + domesticFee + shippingCost) * 1.20;
      return Math.ceil(airPrice / 250) * 250;
    } else {
      const seaRate = _rates?.seaRate || 182000;
      const l = length || 0;
      const w = width || 0;
      const h = height || 0;
      
      const volumeCbm = (l * w * h) / 1000000;
      const seaShippingCost = Math.max(volumeCbm * seaRate, 1000);
      
      const seaPrice = (originalPrice + domesticFee + seaShippingCost) * 1.20;
      return Math.ceil(seaPrice / 250) * 250;
    }
  }

  // Fallback: if no basePriceRMB, and price is already combined, just return it
  if (isPriceCombined) {
    return Math.ceil(basePrice / 250) * 250;
  }

  // Last resort fallback (avoiding the 1.9 markup which is confusing)
  // If we're here, we just return the basePrice rounded
  return Math.ceil(basePrice / 250) * 250;
};
