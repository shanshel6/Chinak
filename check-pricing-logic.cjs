const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const products = await prisma.product.findMany({
      take: 5,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        price: true,
        basePriceRMB: true,
        isPriceCombined: true,
        domesticShippingFee: true,
        weight: true
      }
    });

    console.log('Latest 5 products:');
    products.forEach(p => {
      console.log(JSON.stringify(p, null, 2));
    });

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
