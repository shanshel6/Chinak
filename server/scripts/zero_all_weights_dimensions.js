import prisma from '../prismaClient.js';

async function main() {
  try {
    console.log('Zeroing out weight and dimensions for all products...');
    
    // Update all products
    const productUpdate = await prisma.product.updateMany({
      data: {
        weight: 0,
        length: 0,
        width: 0,
        height: 0
      }
    });
    console.log(`Updated ${productUpdate.count} products.`);

    console.log('Zeroing out weight and dimensions for all variants...');
    
    // Update all variants
    const variantUpdate = await prisma.productVariant.updateMany({
      data: {
        weight: 0,
        length: 0,
        width: 0,
        height: 0
      }
    });
    console.log(`Updated ${variantUpdate.count} variants.`);

  } catch (error) {
    console.error('Error updating products/variants:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
