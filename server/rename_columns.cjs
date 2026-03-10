
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Checking columns before...');
    // ... (check columns logic)

    console.log('Renaming basePriceRMB to basePriceIQD in Product...');
    try {
        await prisma.$executeRaw`ALTER TABLE "Product" RENAME COLUMN "basePriceRMB" TO "basePriceIQD";`;
        console.log('Success renaming Product column.');
    } catch (e) {
        console.log('Error renaming Product column (might not exist or already renamed):', e.message);
    }

    console.log('Renaming basePriceRMB to basePriceIQD in ProductVariant...');
    try {
        await prisma.$executeRaw`ALTER TABLE "ProductVariant" RENAME COLUMN "basePriceRMB" TO "basePriceIQD";`;
        console.log('Success renaming ProductVariant column.');
    } catch (e) {
        console.log('Error renaming ProductVariant column (might not exist or already renamed):', e.message);
    }

    console.log('Dropping isPriceCombined from Product...');
    try {
        await prisma.$executeRaw`ALTER TABLE "Product" DROP COLUMN IF EXISTS "isPriceCombined";`;
        console.log('Success dropping isPriceCombined from Product.');
    } catch (e) {
        console.log('Error dropping isPriceCombined from Product:', e.message);
    }

    console.log('Dropping isPriceCombined from ProductVariant...');
    try {
        await prisma.$executeRaw`ALTER TABLE "ProductVariant" DROP COLUMN IF EXISTS "isPriceCombined";`;
        console.log('Success dropping isPriceCombined from ProductVariant.');
    } catch (e) {
        console.log('Error dropping isPriceCombined from ProductVariant:', e.message);
    }

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
