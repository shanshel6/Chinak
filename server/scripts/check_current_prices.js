import prisma from '../prismaClient.js';

async function main() {
  try {
    const products = await prisma.product.findMany({
      take: 5,
      select: {
        id: true,
        name: true,
        price: true,
        basePriceRMB: true,
        domesticShippingFee: true
      }
    });

    console.log('Current Data Sample:');
    products.forEach(p => {
      console.log(`ID: ${p.id} | Base (Cost): ${p.basePriceRMB} | Domestic: ${p.domesticShippingFee} | Price (Selling): ${p.price}`);
    });
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
