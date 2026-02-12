import prisma from '../prismaClient.js';

async function main() {
  try {
    const product = await prisma.product.findUnique({
      where: { id: 7653 }
    });
    console.log(product);
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
