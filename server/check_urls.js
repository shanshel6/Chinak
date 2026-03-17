import prisma from './prismaClient.js';

async function main() {
  const products = await prisma.product.findMany({
    where: { id: { in: [18597, 18598, 18599, 18600] } },
    select: { id: true, image: true }
  });
  console.log(JSON.stringify(products, null, 2));
}

main().finally(() => prisma.$disconnect());
