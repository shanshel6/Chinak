
console.log('Starting rename_cols_v2...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Renaming basePriceRMB to basePriceIQD in Product...');
    try {
        const res = await prisma.$executeRaw`ALTER TABLE "Product" RENAME COLUMN "basePriceRMB" TO "basePriceIQD";`;
        console.log('Success renaming Product column. Result:', res);
    } catch (e) {
        console.log('Error renaming Product column:', e.message);
    }

    console.log('Renaming basePriceRMB to basePriceIQD in ProductVariant...');
    try {
        const res = await prisma.$executeRaw`ALTER TABLE "ProductVariant" RENAME COLUMN "basePriceRMB" TO "basePriceIQD";`;
        console.log('Success renaming ProductVariant column. Result:', res);
    } catch (e) {
        console.log('Error renaming ProductVariant column:', e.message);
    }

    console.log('Dropping isPriceCombined from Product...');
    try {
        const res = await prisma.$executeRaw`ALTER TABLE "Product" DROP COLUMN IF EXISTS "isPriceCombined";`;
        console.log('Success dropping isPriceCombined from Product. Result:', res);
    } catch (e) {
        console.log('Error dropping isPriceCombined from Product:', e.message);
    }

    console.log('Dropping isPriceCombined from ProductVariant...');
    try {
        const res = await prisma.$executeRaw`ALTER TABLE "ProductVariant" DROP COLUMN IF EXISTS "isPriceCombined";`;
        console.log('Success dropping isPriceCombined from ProductVariant. Result:', res);
    } catch (e) {
        console.log('Error dropping isPriceCombined from ProductVariant:', e.message);
    }

  } catch (e) {
    console.error('Fatal Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
