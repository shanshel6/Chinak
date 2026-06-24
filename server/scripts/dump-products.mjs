import prisma from '../prismaClient.js';
import fs from 'fs';

async function main() {
  const ids = [379, 383, 384, 381, 386, 387, 385, 388, 390, 391, 392, 394, 395, 396];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      description: true,
      purchaseUrl: true,
      image: true,
      images: { select: { url: true }, orderBy: { order: 'asc' } },
      aiMetadata: true
    },
    orderBy: { id: 'asc' }
  });
  fs.writeFileSync('d:/mynewproject2/sample-products.json', JSON.stringify(products, null, 2), 'utf8');
  console.log(`Saved ${products.length} products to sample-products.json`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });