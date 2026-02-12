import prisma from '../prismaClient.js';

async function main() {
  try {
    // Find a product with basePriceRMB ~ 3600 to verify
    const products = await prisma.product.findMany({
      where: { 
        basePriceRMB: { gte: 3500, lte: 3700 } 
      },
      take: 5
    });

    console.log('Verification check for products around 3600 IQD base:');
    products.forEach(p => {
        console.log(`ID: ${p.id} | Base: ${p.basePriceRMB} | Domestic: ${p.domesticShippingFee} | Final Price: ${p.price}`);
        // Calc check
        const expected = Math.ceil(((p.basePriceRMB + (p.domesticShippingFee || 0)) * 1.15) / 250) * 250;
        console.log(`Expected: ${expected} | Match: ${p.price === expected}`);
    });

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
