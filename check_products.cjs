const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.product.count();
  console.log(`Total products: ${count}`);
  const latest = await prisma.product.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { name: true, price: true, videoUrl: true, purchaseUrl: true }
  });
  console.log('Latest 5 products:');
  console.log(JSON.stringify(latest, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
