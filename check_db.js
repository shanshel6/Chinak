import prisma from './server/prismaClient.js';

async function check() {
  try {
    const products = await prisma.product.findMany({ take: 5 });
    console.log('Sample Products:');
    products.forEach(p => {
      console.log(`ID: ${p.id}, Status: ${p.status}, Active: ${p.isActive}`);
    });
    
    const product = await prisma.product.findUnique({ where: { id: 4676 } });
    if (product) {
      console.log('\nProduct 4676:');
      console.log(`ID: ${product.id}, Name: ${product.name}, Price: ${product.price}, Status: ${product.status}`);
    } else {
      console.log('\nProduct 4676 NOT FOUND');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
