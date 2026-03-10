const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

// Explicitly load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const prisma = new PrismaClient();

async function check() {
  try {
    const where = { 
      isActive: true,
      status: 'PUBLISHED'
    };
    
    // Test connection first
    await prisma.$connect();
    
    console.log('Running query...');
    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        price: true,
        basePriceIQD: true, // Potential issue?
        domesticShippingFee: true, // Potential issue?
      },
      take: 1
    });
    console.log('Query success. Products found:', products.length);
    fs.writeFileSync('check_products_output.log', 'SUCCESS: ' + JSON.stringify(products, null, 2));
  } catch (error) {
    console.error('Query failed:', error);
    fs.writeFileSync('check_products_output.log', 'ERROR: ' + error.message + '\n' + error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

check();
