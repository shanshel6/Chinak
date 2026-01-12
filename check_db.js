import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function checkProducts() {
  const products = await prisma.product.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { options: true }
  });
  
  console.log('Recent Products:');
  products.forEach(p => {
    console.log(`- ID: ${p.id}, Name: ${p.name}, ChineseName: ${p.chineseName}, Status: ${p.status}`);
    if (p.options) {
      console.log('  Options:');
      p.options.forEach(o => {
        console.log(`    - ${o.name}: ${o.values}`);
      });
    }
  });
  
  await prisma.$disconnect();
}

checkProducts();
