import prisma from './prismaClient.js';
import fs from 'fs';

const extractNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const str = String(val);
  const match = str.match(/(\d+\.?\d*)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    const isGramUnit = (str.includes('جرام') || str.toLowerCase().includes('gram')) && !str.toLowerCase().includes('kg');
    const isLikelyGrams = !str.toLowerCase().includes('kg') && parsed > 10;
    if (isGramUnit || isLikelyGrams) {
      return parsed / 1000;
    }
    return isNaN(parsed) ? null : parsed;
  }
  return null;
};

const calculateBulkImportPrice = (rawPrice, domesticFee, weight, length, width, height, explicitMethod) => {
  const weightInKg = extractNumber(weight) || 0.5;
  let method = explicitMethod?.toLowerCase();
  if (!method) {
    method = (weightInKg > 0 && weightInKg < 1) ? 'air' : 'sea';
  }
  const domestic = domesticFee || 0;

  if (method === 'air') {
    // Air Pricing logic: (Base Price + Domestic Fee + (Weight * Air Rate)) * 1.20
    const airRate = 15400;
    const shippingCost = weightInKg * airRate;
    return Math.ceil(((rawPrice + domestic + shippingCost) * 1.20) / 250) * 250;
  } else {
    // Sea: (Base Price + Domestic Fee + Sea Shipping) * 1.20
    const seaRate = 182000;
    const l = extractNumber(length) || 0;
    const w = extractNumber(width) || 0;
    const h = extractNumber(height) || 0;

    const paddedL = l > 0 ? l + 5 : 0;
    const paddedW = w > 0 ? w + 5 : 0;
    const paddedH = h > 0 ? h + 5 : 0;

    const volumeCbm = (paddedL * paddedW * paddedH) / 1000000;
    const seaShippingCost = Math.max(volumeCbm * seaRate, 500);

    return Math.ceil(((rawPrice + domestic + seaShippingCost) * 1.20) / 250) * 250;
  }
};

async function main() {
  const content = fs.readFileSync('../recent_products.json', 'utf8');
  
  // Try to find the JSON array in the content
  // The content seems to be a PowerShell dump, so the JSON is after "Content           : "
  const match = content.match(/Content\s+:\s+([\s\S]+?)RawContent/);
  let productsJson = '';
  
  if (match) {
    productsJson = match[1].trim();
  } else {
    // Maybe it's just the JSON itself?
    productsJson = content.trim();
  }

  try {
    // If it's a PowerShell dump, the JSON might be split across lines or truncated
    // Let's try to parse it. If it fails, we might need a different approach.
    const rawData = JSON.parse(productsJson);
    console.log(`Found ${rawData.length} products in recent_products.json`);

    console.log('Importing products...');
    for (const p of rawData) {
      const existing = await prisma.product.findFirst({
        where: { name: p.name }
      });

      if (!existing) {
        const domesticFee = parseFloat(p.domestic_shipping_fee || p.domesticShippingFee) || 0;
        const rawPrice = parseFloat(p.price) || parseFloat(p.basePriceRMB) || 0;
        const price = calculateBulkImportPrice(rawPrice, domesticFee, p.weight, p.length, p.width, p.height, p.shippingMethod);

        // Skip products with 0 price
        if (price <= 0 || rawPrice <= 0) {
          console.log(`[Bulk Import] Skipping product with 0 price: ${p.name || 'Unnamed'}`);
          continue;
        }

        await prisma.product.create({
          data: {
            name: p.name || 'Unnamed Product',
            chineseName: p.chineseName,
            description: p.description,
            price: price,
            basePriceRMB: rawPrice,
            image: p.image || '',
            purchaseUrl: p.purchaseUrl,
            status: 'DRAFT', // Import as draft
            isActive: false,
            isFeatured: !!p.isFeatured,
            isPriceCombined: true,
            specs: p.specs,
            storeEvaluation: p.storeEvaluation,
            reviewsCountShown: p.reviewsCountShown,
            videoUrl: p.videoUrl,
            domesticShippingFee: domesticFee,
            minOrder: parseInt(p.min_order || p.minOrder) || 1,
            deliveryTime: p.delivery_time || p.deliveryTime || p.Delivery_time || null
          }
        });
        console.log(`Imported: ${p.name}`);
      } else {
        console.log(`Skipped (exists): ${p.name}`);
      }
    }
    console.log('Import finished!');
  } catch (err) {
    console.error('Failed to parse or import products:', err.message);
    // If parsing fails, let's dump the first 500 chars to debug
    console.log('Raw content snippet:', productsJson.substring(0, 500));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
