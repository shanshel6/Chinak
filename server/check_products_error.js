import prisma from './prismaClient.js';
import fs from 'fs';

async function check() {
  try {
    const where = { 
      isActive: true,
      status: 'PUBLISHED'
    };
    
    console.log('Running query...');
    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        price: true,
        basePriceIQD: true,
        image: true,
        isFeatured: true,
        domesticShippingFee: true,
        deliveryTime: true,
        variants: {
          select: {
            id: true,
            combination: true,
            price: true,
            basePriceIQD: true,
            image: true,
          }
        }
      },
      take: 20,
      orderBy: { updatedAt: 'desc' }
    });
    console.log('Query success. Products found:', products.length);
    fs.writeFileSync('server/product_query_success.log', JSON.stringify(products, null, 2));
  } catch (error) {
    console.error('Query failed:', error);
    fs.writeFileSync('server/product_query_error.log', error.message + '\n' + error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

check();
