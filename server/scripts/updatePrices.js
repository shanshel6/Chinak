import prisma from '../prismaClient.js';

async function updatePrices() {
  console.log('Starting price update: Adding 10% to all products...');
  
  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        price: true,
        name: true
      }
    });

    // Update Product prices
    console.log(`Found ${products.length} products to update.`);
    let updatedCount = 0;
    for (const product of products) {
      // Logic changed: Don't just add 10% to whatever is there.
      // This script is now intended for manual price adjustments if needed.
      const newPrice = product.price; // Keep price as is by default
      await prisma.product.update({
        where: { id: product.id },
        data: { price: newPrice }
      });
      updatedCount++;
    }
    console.log(`Successfully updated ${updatedCount} products.`);

    // Update ProductVariant prices
    const variants = await prisma.productVariant.findMany({
      select: { id: true, price: true }
    });
    console.log(`Found ${variants.length} variants to update.`);
    let updatedVariantsCount = 0;
    for (const variant of variants) {
      const newPrice = variant.price; // Keep price as is
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { price: newPrice }
      });
      updatedVariantsCount++;
    }
    console.log(`Successfully updated ${updatedVariantsCount} variants.`);
  } catch (error) {
    console.error('Error updating prices:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updatePrices();
