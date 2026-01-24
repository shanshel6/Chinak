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

const calculateBulkImportPrice = (rawPrice, domesticFee, weight, explicitMethod) => {
  const weightInKg = extractNumber(weight) || 0.5;
  let method = explicitMethod?.toLowerCase();
  if (!method) {
    method = (weightInKg > 0 && weightInKg < 2) ? 'air' : 'sea';
  }
  const domestic = domesticFee || 0;

  if (method === 'air') {
    // Air Price: (Base Price * 1.9) + Domestic Shipping
    return Math.ceil(((rawPrice * 1.9) + domestic) / 250) * 250;
  } else {
    // Sea Price: (Base Price * 1.15) + Domestic Shipping
    return Math.ceil(((rawPrice * 1.15) + domestic) / 250) * 250;
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
        const price = calculateBulkImportPrice(rawPrice, domesticFee, p.weight, p.shippingMethod);

        await prisma.product.create({
          data: {
            name: p.name || 'Unnamed Product',
            chineseName: p.chineseName,
            description: p.description,
            price: price, // Now uses 90% markup for Air items
            basePriceRMB: rawPrice,
            image: p.image || '',
            purchaseUrl: p.purchaseUrl,
            status: 'PUBLISHED',
            isActive: true,
            isFeatured: !!p.isFeatured,
            specs: p.specs,
            storeEvaluation: p.storeEvaluation,
            reviewsCountShown: p.reviewsCountShown,
            videoUrl: p.videoUrl,
            domesticShippingFee: domesticFee
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
