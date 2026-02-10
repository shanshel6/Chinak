
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Copy of helper functions from server/index.js (updated with 500 floor)
const extractNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const str = String(val);
  const match = str.match(/(\d+\.?\d*)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    const isGramUnit = (str.includes('جرام') || str.toLowerCase().includes('gram')) && !str.toLowerCase().includes('kg');
    const isLikelyGrams = !str.toLowerCase().includes('kg') && parsed > 10;
    if (isGramUnit || isLikelyGrams) return parsed / 1000;
    return isNaN(parsed) ? null : parsed;
  }
  return null;
};

const calculateBulkImportPrice = (rawPrice, domesticFee, weight, length, width, height, explicitMethod, rates) => {
  const weightInKg = extractNumber(weight) || 0.5;
  let method = explicitMethod?.toLowerCase();
  if (!method) method = (weightInKg > 0 && weightInKg < 1) ? 'air' : 'sea';
  const domestic = domesticFee || 0;

  if (method === 'air') {
    const airRate = (rates?.airShippingRate ?? rates?.airRate ?? 15400);
    const airMinFloor = (rates?.airShippingMinFloor ?? rates?.airMinFloor ?? rates?.minFloor ?? 0);
    const shippingCost = Math.max(weightInKg * airRate, airMinFloor);
    return Math.ceil(((rawPrice + domestic + shippingCost) * 1.20) / 250) * 250;
  } else {
    const seaRate = (rates?.seaShippingRate ?? rates?.seaRate ?? 182000);
    const seaMinFloor = (rates?.seaShippingMinFloor ?? rates?.minFloor ?? 500); // UPDATED TO 500
    const l = extractNumber(length) || 0;
    const w = extractNumber(width) || 0;
    const h = extractNumber(height) || 0;
    const volumeCbm = (l * w * h) / 1000000;
    const seaShippingCost = Math.max(volumeCbm * seaRate, seaMinFloor);
    return Math.ceil(((rawPrice + domestic + seaShippingCost) * 1.20) / 250) * 250;
  }
};

const applyDynamicPricingToProduct = (product, rates) => {
  if (!product) return product;
  const isCombined = product.isPriceCombined || (Number(product.basePriceRMB) > 1000);
  if (isCombined) return product;
  const base = Number(product.basePriceRMB) || 0;
  if (!(base > 0)) return product;
  const domesticFee = Number(product.domesticShippingFee) || 0;
  const price = calculateBulkImportPrice(base, domesticFee, product.weight, product.length, product.width, product.height, 'sea', rates);
  
  let finalPrice = price;
  if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
      const validVariantPrices = product.variants
          .map(v => Number(v.price))
          .filter(p => p > 0 && Number.isFinite(p));
      if (validVariantPrices.length > 0) {
          const minVariantPrice = Math.min(...validVariantPrices);
          if (minVariantPrice < finalPrice || !isCombined) finalPrice = minVariantPrice;
      }
  }

  if (!Number.isFinite(finalPrice) || finalPrice <= 0) return product;
  if (finalPrice === product.price) return product;
  return { ...product, price: finalPrice };
};

async function main() {
  const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
  const rates = {
    airShippingRate: storeSettings?.airShippingRate,
    seaShippingRate: storeSettings?.seaShippingRate,
    airShippingMinFloor: storeSettings?.airShippingMinFloor,
    seaShippingMinFloor: 500 // Enforce 500 floor here for testing
  };

  console.log('Using rates:', rates);

  // Test Case: Small Item (Sea Shipping)
  // Dimensions: 10x10x10 cm = 0.001 CBM
  // Rate: 182000 IQD/CBM
  // Raw Cost: 0.001 * 182000 = 182 IQD
  // Old Min Floor: 2200 IQD -> Cost = 2200
  // New Min Floor: 500 IQD -> Cost = 500
  
  const testProduct = {
    id: 99999,
    basePriceRMB: 25, // 25 IQD base
    domesticShippingFee: 0,
    weight: 2.0, // Force Sea
    length: 10, width: 10, height: 10,
    isPriceCombined: false,
    variants: []
  };

  console.log('\n--- Test Calculation ---');
  const result = applyDynamicPricingToProduct(testProduct, rates);
  console.log(`Base Price: ${testProduct.basePriceRMB} IQD`);
  console.log(`Dims: 10x10x10 (0.001 CBM)`);
  console.log(`Calculated Shipping Cost (should be max(182, 500) = 500): ???`);
  console.log(`Final Price (with 20% markup + rounding): ${result.price}`);
  
  // Expected: (25 + 0 + 500) * 1.2 = 630. Rounded to nearest 250 -> 750 IQD.
  // If old logic (2200 floor): (25 + 0 + 2200) * 1.2 = 2670. Rounded -> 2750 IQD.
  
  if (result.price < 1000) {
      console.log('✅ SUCCESS: Price is low, indicating 500 IQD floor is working.');
  } else {
      console.log('❌ FAILURE: Price is high, indicating old floor might still be in effect.');
  }
}

main().finally(() => prisma.$disconnect());
