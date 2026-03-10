
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkColumns() {
  try {
    console.log("Checking Product table columns...");
    const productColumns = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `;
    console.log("Product Columns:", productColumns.map(c => c.column_name));

    console.log("\nChecking ProductVariant table columns...");
    const variantColumns = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'ProductVariant';
    `;
    console.log("ProductVariant Columns:", variantColumns.map(c => c.column_name));

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkColumns();
