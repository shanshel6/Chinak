import { buildCategoryIndex } from '../services/categoryService.js';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  // Check seed file
  const idx = buildCategoryIndex();
  console.log(`Seed file has ${idx.list.length} categories`);
  console.log('First 5 categories:', idx.list.slice(0, 5).map(c => ({ id: c.id, slug: c.slug, nameAr: c.nameAr })));
  
  // Check DB for assigned slugs
  const rows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "aiMetadata"->>'categorySlug' AS slug
    FROM "Product"
    WHERE "aiMetadata"->>'categorySlug' IS NOT NULL
      AND "aiMetadata"->>'categorySlug' != ''
      AND "aiMetadata"->>'categorySlug' != 'other'
  `);
  const assignedSlugs = new Set((rows || []).map(r => String(r.slug).trim()).filter(Boolean));
  console.log(`\nDB has ${assignedSlugs.size} assigned slugs:`, [...assignedSlugs]);
  
  // Check overlap
  const seedSlugs = new Set(idx.list.map(c => c.id));
  const overlap = [...assignedSlugs].filter(s => seedSlugs.has(s));
  const missing = [...assignedSlugs].filter(s => !seedSlugs.has(s));
  console.log(`\nOverlap: ${overlap.length} slugs match between DB and seed`);
  console.log(`Missing in seed: ${missing.length} slugs`, missing);
  
  await prisma.$disconnect();
}

main().catch(console.error);
