import prisma from './prismaClient.js';

async function test() {
  try {
    console.log('Testing database connection...');
    const productCount = await prisma.product.count();
    console.log('Database connection successful!');
    console.log('Product count:', productCount);
    
  } catch (error) {
    console.error('Database connection failed:');
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
