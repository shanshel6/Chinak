import prisma from './prismaClient.js';

console.log('Adding name_embedding column to categories table...');

try {
  // Check if column already exists
  const result = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'categories'
      AND column_name = 'name_embedding'
  `;

  if (result.length > 0) {
    console.log('✓ Column name_embedding already exists');
  } else {
    await prisma.$executeRaw`
      ALTER TABLE "categories"
      ADD COLUMN "name_embedding" TEXT
    `;
    console.log('✓ Column name_embedding added successfully');
  }
} catch (err) {
  console.error('Failed to add column:', err.message);
  process.exit(1);
}

await prisma.$disconnect();
console.log('Done.');
