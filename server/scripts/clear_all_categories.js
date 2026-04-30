const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Clearing all category assignments from aiMetadata...');
    const result = await prisma.$executeRawUnsafe(`
      UPDATE "Product"
      SET "aiMetadata" = (
        SELECT jsonb_strip_nulls(
          COALESCE("aiMetadata", '{}'::jsonb)
          - 'categorySlug'
          - 'categoryNameAr'
          - 'categoryScore'
          - 'categoryConfidence'
          - 'categorySource'
          - 'categoryAssignedAt'
        )
      )
      WHERE "aiMetadata" IS NOT NULL
    `);
    console.log(`Cleared categories for ${result.count || result} products.`);
  } catch (err) {
    console.error('Failed to clear categories:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
