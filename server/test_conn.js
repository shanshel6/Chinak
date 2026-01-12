import prisma from './prismaClient.js';

async function test() {
  try {
    console.log('Testing connection...');
    const count = await prisma.product.count();
    console.log('Connection successful! Product count:', count);
  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
