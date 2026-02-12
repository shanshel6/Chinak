import prisma from '../prismaClient.js';

async function main() {
  try {
    console.log('Syncing `price` column using `basePriceRMB` as IQD source...');
    console.log('Formula: (basePriceRMB + domesticShippingFee) * 1.15 [Rounded to nearest 250]');

    const products = await prisma.product.findMany({
      include: { variants: true }
    });

    console.log(`Found ${products.length} products to check.`);

    let updatedProducts = 0;
    let updatedVariants = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const domesticFee = product.domesticShippingFee || 0;
      
      // --- PRODUCT LEVEL ---
      if (product.basePriceRMB && product.basePriceRMB > 0) {
        const rawCost = product.basePriceRMB;
        const calculated = (rawCost + domesticFee) * 1.15;
        const newPrice = Math.ceil(calculated / 250) * 250;

        if (newPrice !== product.price) {
          await prisma.product.update({
            where: { id: product.id },
            data: { price: newPrice }
          });
          updatedProducts++;
        }
      }

      // --- VARIANT LEVEL ---
      for (const variant of product.variants) {
        if (variant.basePriceRMB && variant.basePriceRMB > 0) {
           const rawCost = variant.basePriceRMB;
           const calculated = (rawCost + domesticFee) * 1.15;
           const newPrice = Math.ceil(calculated / 250) * 250;
           
           if (newPrice !== variant.price) {
              await prisma.productVariant.update({
                where: { id: variant.id },
                data: { price: newPrice }
              });
              updatedVariants++;
           }
        }
      }
      
      if (i % 250 === 0) {
          process.stdout.write(`Processed ${i + 1}/${products.length} products...\r`);
      }
    }

    console.log('\nSync complete.');
    console.log(`Updated ${updatedProducts} products.`);
    console.log(`Updated ${updatedVariants} variants.`);

  } catch (error) {
    console.error('Error syncing prices:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
