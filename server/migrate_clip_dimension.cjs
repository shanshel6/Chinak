/**
 * Quick schema fix to update image embedding dimensions from 1024 → 512
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Fixing image embedding dimensions...');

  // Check current dimensions
  const vectorCols = await prisma.$queryRaw`
    SELECT c.relname as table_name, a.attname as column_name, a.atttypmod as dim
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE t.typname = 'vector'
      AND c.relname IN ('Product', 'ProductImage')
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attname;
  `;

  console.log('\nCurrent columns:');
  for (const col of vectorCols) {
    console.log(`  - ${col.table_name}.${col.column_name}: ${col.dim} dims`);
  }

  // Alter columns
  const colsToFix = [
    { table: 'Product', col: 'imageEmbedding', targetDim: 512 },
    { table: 'ProductImage', col: 'imageEmbedding', targetDim: 512 },
  ];

  for (const { table, col, targetDim } of colsToFix) {
    console.log(`\nAltering ${table}.${col} to vector(${targetDim})...`);
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}"`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${col}" vector(${targetDim})`);
      console.log(`✅ ${table}.${col} updated!`);
    } catch (err) {
      console.error(`❌ Failed to alter ${table}.${col}: ${err.message}`);
    }
  }

  console.log('\n✅ Done! Database schema is ready for CLIP 512-dim embeddings!');
}

main()
  .catch(err => { console.error('❌ Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
