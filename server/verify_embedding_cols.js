import prisma from './prismaClient.js';

async function main() {
  try {
    const columns = await prisma.$queryRaw`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('Product', 'ProductImage') 
      AND column_name = 'imageEmbedding';
    `;
    console.log('Columns found:', columns);

    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename IN ('Product', 'ProductImage') 
      AND indexname LIKE '%imageEmbedding%';
    `;
    console.log('Indexes found:', indexes);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
