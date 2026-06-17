console.log('Testing database connection...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Testing connection...');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('Connection test result:', result);
    
    // Check Product table columns
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Product';
    `;
    console.log('\nProduct table columns:');
    columns.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });
    
  } catch (e) {
    console.error('Error:', e.message);
    console.error('Full error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();