const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Product' 
      AND column_name = 'isPriceCombined'
    `;
    console.log('Product columns:', columns);
    
    const variantColumns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'ProductVariant' 
      AND column_name = 'isPriceCombined'
    `;
    console.log('ProductVariant columns:', variantColumns);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
