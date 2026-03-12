
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkNewOrOld() {
  try {
    const products = await prisma.product.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, neworold: true }
    });
    console.log('Recent 10 products:');
    console.table(products);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkNewOrOld();
