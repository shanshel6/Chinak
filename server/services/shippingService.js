
import prisma from '../prismaClient.js';

/**
 * Calculate international shipping fee based on store settings and product dimensions.
 * @param {Array} items - Array of order items with product data
 * @param {string} method - 'AIR' or 'SEA'
 * @returns {number} - Calculated shipping fee in IQD
 */
export async function calculateOrderShipping(items, method = 'AIR') {
  try {
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    
    const airRate = settings?.airShippingRate || 15400;
    const seaRate = settings?.seaShippingRate || 182000;
    const airMin = settings?.airShippingMinFloor || 5000;
    
    let totalShipping = 0;

    if (method.toUpperCase() === 'AIR') {
      let totalWeight = 0;
      for (const item of items) {
        const product = item.product;
        const qty = item.quantity || 1;
        const weight = product.weight || 0.5;
        totalWeight += weight * qty;
      }
      
      // Physical Rounding: Round total weight up to nearest 0.5kg
      const roundedTotalWeight = Math.ceil(totalWeight * 2) / 2;
      totalShipping = roundedTotalWeight * airRate;
      
      // Minimum floor check for total air shipping
      if (totalShipping < airMin) {
        totalShipping = airMin;
      }
    } else {
      // Sea shipping: based on CBM (Volume)
      let totalCBM = 0;
      for (const item of items) {
        const product = item.product;
        const qty = item.quantity || 1;
        const length = product.length || 10;
        const width = product.width || 10;
        const height = product.height || 10;
        
        // length*width*height in cm / 1,000,000 = CBM
        const itemCBM = (length * width * height) / 1000000;
        totalCBM += itemCBM * qty;
      }
      totalShipping = totalCBM * seaRate;
    }

    // Monetary Rounding: Round total shipping up to nearest 250 IQD
    return Math.ceil(totalShipping / 250) * 250;
  } catch (error) {
    console.error('Shipping calculation failed:', error);
    return 0;
  }
}
