
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Try to load .env from server directory or current directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') }); // Try parent

const prisma = new PrismaClient();
const logFile = path.resolve(process.cwd(), 'check_output.log');

function log(message) {
  const msg = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
  fs.appendFileSync(logFile, msg + '\n');
  // Also log to console for good measure, but rely on file
  // console.log(msg); 
}

async function main() {
  // Clear previous log
  fs.writeFileSync(logFile, '');
  
  log('Starting check_product_fetch.js');
  log(`CWD: ${process.cwd()}`);
  log(`DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
  if (process.env.DATABASE_URL) {
     log(`DATABASE_URL starts with: ${process.env.DATABASE_URL.substring(0, 10)}...`);
  }

  try {
    log('Fetching store settings...');
    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    log(`Store settings found: ${!!storeSettings}`);

    log('Fetching products with exact query from index.js...');
    const where = { 
        isActive: true,
        status: 'PUBLISHED'
    };
    
    // Simulate empty search
    
    const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          select: {
            id: true,
            name: true,
            price: true,
            basePriceIQD: true,
            image: true, // index.js selects this
            isFeatured: true,
            domesticShippingFee: true,
            deliveryTime: true,
            variants: {
              select: {
                id: true,
                combination: true, // index.js selects this
                price: true,
                basePriceIQD: true,
              }
            }
          },
          skip: 0,
          take: 10,
          orderBy: { updatedAt: 'desc' }
        }),
        prisma.product.count({ where })
      ]);
      
    log(`Products fetched count: ${products.length}`);
    log(`Total count: ${total}`);
    
    if (products.length > 0) {
        log(`First product: ${JSON.stringify(products[0], null, 2)}`);
    }

  } catch (error) {
    log(`CRITICAL ERROR: ${error.message}`);
    log(`Stack: ${error.stack}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    log('Disconnected');
  }
}

main();
