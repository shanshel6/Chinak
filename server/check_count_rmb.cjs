
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countProductsWithRmbVariants() {
  try {
    const count = await prisma.product.count({
      where: {
        isPriceCombined: true,
        basePriceRMB: { gt: 0 },
        price: { gt: 0 },
        variants: { some: { basePriceRMB: { gt: 0 } } }
      }
    });
    console.log(`Products with RMB variants: ${count}`);
    
    // List a few
    const products = await prisma.product.findMany({
      where: {
        isPriceCombined: true,
        basePriceRMB: { gt: 0 },
        price: { gt: 0 },
        variants: { some: { basePriceRMB: { gt: 0 } } }
      },
      select: { id: true, name: true },
      take: 5
    });
    console.log(products);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

countProductsWithRmbVariants();
