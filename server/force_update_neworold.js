
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateOne() {
  try {
    console.log('Connecting...');
    // Try to update product 34282 (from previous log)
    const updated = await prisma.product.update({
      where: { id: 34282 },
      data: { neworold: false } // Set to Used
    });
    console.log('Updated product 34282 to Used:', updated.neworold);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

updateOne();
