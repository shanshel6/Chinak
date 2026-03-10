
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixVariantPrices(targetId = null) {
  try {
    const whereClause = {
      isPriceCombined: true,
      basePriceRMB: { gt: 0 },
      price: { gt: 0 }
    };

    if (targetId) {
      whereClause.id = targetId;
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: { variants: true }
    });

    console.log(`Found ${products.length} products to check.`);

    for (const product of products) {
      if (!product.variants || product.variants.length === 0) continue;

      const impliedRate = product.price / product.basePriceRMB;
      console.log(`Processing Product ${product.id} (${product.name})`);
      console.log(`  Main Price: ${product.price}, RMB: ${product.basePriceRMB}, Rate: ${impliedRate.toFixed(4)}`);

      for (const variant of product.variants) {
        if (!variant.basePriceRMB || variant.basePriceRMB <= 0) continue;

        const expectedPriceRaw = variant.basePriceRMB * impliedRate;
        const expectedPrice = Math.ceil(expectedPriceRaw / 250) * 250;

        // Check if update is needed (allow small difference due to rounding)
        if (Math.abs(variant.price - expectedPrice) > 500) {
          console.log(`  Variant ${variant.id}: Current ${variant.price} -> New ${expectedPrice} (RMB ${variant.basePriceRMB})`);
          
          await prisma.productVariant.update({
            where: { id: variant.id },
            data: { 
              price: expectedPrice,
              isPriceCombined: true 
            }
          });
        } else {
          console.log(`  Variant ${variant.id}: OK (${variant.price})`);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get ID from command line arg if present
const targetId = process.argv[2] ? parseInt(process.argv[2]) : null;
fixVariantPrices(targetId);
