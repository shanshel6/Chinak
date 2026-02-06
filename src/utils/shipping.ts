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

  if (weightInKg > 0 && weightInKg < 1) {
    return 'air';
  }
  
  if (weightInKg >= 1) {
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

  // Fallback: if no basePriceRMB, and price is already combined, just return it
  // Priority: If price is already combined (e.g. manual IQD price), use it directly
  if (isPriceCombined) {
    // If we have basePriceRMB, ALWAYS prefer recalculating from it to ensure shipping is correct for the selected method
    if (basePriceRMB && basePriceRMB > 0) {
      // Recalculate from basePriceRMB (source of truth)
      const baseIQD = basePriceRMB;
      const domesticFee = domesticShippingFee || 0;
      const weightVal = weight || 0.5;

      if (selectedMethod === 'air') {
        const airRate = _rates?.airRate || 15400;
        const shippingCost = weightVal * airRate;
        // Formula: (Base + Domestic + Shipping) * 1.20
        const airPrice = (baseIQD + domesticFee + shippingCost) * 1.20;
        return Math.ceil(airPrice / 250) * 250;
      } else {
        const l = length || 0;
        const w = width || 0;
        const h = height || 0;
        // Use standard sea calculation
        const volumeCbm = (l * w * h) / 1000000;
        const seaRate = _rates?.seaRate || 182000;
        const calculatedCost = volumeCbm * seaRate;
        const minFloor = _rates?.minFloor || 500;
        const seaShippingCost = calculatedCost < minFloor ? minFloor : calculatedCost;
        
        const seaPrice = (baseIQD + domesticFee + seaShippingCost) * 1.20;
        return Math.ceil(seaPrice / 250) * 250;
      }
    }

    // Existing fallback logic if no basePriceRMB
    if (selectedMethod === defaultMethod) {
      return Math.ceil(basePrice / 250) * 250;
    }

    // Otherwise, we need to adjust the price based on the difference in shipping costs.
    // We calculate the theoretical difference and apply it to the basePrice.
    const airRate = _rates?.airRate || 15400;
    const seaRate = _rates?.seaRate || 182000;
    const minFloor = _rates?.minFloor || 2200;
    
    const weightVal = weight || 0.5;
    const airCost = weightVal * airRate;
    
    const l = length || 0;
    const w = width || 0;
    const h = height || 0;
    const volumeCbm = (l * w * h) / 1000000;
    const seaCostRaw = volumeCbm * seaRate;
    const seaCost = seaCostRaw < minFloor ? minFloor : seaCostRaw;
    
    // Difference with 1.2 markup
    const diff = (airCost - seaCost) * 1.2;
    
    let finalPrice = basePrice;
    
    if (defaultMethod === 'air' && selectedMethod === 'sea') {
      // Base is Air, we want Sea -> Subtract the difference (Air is usually more expensive)
      finalPrice = basePrice - diff;
    } else if (defaultMethod === 'sea' && selectedMethod === 'air') {
      // Base is Sea, we want Air -> Add the difference
      finalPrice = basePrice + diff;
    }
    
    // Safety floor: Ensure price doesn't drop below a reasonable threshold
    if (finalPrice < 1000) return 1000;

    return Math.ceil(finalPrice / 250) * 250;
  }

  // If price is not combined, calculate from components
  // Logic: Base (converted to IQD if needed) + Domestic + Shipping
  
  let baseIQD = basePrice;
  
  // 1. If we have basePriceRMB, it's our source of truth (treated as IQD)
  if (basePriceRMB && basePriceRMB > 0) {
    baseIQD = basePriceRMB;
  }
  // 2. Fallback: if isPriceCombined, return basePrice as is (handled above)
  
  // 3. Legacy check: If base price is small (< 1000) AND we didn't have basePriceRMB,
  // we assume it's IQD (user requested removal of x200/x250 heuristic).
  // We keep the variable assignment but remove the multiplier.
  // This effectively means basePrice IS baseIQD.
  
  const domesticFee = domesticShippingFee || 0;
  const weightVal = weight || 0.5;

  if (selectedMethod === 'air') {
    const airRate = _rates?.airRate || 15400;
    // No minimum floor for air shipping as per user request
    const shippingCost = weightVal * airRate;
    const airPrice = (baseIQD + domesticFee + shippingCost) * 1.20;
    return Math.ceil(airPrice / 250) * 250;
  } else {
    const l = length || 0;
    const w = width || 0;
    const h = height || 0;
    
    const volumeCbm = (l * w * h) / 1000000;
    
    // Calculate sea shipping cost: (volume in CBM * Sea Rate)
    const seaRate = _rates?.seaRate || 182000;
    const calculatedCost = volumeCbm * seaRate;
    
    // If the result is less than minFloor, use minFloor
    const minFloor = _rates?.minFloor || 500;
    const seaShippingCost = calculatedCost < minFloor ? minFloor : calculatedCost;
    
    const seaPrice = (baseIQD + domesticFee + seaShippingCost) * 1.20;
    return Math.ceil(seaPrice / 250) * 250;
  }
};
