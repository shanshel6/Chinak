
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkNewOrOld() {
  try {
    const products = await prisma.product.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, neworold: true, purchaseUrl: true }
    });
    console.log('--- Recent 20 Products in Database ---');
    console.table(products.map(p => ({
        id: p.id,
        name: p.name.substring(0, 30),
        neworold: p.neworold,
        url: p.purchaseUrl
    })));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkNewOrOld();
