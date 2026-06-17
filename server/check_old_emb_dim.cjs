const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  // Get one sample embedding and count commas to determine dimensions
  const row = await prisma.$queryRaw`
    SELECT id, embedding::text as emb FROM "Product" WHERE embedding IS NOT NULL LIMIT 1
  `;
  if (row.length > 0) {
    const vec = row[0].emb.replace(/[\[\]]/g, '').split(',').map(Number);
    console.log(`Product ${row[0].id}: ${vec.length} dimensions`);
    console.log(`First 5 values: [${vec.slice(0, 5).join(', ')}]`);
    console.log(`Text length: ${row[0].emb.length}`);
  }

  // Also check the column type
  const colType = await prisma.$queryRaw`
    SELECT a.atttypmod as dim
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE c.relname = 'Product' AND a.attname = 'embedding' AND a.attnum > 0
  `;
  console.log(`\nColumn definition: vector(${colType[0].dim})`);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
