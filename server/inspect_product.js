
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const product = await prisma.product.findUnique({
    where: { id: 7284 }
  });
  console.log(JSON.stringify(product, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
