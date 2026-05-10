import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env'), override: false });

// Set DATABASE_URL directly if not set (from bat file values)
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require&connection_limit=10&pool_timeout=300&connect_timeout=120&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3';
}

const prisma = new PrismaClient();
const CNY_TO_IQD_RATE = 200;
const PRICE_MULTIPLIER = 1.2;

async function ensureDatabaseConnection() {
  let retryCount = 0;
  const maxRetries = 10;
  const retryDelayMs = 5000;

  while (retryCount < maxRetries) {
    try {
      await prisma.$connect();
      console.log('[Fix Prices] Database connected successfully');
      return true;
    } catch (error) {
      retryCount++;
      console.error(`[Fix Prices] Database connection attempt ${retryCount}/${maxRetries} failed: ${error.message}`);
      if (retryCount < maxRetries) {
        console.log(`[Fix Prices] Retrying in ${retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  return false;
}

async function fixProductPrices() {
  console.log('[Fix Prices] Starting price correction...');
  
  // Ensure database connection
  const connected = await ensureDatabaseConnection();
  if (!connected) {
    console.error('[Fix Prices] Failed to connect to database after multiple attempts');
    return;
  }
  
  try {
    console.log('[Fix Prices] Querying products with id 865-1300...');
    // Get all products with goofishItemId (from Goofish scraper) and id 865-1300 (resume from 864)
    const products = await Promise.race([
      prisma.product.findMany({
        where: {
          id: {
            gte: 865,
            lte: 1300
          },
          aiMetadata: {
            path: ['goofishItemId'],
            not: null
          }
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout after 60 seconds')), 60000))
    ]);
    
    console.log(`[Fix Prices] Found ${products.length} products to check`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const product of products) {
      try {
        // Reverse calculate from current (incorrect) basePriceIQD
        // Current (wrong): basePriceIQD = priceCny * 250, price = basePriceIQD * 1.25
        // Correct: basePriceIQD = priceCny * 200, price = basePriceIQD * 1.2
        // So: correctBasePriceIQD = currentBasePriceIQD * (200/250) = currentBasePriceIQD * 0.8
        // And: correctPrice = correctBasePriceIQD * 1.2 = currentBasePriceIQD * 0.8 * 1.2 = currentBasePriceIQD * 0.96
        
        const correctBasePriceIQD = Math.round(product.basePriceIQD * 0.8);
        const correctPriceIQD = Math.round(product.basePriceIQD * 0.96);
        
        // Check if prices need updating
        const needsUpdate = product.basePriceIQD !== correctBasePriceIQD || product.price !== correctPriceIQD;
        
        if (!needsUpdate) {
          console.log(`[Fix Prices] Product ${product.id} - prices already correct`);
          skippedCount++;
          continue;
        }
        
        // Update product
        await prisma.product.update({
          where: { id: product.id },
          data: {
            basePriceIQD: correctBasePriceIQD,
            price: correctPriceIQD
          }
        });
        
        console.log(`[Fix Prices] Updated product ${product.id}: ${product.price} -> ${correctPriceIQD} IQD (base: ${product.basePriceIQD} -> ${correctBasePriceIQD})`);
        updatedCount++;
        
      } catch (err) {
        console.error(`[Fix Prices] Error updating product ${product.id}: ${err.message}`);
        errorCount++;
      }
    }
    
    console.log(`[Fix Prices] Complete! Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
    
  } catch (err) {
    console.error('[Fix Prices] Fatal error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

fixProductPrices();
