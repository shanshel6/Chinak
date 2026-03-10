const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    console.log("Adding column basePriceRMB...");
    await prisma.$executeRawUnsafe('ALTER TABLE "ProductVariant" ADD COLUMN "basePriceRMB" DOUBLE PRECISION;');
    console.log("Column added successfully");
  } catch(e) { 
    if (e.message.includes('already exists')) {
        console.log("Column already exists");
    } else {
        console.error(e); 
    }
  }
  finally { await prisma.$disconnect(); }
}
main();
