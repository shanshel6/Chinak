import prisma from '../prismaClient.js';

async function main() {
  try {
    console.log('Executing RAW SQL update for all products and variants...');

    // Update Products
    // Formula: CEIL( ((basePriceRMB + domestic) * 1.15) / 250 ) * 250
    // COALESCE ensures null domestic fees are treated as 0
    const productUpdate = await prisma.$executeRaw`
      UPDATE "Product"
      SET "price" = CEIL((("basePriceRMB" + COALESCE("domesticShippingFee", 0)) * 1.15) / 250.0) * 250
      WHERE "basePriceRMB" > 0;
    `;
    console.log(`Updated ${productUpdate} products.`);

    // Update Variants
    // Note: Variants don't usually store domesticShippingFee directly. 
    // If they rely on the parent product's domestic fee, we need a join.
    // However, the current schema doesn't seem to copy domesticFee to variants.
    // If we assume variants use the same domestic fee as the product:
    
    const variantUpdate = await prisma.$executeRaw`
      UPDATE "ProductVariant" AS v
      SET "price" = CEIL(((v."basePriceRMB" + COALESCE(p."domesticShippingFee", 0)) * 1.15) / 250.0) * 250
      FROM "Product" AS p
      WHERE v."productId" = p.id
      AND v."basePriceRMB" > 0;
    `;
    console.log(`Updated ${variantUpdate} variants.`);

  } catch (error) {
    console.error('Error executing raw update:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
