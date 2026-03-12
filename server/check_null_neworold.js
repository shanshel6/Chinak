
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    console.log('Connecting to DB...');
    const total = await prisma.product.count();
    const withNewOrOld = await prisma.product.count({
      where: {
        neworold: { not: null }
      }
    });
    
    console.log(`Total Products: ${total}`);
    console.log(`Products with neworold set: ${withNewOrOld}`);
    
    if (withNewOrOld > 0) {
      const sample = await prisma.product.findFirst({
        where: { neworold: { not: null } },
        select: { id: true, name: true, neworold: true }
      });
      console.log('Sample product with neworold:', sample);
    } else {
      console.log('WARNING: No products have neworold set!');
    }

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
