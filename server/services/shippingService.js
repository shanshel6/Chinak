
import prisma from '../prismaClient.js';

// Packaging Constants
const BOX_PADDING_CM = 1; // 1cm added to each dimension (reduced from 2cm)
const WEIGHT_BUFFER_FACTOR = 1.05; // 5% added to weight (reduced from 15%)

/**
 * Calculate international shipping fee based on store settings and product dimensions.
 * @param {Array} items - Array of order items with product data
 * @param {string} method - 'AIR' or 'SEA'
 * @returns {number} - Calculated shipping fee in IQD
 */
export async function calculateOrderShipping(items, method = 'SEA') {
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
      const qty = item.quantity || 1;
      
      if (method.toUpperCase() === 'AIR') {
        if (product.weight === null || product.weight === undefined || product.weight <= 0) {
          isAirAvailable = false;
          itemsMissingWeight.push(product.name || 'منتج غير مسمى');
        }
      }

      const basePrice = item.variant?.price || item.product?.price || 0;
      totalSubtotal += basePrice * qty;

      // Domestic shipping fee is now included in the product price
      // totalChinaDomestic is kept at 0 to avoid double charging
      totalChinaDomestic = 0;

      // Apply Packaging Padding & Buffer
      const rawW = product.weight || 0.1;
      const rawL = product.length || 10;
      const rawWi = product.width || 10;
      const rawH = product.height || 10;

      // Boxed Dimensions
      const boxedL = rawL + BOX_PADDING_CM;
      const boxedWi = rawWi + BOX_PADDING_CM;
      const boxedH = rawH + BOX_PADDING_CM;
      const boxedW = rawW * WEIGHT_BUFFER_FACTOR;

      let itemShipping = 0;
      if (method.toUpperCase() === 'AIR') {
        // For Air: Based on Actual Weight only (volumetric weight removed as per request)
        itemShipping = boxedW * airRate;
      } else {
        // For Sea: Based on CBM (Volume)
        const cbm = (boxedL * boxedWi * boxedH) / 1000000;
        itemShipping = cbm * seaRate;
      }

      // Round per item to match home page logic (250 IQD rounding)
      const roundedItemShipping = Math.ceil(itemShipping / 250) * 250;
      totalActualShipping += roundedItemShipping * qty;
    }

    // New logic: Shipping is either FREE (if threshold met) or ACTUAL COST
    const airMinOrder = settings?.airShippingThreshold || 50000;
    const seaMinOrder = settings?.seaShippingThreshold || 50000; // Updated to 50k as per request
    
    const threshold = method.toUpperCase() === 'AIR' ? airMinOrder : seaMinOrder;
    const isThresholdMet = totalSubtotal >= threshold;
    
    // Apply minimum per order
    let finalShippingFee = totalActualShipping;
    if (method.toUpperCase() === 'AIR') {
      const minAirCost = 1 * airRate;
      finalShippingFee = Math.max(finalShippingFee, minAirCost);
    } else {
      finalShippingFee = Math.max(finalShippingFee, 10000);
    }

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
    return { fee: 0, isThresholdMet: true };
  }
}

/**
 * Calculate shipping for a single product.
 * Automatically chooses between AIR and SEA based on weight.
 */
export async function calculateProductShipping(product, method = 'SEA', applyMinimum = false) {
  try {
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const airRate = settings?.airShippingRate || 15400;
    const seaRate = settings?.seaShippingRate || 182000;

    // Apply Packaging Padding & Buffer
    const rawW = product.weight || 0.1;
    const rawL = product.length || 10;
    const rawWi = product.width || 10;
    const rawH = product.height || 10;

    // Boxed Dimensions
    const boxedL = rawL + BOX_PADDING_CM;
    const boxedWi = rawWi + BOX_PADDING_CM;
    const boxedH = rawH + BOX_PADDING_CM;
    const boxedW = rawW * WEIGHT_BUFFER_FACTOR;

    let actualCost = 0;
    if (method.toUpperCase() === 'AIR') {
      // For Air: Weight must be available
      if (product.weight === null || product.weight === undefined || product.weight <= 0) {
        return 0; // Air shipping not available without weight
      }
      // For Air: Based on Actual Weight only (volumetric weight removed as per request)
      // Minimum weight is 1kg
      const effectiveWeight = applyMinimum ? Math.max(boxedW, 1) : boxedW;
      actualCost = effectiveWeight * airRate;
    } else {
      // For Sea: Based on CBM (Volume)
      const cbm = (boxedL * boxedWi * boxedH) / 1000000;
      actualCost = cbm * seaRate;
      
      // Minimum cost for Sea is 10,000 IQD
      if (applyMinimum && actualCost < 10000) {
        actualCost = 10000;
      }
    }

    // Free shipping threshold for single product view
    const airMinOrder = settings?.airShippingThreshold || 50000;
    const seaMinOrder = settings?.seaShippingThreshold || 50000;
    const threshold = method.toUpperCase() === 'AIR' ? airMinOrder : seaMinOrder;
    
    // As per user request: always add money of delivery
    const roundedShipping = Math.ceil(actualCost / 250) * 250;
    
    // Domestic shipping fee is now included in the product price
    return roundedShipping;
  } catch (error) {
    return 0;
  }
}
