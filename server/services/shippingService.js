
import prisma from '../prismaClient.js';

// Packaging Constants
const BOX_PADDING_CM = 5; // Increased to 5cm for "safe side" guessing
const WEIGHT_BUFFER_FACTOR = 1.25; // Increased to 25% for "safe side" guessing

/**
 * Helper to get adjusted price based on shipping method.
 * Reverses the 90% air markup or 15% sea markup from the DB price
 * and applies the new markup based on the selected method.
 */
export function getAdjustedPrice(basePrice, weight, length, width, height, selectedMethod, domesticShippingFee, basePriceRMB, isPriceCombined, rates) {
  const weightInKg = (weight || 0.5);
  const method = (selectedMethod || (weightInKg > 0 && weightInKg < 1 ? 'AIR' : 'SEA')).toUpperCase();
  const airRate = (rates?.airShippingRate ?? rates?.airRate ?? 15400);
  const seaRate = (rates?.seaShippingRate ?? rates?.seaRate ?? 182000);
  
  // 1. If we have basePriceRMB, it's our source of truth
  if (basePriceRMB && basePriceRMB > 0) {
    const originalPrice = basePriceRMB;
    const domesticFee = domesticShippingFee || 0;
    
    if (method === 'AIR') {
      const shippingCost = weightInKg * airRate;
      
      // Treat rawPrice as IQD (no heuristic conversion)
      const basePrice = originalPrice;
      
      const airPrice = (basePrice + domesticFee + shippingCost) * 1.20;
      return Math.ceil(airPrice / 250) * 250;
    } else {
      const l = length || 0;
      const w = width || 0;
      const h = height || 0;
      const volumeCbm = (l * w * h) / 1000000;
      
      const seaShippingCost = Math.max(volumeCbm * seaRate, 500);

      // Treat rawPrice as IQD (no heuristic conversion)
      const basePrice = originalPrice;

      const seaPrice = (basePrice + domesticFee + seaShippingCost) * 1.20;
      return Math.ceil(seaPrice / 250) * 250;
    }
  }

  // 2. Fallback: if isPriceCombined, return basePrice as is
  if (isPriceCombined) {
    // Check if we can recalculate from basePriceRMB
    if (basePriceRMB && basePriceRMB > 0) {
      const originalPrice = basePriceRMB;
      const domesticFee = domesticShippingFee || 0;
      
      if (method === 'AIR') {
        const shippingCost = weightInKg * airRate;
        const airPrice = (originalPrice + domesticFee + shippingCost) * 1.20;
        return Math.ceil(airPrice / 250) * 250;
      } else {
        const l = length || 0;
        const w = width || 0;
        const h = height || 0;
        const volumeCbm = (l * w * h) / 1000000;
        const seaShippingCost = Math.max(volumeCbm * seaRate, 500);
        const seaPrice = (originalPrice + domesticFee + seaShippingCost) * 1.20;
        return Math.ceil(seaPrice / 250) * 250;
      }
    }

    return Math.ceil(basePrice / 250) * 250;
  }

  // 3. Final fallback
  return Math.ceil(basePrice / 250) * 250;
}

/**
 * Calculate international shipping fee based on store settings and product dimensions.
 * @param {Array} items - Array of order items with product data
 * @param {string} method - 'AIR' or 'SEA'
 * @returns {number} - Calculated shipping fee in IQD
 */
export async function calculateOrderShipping(items, defaultMethod = 'SEA') {
  try {
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    
    const airRate = settings?.airShippingRate || 15400;
    const seaRate = settings?.seaShippingRate || 182000;
    
    let totalActualShipping = 0;
    let totalSubtotal = 0;
    let totalChinaDomestic = 0;
    let isAirAvailable = true;
    const itemsMissingWeight = [];

    // Calculate Subtotal and Actual Shipping Cost
    for (const item of items) {
      const product = item.product;
      const variant = item.variant;
      const qty = item.quantity || 1;
      const method = (item.shippingMethod || defaultMethod || 'SEA').toUpperCase();
      
      // Use variant dimensions/weight if available, otherwise fallback to product
      const currentWeight = (variant && variant.weight !== null && variant.weight !== undefined) ? variant.weight : product.weight;
      const currentLength = (variant && variant.length !== null && variant.length !== undefined) ? variant.length : product.length;
      const currentWidth = (variant && variant.width !== null && variant.width !== undefined) ? variant.width : product.width;
      const currentHeight = (variant && variant.height !== null && variant.height !== undefined) ? variant.height : product.height;

      if (method === 'AIR') {
        // Air is always available now with estimation
        isAirAvailable = true;
      }

      const dbPrice = item.variant?.price || item.product?.price || 0;
      const adjustedBasePrice = getAdjustedPrice(
        dbPrice, 
        currentWeight, 
        currentLength, 
        currentWidth, 
        currentHeight, 
        method,
        product.domesticShippingFee || 0,
        product.basePriceRMB,
        product.isPriceCombined,
        {
          airShippingRate: airRate,
          seaShippingRate: seaRate,
          airShippingMinFloor: settings?.airShippingMinFloor || 0
        }
      );
      
      totalSubtotal += adjustedBasePrice * qty;

      // Domestic shipping fee is now included in the product price
      totalChinaDomestic = 0;

      // Apply Packaging Padding & Buffer
      const rawW = currentWeight || 0.5; // Estimated weight on the safe side
      const rawL = currentLength || 0;
      const rawWi = currentWidth || 0;
      const rawH = currentHeight || 0;

      // Boxed Dimensions
      const boxedL = rawL > 0 ? rawL + BOX_PADDING_CM : 0;
      const boxedWi = rawWi > 0 ? rawWi + BOX_PADDING_CM : 0;
      const boxedH = rawH > 0 ? rawH + BOX_PADDING_CM : 0;
      const boxedW = rawW * WEIGHT_BUFFER_FACTOR;

      let itemShipping = 0;
      // International shipping is now free for all methods as per request
      itemShipping = 0;

      // Round per item to match home page logic (250 IQD rounding)
      const roundedItemShipping = Math.ceil(itemShipping / 250) * 250;
      totalActualShipping += roundedItemShipping * qty;
    }

    // New logic: Threshold from settings (defaults to 30,000 for air, 80,000 for sea)
    const airMinOrder = settings?.airShippingThreshold || 30000;
    const seaMinOrder = settings?.seaShippingThreshold || 80000;
    const isSea = items.some(i => (i.shippingMethod || defaultMethod || 'SEA').toUpperCase() === 'SEA');
    const threshold = isSea ? seaMinOrder : airMinOrder;
    const isThresholdMet = totalSubtotal >= threshold;
    
    // International shipping is now free for all methods as per request
    let finalShippingFee = 0;
    
    return {
      fee: finalShippingFee + totalChinaDomestic, // Total fee including domestic
      actualCost: totalActualShipping,
      chinaDomesticFee: totalChinaDomestic,
      internationalFee: finalShippingFee,
      contribution: 0,
      isThresholdMet,
      isAvailable: isAirAvailable,
      itemsMissingWeight,
      threshold,
      subtotal: totalSubtotal
    };
  } catch (error) {
    console.error('Shipping calculation failed:', error);
    return { 
      fee: 0, 
      actualCost: 0,
      chinaDomesticFee: 0,
      internationalFee: 0,
      contribution: 0,
      isThresholdMet: true, // Don't block order if calculation fails
      isAvailable: true,
      itemsMissingWeight: [],
      threshold: 0,
      subtotal: 0
    };
  }
}

/**
 * Calculate shipping for a single product.
 * Automatically chooses between AIR and SEA based on weight.
 */
export async function calculateProductShipping(product, method = 'SEA', applyMinimum = true, variant = null) {
  try {
    const safeMethod = (method || 'SEA').toUpperCase();
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const seaRate = settings?.seaShippingRate || 182000;

    // Use variant dimensions/weight if available, otherwise fallback to product
    const currentWeight = (variant && variant.weight !== null && variant.weight !== undefined) ? variant.weight : product.weight;
    const currentLength = (variant && variant.length !== null && variant.length !== undefined) ? variant.length : product.length;
    const currentWidth = (variant && variant.width !== null && variant.width !== undefined) ? variant.width : product.width;
    const currentHeight = (variant && variant.height !== null && variant.height !== undefined) ? variant.height : product.height;

    // Apply Packaging Padding & Buffer
    const rawL = currentLength || 0;
    const rawWi = currentWidth || 0;
    const rawH = currentHeight || 0;

    // Boxed Dimensions
    const boxedL = rawL > 0 ? rawL + BOX_PADDING_CM : 0;
    const boxedWi = rawWi > 0 ? rawWi + BOX_PADDING_CM : 0;
    const boxedH = rawH > 0 ? rawH + BOX_PADDING_CM : 0;

    let actualCost = 0;
    // International shipping is now free for all methods as per request
    actualCost = 0;

    // As per user request: always add money of delivery
    const roundedShipping = Math.ceil(actualCost / 250) * 250;
    
    return roundedShipping;
  } catch (error) {
    return 0;
  }
}
