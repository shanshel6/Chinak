
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLatestProducts() {
  try {
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { price: 8500 },
          { variants: { some: { price: 8500 } } }
        ]
      },
      take: 3,
      orderBy: {
        id: 'desc'
      },
      include: {
        variants: true
      }
    });
    
    console.log(JSON.stringify(products, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLatestProducts();
