
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  const products = await prisma.product.findMany({
    where: {
      isPriceCombined: true,
      basePriceRMB: { gt: 0 },
      price: { gt: 0 },
      variants: { some: {} }
    },
    include: { variants: true },
    take: 5
  });

  for (const p of products) {
    console.log(`Product ${p.id}: Price ${p.price}, RMB ${p.basePriceRMB}`);
    p.variants.forEach(v => {
      console.log(`  Variant ${v.id}: Price ${v.price}, RMB ${v.basePriceRMB}, Combined ${v.isPriceCombined}`);
    });
  }
}

inspect();
