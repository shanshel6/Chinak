
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const path = require('path');

// Load .env
dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function checkIqdInRmb() {
  try {
    console.log('Checking for products with potential IQD values in basePriceRMB...');
    
    const countTotal = await prisma.product.count();
    console.log(`Total products in DB: ${countTotal}`);

    // Threshold: 1000. Real RMB prices are rarely > 1000 for small items, but possible.
    // However, IQD prices are almost always > 1000 (e.g. 2000, 5000).
    // If we have basePriceRMB > 1000 and isPriceCombined = false, these will be inflated x200.
    
    const count = await prisma.product.count({
      where: {
        basePriceRMB: { gt: 1000 },
        isPriceCombined: false
      }
    });

    console.log(`Found ${count} products with basePriceRMB > 1000 and isPriceCombined = false.`);

    if (count > 0) {
      const examples = await prisma.product.findMany({
        where: {
          basePriceRMB: { gt: 1000 },
          isPriceCombined: false
        },
        take: 5,
        select: {
          id: true,
          name: true,
          price: true,
          basePriceRMB: true,
          isPriceCombined: true
        }
      });

      console.log('Examples:');
      examples.forEach(p => {
        console.log(`ID: ${p.id}, Name: ${p.name.substring(0, 20)}..., Price: ${p.price}, BaseRMB: ${p.basePriceRMB}, Combined: ${p.isPriceCombined}`);
      });
    }

    // Check product 7530 specifically
    console.log('Checking Product 7530...');
    const p7530 = await prisma.product.findUnique({
      where: { id: 7530 },
      select: {
        id: true,
        name: true,
        price: true,
        basePriceRMB: true,
        isPriceCombined: true
      }
    });

    if (p7530) {
      console.log('--- Product 7530 ---');
      console.log(`ID: ${p7530.id}, Price: ${p7530.price}, BaseRMB: ${p7530.basePriceRMB}, Combined: ${p7530.isPriceCombined}`);
    } else {
        console.log('Product 7530 not found in DB');
        // Try to find ANY product to confirm DB connection
        const one = await prisma.product.findFirst();
        console.log('First product found:', one ? one.id : 'NONE');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkIqdInRmb();
