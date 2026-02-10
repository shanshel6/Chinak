const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: { name: { contains: 'ركنة' } },
    select: { 
      id: true, 
      name: true, 
      price: true, 
      basePriceRMB: true, 
      isPriceCombined: true,
      variants: {
        select: { id: true, price: true }
      }
    }
  });
  console.log(JSON.stringify(products, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
