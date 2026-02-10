
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkLatestVariants() {
  try {
    const product = await prisma.product.findFirst({
      where: { name: { contains: "كريم ياشوانغ" } },
      include: { variants: true }
    });
    
    if (!product) {
      console.log('Product not found');
      return;
    }

    console.log(`Product: ${product.name} (ID: ${product.id})`);
    console.log(`Product Price: ${product.price}`);
    console.log(`Product BasePriceRMB: ${product.basePriceRMB}`);
    
    console.log('\nVariants:');
    product.variants.forEach(v => {
      console.log(`- ID: ${v.id}, Combo: ${v.combination}, Price: ${v.price}, BasePriceRMB: ${v.basePriceRMB}, isCombined: ${v.isPriceCombined}`);
    });

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkLatestVariants();
