import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import prisma from '../prismaClient.js';
import { processProductAI, processProductEmbedding } from '../services/aiService.js';
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

const calculateBulkImportPrice = (rawPrice, domesticFee, weight, length, width, height, explicitMethod) => {
  // Simplified pricing logic: (Base + Domestic) * 1.15
  // International shipping components are removed.
  
  const domestic = domesticFee || 0;
  
  // Treat rawPrice as IQD (no heuristic conversion)
  const basePrice = rawPrice;
  
  // Formula: (Base + Domestic) * 1.15
  const finalPrice = (basePrice + domestic) * 1.15;
  
  return Math.ceil(finalPrice / 250) * 250;
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

  const RESTRICTED_KEYWORDS = [
    // Dangerous Goods (Batteries, Liquids, etc.)
    'battery', 'lithium', 'power bank', 'powerbank', 'batteries',
    'بطارية', 'ليثيوم', 'باور بانك', 'شاحن متنقل',
    'liquid', 'oil', 'cream', 'gel', 'paste', 'shampoo', 'perfume', 'spray', 'aerosol',
    'سائل', 'زيت', 'كريم', 'جل', 'معجون', 'شامبو', 'عطر', 'بخاخ',
    'powder', 'dust', 'مسحوق', 'بودرة',
    'magnet', 'magnetic', 'مغناطيس', 'مغناطيسي',
    'knife', 'sword', 'dagger', 'weapon', 'gun', 'rifle',
    'سكين', 'سيف', 'خنجر', 'سلاح', 'بندقية',
    'flammable', 'lighter', 'gas', 'قابل للاشتعال', 'ولاعة', 'غاز',
    // Furniture / Bulky Items
    'furniture', 'sofa', 'couch', 'chair', 'table', 'desk', 'wardrobe', 'cabinet', 'cupboard', 
    'bed', 'mattress', 'bookshelf', 'shelf', 'shelves', 'dresser', 'sideboard', 'stool', 'bench',
    'armchair', 'recliner', 'ottoman', 'bean bag', 'dining set', 'tv stand', 'shoe rack',
    'أثاث', 'كنبة', 'أريكة', 'كرسي', 'طاولة', 'مكتب', 'دولاب', 'خزانة', 'سرير', 'مرتبة', 
    'رف', 'ارفف', 'تسريحة', 'كومودينو', 'بوفيه', 'مقعد', 'بنش', 'طقم جلوس', 'طاولة طعام', 
    'حامل تلفزيون', 'جزامة', 'طقم صالون', 'غرفة نوم'
  ];
  const EXCEPTIONS = [
    'cover', 'cloth', 'slipcover', 'cushion case', 'pillow case', 'protector', 'accessory', 'accessories', 'toy', 'miniature', 'model',
    'غطاء', 'مفرش', 'تلبيسة', 'كيس وسادة', 'حماية', 'اكسسوار', 'لعبة', 'نموذج', 'مجسم'
  ];

  const detectAirRestriction = (text) => {
    if (!text) return false;
    const lowerText = String(text).toLowerCase();
    for (const keyword of RESTRICTED_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        const isException = EXCEPTIONS.some(ex => lowerText.includes(ex.toLowerCase()));
        if (!isException) return true;
      }
    }
    return false;
  };

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
        const rawPrice = parseFloat(p.general_price) || parseFloat(p.price) || parseFloat(p.basePriceIQD) || parseFloat(p.basePriceRMB) || 0;
        
        // If rawPrice > 1000, assume it is already IQD (combined). Otherwise treat as RMB and calculate.
        const isLikelyIQD = rawPrice > 1000;
         
        const price = isLikelyIQD 
          ? rawPrice 
          : calculateBulkImportPrice(rawPrice, domesticFee, p.weight, p.length, p.width, p.height, p.shippingMethod);

        // Skip products with 0 price
        if (price <= 0 || rawPrice <= 0) {
          console.log(`[Bulk Import] Skipping product with 0 price: ${name}`);
          results.skipped++;
          continue;
        }

        product = await prisma.product.create({
          data: {
            name: name,
            // chineseName: p.chineseName,
            // description: p.description,
            price: price, // Now uses 90% markup for Air items
            basePriceIQD: rawPrice,
            image: p.image || '',
            purchaseUrl: p.purchaseUrl,
            status: 'DRAFT', // Import as draft until published
            isActive: false, // Inactive by default when DRAFT
            isFeatured: !!p.isFeatured,
            specs: p.specs,
            videoUrl: p.videoUrl,
            domesticShippingFee: domesticFee,
            isAirRestricted: p.isAirRestricted === true || p.isAirRestricted === 'true' || p.isAirRestricted === 1 || p.is_air_restricted === true || p.is_air_restricted === 'true' || p.is_air_restricted === 1 || p.IsAirRestricted === true || p.IsAirRestricted === 'true' || p.IsAirRestricted === 1 || detectAirRestriction(`${name} ${p.specs || ''}`),
            minOrder: parseInt(p.min_order || p.minOrder) || 1,
            deliveryTime: p.delivery_time || p.deliveryTime || p.Delivery_time || null,
            aiMetadata: p.aiMetadata || p.ai_metadata || p.aimetatags || null
          }
        });
        results.imported++;
        console.log(`[${results.imported + results.skipped + results.failed}/${rawData.length}] Imported: ${name}`);

        // Trigger AI processing (Metadata + Embedding)
        if (process.env.SILICONFLOW_API_KEY || process.env.HUGGINGFACE_API_KEY) {
          try {
            console.log(`  -> AI processing for product ${product.id}...`);
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
