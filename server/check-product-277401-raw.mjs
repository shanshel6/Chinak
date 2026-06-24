
import prisma from './prismaClient.js';

async function checkProduct() {
  const productResult = await prisma.$queryRawUnsafe(
    `SELECT id, name, "aiMetadata" FROM "Product" WHERE id = $1`,
    277401
  );
  if (productResult && productResult.length > 0) {
    console.log('Product 277401 details:');
    console.log('id:', productResult[0].id);
    console.log('name:', productResult[0].name);
    console.log('aiMetadata:', JSON.stringify(productResult[0].aiMetadata, null, 2));
  }
  await prisma.$disconnect();
}

checkProduct();
