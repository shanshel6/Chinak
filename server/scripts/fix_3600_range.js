import prisma from '../prismaClient.js';

async function main() {
  try {
    console.log('Targeted fix for products with basePriceRMB ~ 3600...');

    const products = await prisma.product.findMany({
      where: { 
        basePriceRMB: { gte: 3500, lte: 3700 }
      }
    });

    console.log(`Found ${products.length} products in range.`);

    for (const p of products) {
        const domestic = p.domesticShippingFee || 0; // Use actual domestic fee
        const calculated = (p.basePriceRMB + domestic) * 1.15;
        const newPrice = Math.ceil(calculated / 250) * 250;
        
        if (p.price !== newPrice) {
            console.log(`Updating ID ${p.id}: Base ${p.basePriceRMB} + Dom ${domestic} = ${p.basePriceRMB + domestic} -> New ${newPrice}`);
            await prisma.product.update({
                where: { id: p.id },
                data: { price: newPrice }
            });
        }
    }
    console.log('Done.');

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
