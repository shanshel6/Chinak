
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixVariantPricesBatch() {
  const BATCH_SIZE = 50;
  let skip = 0;
  let processedCount = 0;
  let updatedCount = 0;

  try {
    while (true) {
      const products = await prisma.product.findMany({
        where: {
          isPriceCombined: true,
          basePriceRMB: { gt: 0 },
          price: { gt: 0 },
          variants: { some: { basePriceRMB: { gt: 0 } } }
        },
        include: { variants: true },
        take: BATCH_SIZE,
        skip: skip,
        orderBy: { id: 'asc' }
      });

      if (products.length === 0) break;

      console.log(`Processing batch starting at index ${skip}...`);

      for (const product of products) {
        if (!product.variants || product.variants.length === 0) continue;

        const impliedRate = product.price / product.basePriceRMB;

        for (const variant of product.variants) {
          if (!variant.basePriceRMB || variant.basePriceRMB <= 0) continue;

          // Calculate expected price based on implied rate
          const expectedPriceRaw = variant.basePriceRMB * impliedRate;
          // Round to nearest 250
          const expectedPrice = Math.ceil(expectedPriceRaw / 250) * 250;

          // Check if update is needed (allow small difference due to rounding)
          if (Math.abs(variant.price - expectedPrice) > 500 || !variant.isPriceCombined) {
            
            // Log the change for verification (sample log)
            if (updatedCount % 100 === 0) {
                console.log(`Fixing Product ${product.id} Variant ${variant.id}:`);
                console.log(`  Main: ${product.price} / ${product.basePriceRMB} = Rate ${impliedRate.toFixed(4)}`);
                console.log(`  Variant Base: ${variant.basePriceRMB}`);
                console.log(`  Old Price: ${variant.price}`);
                console.log(`  New Price: ${expectedPrice}`);
            }

            await prisma.productVariant.update({
              where: { id: variant.id },
              data: { 
                price: expectedPrice,
                isPriceCombined: true 
              }
            });
            updatedCount++;
          }
        }
        processedCount++;
      }

      skip += BATCH_SIZE;
      if (processedCount % 500 === 0) {
        console.log(`Processed ${processedCount} products, updated ${updatedCount} variants so far.`);
      }
    }

    console.log(`Done. Total processed: ${processedCount}, Total updated variants: ${updatedCount}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixVariantPricesBatch();
