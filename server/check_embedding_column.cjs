console.log('Checking embedding column...');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // Check if embedding column exists in Product table
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Product' 
      AND column_name IN ('embedding', 'imageEmbedding');
    `;
    console.log('Embedding columns in Product table:', columns);
    
    // Check the actual table structure
    const tableInfo = await prisma.$queryRaw`
      SELECT 
        column_name,
        data_type,
        udt_name,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns 
      WHERE table_name = 'Product'
      ORDER BY ordinal_position;
    `;
    console.log('\nFull Product table structure:');
    tableInfo.forEach(col => {
      console.log(`${col.column_name}: ${col.data_type} (${col.udt_name})`);
    });
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();