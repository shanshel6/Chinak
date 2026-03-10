import prisma from '../prismaClient.js';

async function main() {
  try {
    const product = await prisma.product.findUnique({
      where: { id: 7654 },
      include: { variants: true }
    });
    console.log(JSON.stringify(product, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
