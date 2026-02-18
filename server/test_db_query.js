
import prisma from './prismaClient.js';
import fs from 'fs';

async function testQuery() {
  try {
    console.log('Testing Product query...');
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      },
      select: {
        id: true,
        name: true,
        price: true,
        basePriceIQD: true, // Uncommented
        image: true,
        isFeatured: true,
        domesticShippingFee: true, // Uncommented
        deliveryTime: true, // Uncommented
        variants: {
          select: {
            id: true,
            combination: true,
            price: true,
            basePriceIQD: true, // Uncommented
            image: true,
          }
        }
      },
      take: 1,
      orderBy: { updatedAt: 'desc' }
    });
    
    console.log('Query successful:', products.length, 'products found');
    fs.writeFileSync('e:/mynewproject2/server/query_result.json', JSON.stringify(products, null, 2));
  } catch (error) {
    console.error('Query failed:', error);
    fs.writeFileSync('e:/mynewproject2/server/query_error.txt', error.message + '\n' + error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testQuery();
