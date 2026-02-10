const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'ProductVariant';
    `);
    console.log(result);
  } catch(e) { console.error(e); }
  finally { await prisma.$disconnect(); }
}
main();
