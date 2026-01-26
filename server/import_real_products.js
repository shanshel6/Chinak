import pkg from '@prisma/client';
import fs from 'fs';
import { processProductAI } from './services/aiService.js';
import dotenv from 'dotenv';
import prisma from './prismaClient.js';

dotenv.config();

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
    method = (weightInKg > 0 && weightInKg < 2) ? 'air' : 'sea';
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
    const seaShippingCost = Math.max(volumeCbm * seaRate, 1000);

    return Math.ceil(((rawPrice + domestic + seaShippingCost) * 1.20) / 250) * 250;
  }
};

async function main() {
  const content = fs.readFileSync('../recent_products.json', 'utf8');
  
  // The content is a PowerShell dump. We need to extract the part between "[" and "]"
  // after the "Content           : " label.
  const startIndex = content.indexOf('[');
  const endIndex = content.lastIndexOf(']') + 1;
  
  if (startIndex === -1 || endIndex === 0) {
    console.error('Could not find JSON array in file');
    return;
  }
  
  let jsonPart = content.substring(startIndex, endIndex);
  
  // PowerShell output often adds extra newlines and indentation inside the content.
  // We need to clean it up.
  // 1. Remove the line breaks that are followed by lots of spaces (PowerShell formatting)
  jsonPart = jsonPart.replace(/\r?\n\s+/g, ' ');
  // 2. Remove any other weird characters
  jsonPart = jsonPart.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  try {
    const rawData = JSON.parse(jsonPart);
    console.log(`Successfully parsed ${rawData.length} products!`);

    for (const p of rawData) {
      const name = p.name ? p.name.replace(/\n/g, ' ').trim() : 'Unnamed';
      const chineseName = p.chineseName ? p.chineseName.replace(/\n/g, ' ').trim() : null;
      const description = p.description ? p.description.replace(/\n/g, ' ').trim() : null;
      
      let product = await prisma.product.findFirst({
        where: { name: name }
      });

      if (!product) {
        const domesticFee = parseFloat(p.domestic_shipping_fee || p.domesticShippingFee) || 0;
        const rawPrice = parseFloat(p.price) || parseFloat(p.basePriceRMB) || 0;
        const price = calculateBulkImportPrice(rawPrice, domesticFee, p.weight, p.length, p.width, p.height, p.shippingMethod);

        product = await prisma.product.create({
          data: {
            name: name,
            chineseName: chineseName,
            description: description,
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
        console.log(`Imported: ${name}`);
        
        // Trigger AI processing with a small delay for free-tier rate limits
        if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
          try {
            console.log(`  -> AI Processing for ${name}...`);
            await processProductAI(product.id);
            // 2-second delay to be safe with SiliconFlow free tier
            await new Promise(r => setTimeout(r, 2000));
          } catch (aiErr) {
            console.error(`  !! AI Processing failed for ${name}:`, aiErr.message);
          }
        }
      } else {
        console.log(`Skipped (exists): ${name}`);
      }
    }
    console.log('Import finished!');
  } catch (err) {
    console.error('Final attempt to parse failed:', err.message);
    if (typeof jsonPart !== 'undefined') {
      console.log('Cleaned snippet:', jsonPart.substring(0, 500));
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
