const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM "Product" 
    WHERE "aiMetadata"->>'categorySlug' IS NOT NULL 
      AND "aiMetadata"->>'categorySlug' != ''
  `);
  console.log('Products with categories:', rows[0].c);
  
  const slugs = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "aiMetadata"->>'categorySlug' as slug, COUNT(*) as cnt
    FROM "Product"
    WHERE "aiMetadata"->>'categorySlug' IS NOT NULL
      AND "aiMetadata"->>'categorySlug' != ''
    GROUP BY "aiMetadata"->>'categorySlug'
    ORDER BY cnt DESC
  `);
  console.log('\nCategory slugs in DB:');
  for (const r of slugs) {
    console.log(`  ${r.slug}: ${r.c} products`);
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
