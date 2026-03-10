import prisma from '../prismaClient.js';

async function main() {
  try {
    const productId = 7654;
    const correctPrice = 2750;

    console.log(`Forcing variants for product ${productId} to price ${correctPrice}...`);

    const result = await prisma.productVariant.updateMany({
      where: { productId: productId },
      data: { price: correctPrice }
    });

    console.log(`Updated ${result.count} variants.`);

    // Verify
    const updatedVariants = await prisma.productVariant.findMany({
      where: { productId: productId },
      select: { id: true, price: true }
    });
    console.log('Verification sample:', updatedVariants.slice(0, 3));

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
