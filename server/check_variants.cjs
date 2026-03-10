
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkVariants() {
  try {
    // ID 7529
    const product = await prisma.product.findUnique({
      where: { id: 7529 },
      include: { variants: true }
    });

    if (!product) {
      console.log('Product 7529 not found');
      return;
    }

    console.log(`Product: ${product.name} (ID: ${product.id})`);
    console.log(`Main - Price: ${product.price}, BaseRMB: ${product.basePriceRMB}, Combined: ${product.isPriceCombined}`);
    
    if (product.variants.length > 0) {
      console.log('Variants:');
      product.variants.forEach(v => {
        console.log(`  ID: ${v.id}, Price: ${v.price}, BaseRMB: ${v.basePriceRMB}, Combined: ${v.isPriceCombined}`);
      });
    } else {
      console.log('No variants found.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkVariants();
