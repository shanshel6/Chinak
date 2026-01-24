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
  basePrice: number, // This is either product.price or product.basePriceRMB
  weight: number | undefined,
  length: number | undefined,
  width: number | undefined,
  height: number | undefined,
  _rates: ShippingRates,
  method?: 'air' | 'sea' | 'AIR' | 'SEA',
  domesticShippingFee: number = 0,
  basePriceRMB?: number | null
) => {
  const defaultMethod = getDefaultShippingMethod(weight, length, width, height);
  const selectedMethod = (method || defaultMethod).toLowerCase() as 'air' | 'sea';

  // Determine the "original price" in IQD (before markup)
  let originalPrice = basePrice;
  
  if (basePriceRMB && basePriceRMB > 0) {
    // If basePriceRMB is provided, use it as the source of truth
    originalPrice = basePriceRMB;
  } else {
    // If only the database 'price' is available, reverse the markup to get original price
    // The basePrice from database already has a markup:
    // - 1.9 (90%) if it was imported as AIR
    // - 1.15 (15%) if it was imported as SEA
    if (defaultMethod === 'air') {
      originalPrice = basePrice / 1.9;
    } else {
      originalPrice = basePrice / 1.15;
    }
  }

  // Calculate domestic fee (default to 0 if not provided)
  const domesticFee = domesticShippingFee || 0;

  if (selectedMethod === 'air') {
    // Air Price: (Base Price + 90% Base Price) + Domestic Shipping
    // Air shipping fee itself is 0 as per previous requests
    const airPrice = (originalPrice * 1.9) + domesticFee;
    return Math.ceil(airPrice / 250) * 250;
  } else {
    // Sea Price: (Base Price + 15% Base Price) + Domestic Shipping
    // Note: Cost of sea shipping is calculated and shown separately in the cart
    const seaPrice = (originalPrice * 1.15) + domesticFee;
    return Math.ceil(seaPrice / 250) * 250;
  }
};
