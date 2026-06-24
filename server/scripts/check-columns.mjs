import prisma from '../prismaClient.js';

async function main() {
  try {
    const rows = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Product' AND table_schema = 'public' ORDER BY column_name`;
    console.log('Columns in Product table:');
    rows.forEach(r => console.log('- ' + r.column_name));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();