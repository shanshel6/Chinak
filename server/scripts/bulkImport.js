import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import prisma from '../prismaClient.js';
import { processProductAI } from '../services/aiService.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from the server root
dotenv.config({ path: path.join(__dirname, '../.env') });

const extractNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  
  const str = String(val);
  // Matches the first sequence of digits and decimals
  const match = str.match(/(\d+\.?\d*)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    
    // If unit is grams, or if no unit is specified but the number is large (> 10), assume grams and convert to kg
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
  const weightInKg = extractNumber(weight) || 0.5; // Default 0.5kg if missing
  
  let method = explicitMethod?.toLowerCase();
  
  if (!method) {
    // Default logic matching frontend: < 2kg is AIR, >= 2kg is SEA
    method = (weightInKg > 0 && weightInKg < 2) ? 'air' : 'sea';
  }

  const domestic = domesticFee || 0;

  if (method === 'air') {
    // Air Price: (Base Price * 1.9) + Domestic Shipping
    // Shipping fee in cart will be 0
    return Math.ceil(((rawPrice * 1.9) + domestic) / 250) * 250;
  } else {
    // Sea Price: (Base Price * 1.15) + Domestic Shipping
    // Shipping fee will be calculated in cart separately
    return Math.ceil(((rawPrice * 1.15) + domestic) / 250) * 250;
  }
};

async function bulkImport(filePath) {
  console.log(`Starting bulk import from: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  let rawData;

  try {
    // Attempt 1: Standard JSON
    rawData = JSON.parse(content);
  } catch (err) {
    // Attempt 2: PowerShell dump cleaning
    console.log('Standard JSON parse failed, attempting to clean PowerShell dump format...');
    const startIndex = content.indexOf('[');
    const endIndex = content.lastIndexOf(']') + 1;
    
    if (startIndex === -1 || endIndex === 0) {
      console.error('Could not find JSON array in file');
      return;
    }
    
    let jsonPart = content.substring(startIndex, endIndex);
    jsonPart = jsonPart.replace(/\r?\n\s+/g, ' ');
    jsonPart = jsonPart.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    
    try {
      rawData = JSON.parse(jsonPart);
    } catch (cleanErr) {
      console.error('Failed to parse even after cleaning:', cleanErr.message);
      return;
    }
  }

  if (!Array.isArray(rawData)) {
    console.error('Data is not an array of products');
    return;
  }

  console.log(`Found ${rawData.length} products to import.`);

  const results = {
    imported: 0,
    skipped: 0,
    failed: 0,
    aiProcessed: 0,
    aiFailed: 0
  };

  for (const p of rawData) {
    try {
      const name = p.name ? p.name.replace(/\n/g, ' ').trim() : 'Unnamed';
      
      // Check for existence
      let product = await prisma.product.findFirst({
        where: { name: name }
      });

      if (!product) {
        const domesticFee = parseFloat(p.domestic_shipping_fee || p.domesticShippingFee) || 0;
        const rawPrice = parseFloat(p.general_price) || parseFloat(p.price) || parseFloat(p.basePriceRMB) || 0;
        const price = calculateBulkImportPrice(rawPrice, domesticFee, p.weight, p.shippingMethod);

        product = await prisma.product.create({
          data: {
            name: name,
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
        results.imported++;
        console.log(`[${results.imported + results.skipped + results.failed}/${rawData.length}] Imported: ${name}`);

        // Trigger AI processing
        if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
          try {
            console.log(`  -> AI Processing for product ${product.id}...`);
            await processProductAI(product.id);
            results.aiProcessed++;
            // 2-second delay to be safe with SiliconFlow free tier
            await new Promise(r => setTimeout(r, 2000));
          } catch (aiErr) {
            console.error(`  !! AI Failed for product ${product.id}:`, aiErr.message);
            results.aiFailed++;
          }
        }
      } else {
        results.skipped++;
        console.log(`[${results.imported + results.skipped + results.failed}/${rawData.length}] Skipped (exists): ${name}`);
      }
    } catch (err) {
      console.error(`  !! Failed to import product:`, err.message);
      results.failed++;
    }
  }

  console.log('\n--- Bulk Import Summary ---');
  console.log(`Total processed: ${rawData.length}`);
  console.log(`Imported: ${results.imported}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`AI Processed: ${results.aiProcessed}`);
  console.log(`AI Failed: ${results.aiFailed}`);
  console.log('----------------------------');
}

const filePathArg = process.argv[2] || '../recent_products.json';
const absolutePath = path.isAbsolute(filePathArg) ? filePathArg : path.join(process.cwd(), filePathArg);

bulkImport(absolutePath)
  .catch(err => console.error('Bulk import error:', err))
  .finally(() => prisma.$disconnect());
