import prisma from './server/prismaClient.js';

async function test() {
  console.log('Querying...');
  try {
    const uncertainProducts = await prisma.product.findMany({
      where: {
        OR: [
          { aiMetadata: { path: ['categorySlug'], equals: 'other' } },
          { aiMetadata: { path: ['categoryScore'], lt: 25 } }
        ]
      },
      select: {
        id: true,
      },
      take: 1
    });
    console.log(uncertainProducts);
  } catch (e) {
    console.error(e.message);
  } finally {
    await prisma.$disconnect();
  }
}
test();