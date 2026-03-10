
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countProducts() {
  try {
    const count = await prisma.product.count({
      where: {
        isPriceCombined: true,
        basePriceRMB: { gt: 0 },
        price: { gt: 0 }
      }
    });
    console.log(`Products matching criteria: ${count}`);
    
    const products = await prisma.product.findMany({
      where: {
        isPriceCombined: true,
        basePriceRMB: { gt: 0 },
        price: { gt: 0 }
      },
      select: { id: true, name: true, variants: { select: { id: true } } }
    });
    
    products.forEach(p => {
      console.log(`Product ${p.id}: ${p.variants.length} variants`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

countProducts();
