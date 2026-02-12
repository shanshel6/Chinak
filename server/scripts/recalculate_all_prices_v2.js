import prisma from '../prismaClient.js';

async function main() {
  try {
    console.log('Starting price recalculation for ALL products and variants...');
    
    // Fetch all products
    const products = await prisma.product.findMany({
      include: {
        variants: true
      }
    });

    console.log(`Found ${products.length} products to process.`);

    let updatedProducts = 0;
    let updatedVariants = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const domesticFee = product.domesticShippingFee || 0;
      
      // Calculate new product price
      let newProductPrice = product.price;
      let shouldUpdateProduct = false;

      if (product.basePriceRMB && product.basePriceRMB > 0) {
        const rawCost = product.basePriceRMB;
        const calculated = (rawCost + domesticFee) * 1.15;
        newProductPrice = Math.ceil(calculated / 250) * 250;
        
        if (newProductPrice !== product.price) {
            shouldUpdateProduct = true;
        }
      }

      // Update variants
      for (const variant of product.variants) {
        let newVariantPrice = variant.price;
        let shouldUpdateVariant = false;

        if (variant.basePriceRMB && variant.basePriceRMB > 0) {
           const rawCost = variant.basePriceRMB;
           const calculated = (rawCost + domesticFee) * 1.15;
           newVariantPrice = Math.ceil(calculated / 250) * 250;
           
           if (newVariantPrice !== variant.price) {
               shouldUpdateVariant = true;
           }
        }

        if (shouldUpdateVariant) {
          await prisma.productVariant.update({
            where: { id: variant.id },
            data: { price: newVariantPrice }
          });
          updatedVariants++;
        }
      }

      if (shouldUpdateProduct) {
        await prisma.product.update({
          where: { id: product.id },
          data: { price: newProductPrice }
        });
        updatedProducts++;
      }
      
      if (i % 100 === 0) {
          process.stdout.write(`Processed ${i + 1}/${products.length} products...\r`);
      }
    }

    console.log('\nRecalculation complete.');
    console.log(`Updated ${updatedProducts} products.`);
    console.log(`Updated ${updatedVariants} variants.`);

  } catch (error) {
    console.error('Error updating prices:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
