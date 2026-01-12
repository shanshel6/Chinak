import prisma from './prismaClient.js';

async function test() {
  try {
    console.log('Testing connection...');
    const count = await prisma.product.count();
    console.log('Connection successful, product count:', count);
  } catch (err) {
    console.error('Connection failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
