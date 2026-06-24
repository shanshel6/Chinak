
import prisma from './prismaClient.js';

async function checkProductStatus() {
  const product = await prisma.$queryRawUnsafe(
    `SELECT id, name, status, "isActive" FROM "Product" WHERE id = $1`,
    277401
  );
  console.log('Product 277401 status and isActive:', product[0]);
  await prisma.$disconnect();
}

checkProductStatus().catch(console.error);
