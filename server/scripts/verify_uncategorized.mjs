import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Check products before ID 21918 that still have categories
  const withCategories = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as count
    FROM "Product"
    WHERE id < 21918
      AND "aiMetadata"->>'categorySlug' IS NOT NULL
      AND "aiMetadata"->>'categorySlug' != ''
      AND "aiMetadata"->>'categorySlug' != 'other'
  `);

  // Check products before ID 21918 that are uncategorized
  const withoutCategories = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as count
    FROM "Product"
    WHERE id < 21918
      AND (
        "aiMetadata" IS NULL
        OR "aiMetadata" = '{}'::jsonb
        OR "aiMetadata"->>'categorySlug' IS NULL
        OR "aiMetadata"->>'categorySlug' = ''
        OR "aiMetadata"->>'categorySlug' = 'other'
      )
  `);

  // Total products before ID 21918
  const total = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as count FROM "Product" WHERE id < 21918
  `);

  console.log(`Products before ID 21918:`);
  console.log(`  Total: ${total[0].count}`);
  console.log(`  With categories: ${withCategories[0].count}`);
  console.log(`  Without categories: ${withoutCategories[0].count}`);
  console.log();

  // Show some example uncategorized products
  const examples = await prisma.$queryRawUnsafe(`
    SELECT id, name
    FROM "Product"
    WHERE id < 21918
      AND (
        "aiMetadata" IS NULL
        OR "aiMetadata" = '{}'::jsonb
        OR "aiMetadata"->>'categorySlug' IS NULL
        OR "aiMetadata"->>'categorySlug' = ''
      )
    LIMIT 5
  `);

  console.log('Example uncategorized products:');
  examples.forEach(p => console.log(`  - ID ${p.id}: ${p.name?.substring(0, 50)}`));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
