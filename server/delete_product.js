
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const name = "ركنة حديد (زاوية) ستانلس ثخينة - لتقوية الكنتورات والأثاث";
  const url = "http://detail.m.1688.com/page/index.html?offerId=567402067238";
  
  const products = await prisma.product.findMany({
    where: { 
      OR: [
        { name },
        { purchaseUrl: url },
        { id: 7284 }
      ]
    },
    select: { id: true, name: true }
  });
  
  if (products.length === 0) {
    console.log('No products found to delete');
    return;
  }

  const ids = products.map(p => p.id);
  console.log(`Deleting ${ids.length} products:`, ids);

  await prisma.productOption.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productImage.deleteMany({ where: { productId: { in: ids } } });
  // Add other related tables if needed (OrderItem, Review, etc.)
  // But for a fresh import, these are likely the main ones.
  
  const deleted = await prisma.product.deleteMany({
    where: { id: { in: ids } }
  });
  console.log(`Deleted ${deleted.count} products`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
