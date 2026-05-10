import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();

const tryLoadJson = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) return null;
    return parsed;
  } catch (err) {
    console.log(`  Failed to load ${filePath}: ${err.message}`);
    return null;
  }
};

async function main() {
  console.log('========== CATEGORY SOURCE ANALYSIS ==========\n');

  // 1. Load canonical-categories.seed.json (from run_assign_categories)
  const seedPath = path.join(__dirname, 'canonical-categories.seed.json');
  const seedData = tryLoadJson(seedPath);
  const seedCategories = Array.isArray(seedData) ? seedData : [];
  const seedSlugs = new Set(seedCategories.map(c => String(c.slug || c.id || '').trim()).filter(Boolean));
  console.log(`[1] canonical-categories.seed.json (from run_assign_categories):`);
  console.log(`    Status: ${seedData ? 'Found' : 'Not found'}`);
  console.log(`    Total categories: ${seedCategories.length}`);
  console.log(`    Slugs: ${seedSlugs.size}\n`);

  // 2. Load all_categories_full.json (old categories)
  const oldPath = path.join(__dirname, '..', 'all_categories_full.json');
  const oldData = tryLoadJson(oldPath);
  let oldCategories = [];
  let oldSlugs = new Set();
  
  if (oldData) {
    // Flatten the tree structure
    const flatten = (nodes, prefix = '') => {
      for (const node of nodes) {
        const id = String(node.id || node.slug || '').trim();
        if (id) oldSlugs.add(id);
        if (node.children && node.children.length > 0) {
          flatten(node.children, prefix ? `${prefix} > ${node.nameAr}` : node.nameAr);
        }
      }
    };
    if (Array.isArray(oldData)) {
      flatten(oldData);
      oldCategories = oldData;
    }
  }
  
  console.log(`[2] all_categories_full.json (old categories):`);
  console.log(`    Status: ${oldData ? 'Found' : 'Not found'}`);
  console.log(`    Total categories (flattened): ${oldSlugs.size}\n`);

  // 3. Query database for assigned categories
  const dbRows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT
      "aiMetadata"->>'categorySlug' as slug,
      "aiMetadata"->>'categoryNameAr' as nameAr,
      "aiMetadata"->>'categoryNameEn' as nameEn,
      "aiMetadata"->>'categorySource' as source
    FROM "Product"
    WHERE "aiMetadata"->>'categorySlug' IS NOT NULL
      AND "aiMetadata"->>'categorySlug' != ''
      AND "aiMetadata"->>'categorySlug' != 'other'
  `);
  
  const dbSlugs = new Set(dbRows.map(r => String(r.slug || '').trim()).filter(Boolean));
  console.log(`[3] Database assigned categories:`);
  console.log(`    Total unique slugs in DB: ${dbSlugs.size}`);
  
  const sourceCounts = {};
  dbRows.forEach(r => {
    const source = r.source || 'unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });
  console.log(`    By source:`);
  Object.entries(sourceCounts).forEach(([source, count]) => {
    console.log(`      - ${source}: ${count}`);
  });
  console.log();

  // 4. Compare and categorize
  console.log('========== COMPARISON ==========\n');
  
  const fromBatFile = [...dbSlugs].filter(slug => seedSlugs.has(slug));
  const fromOldFile = [...dbSlugs].filter(slug => oldSlugs.has(slug));
  const fromBoth = [...dbSlugs].filter(slug => seedSlugs.has(slug) && oldSlugs.has(slug));
  const dbOnly = [...dbSlugs].filter(slug => !seedSlugs.has(slug) && !oldSlugs.has(slug));
  
  console.log(`Categories in DB that are in canonical-categories.seed.json (from bat file): ${fromBatFile.length}`);
  console.log(`Categories in DB that are in all_categories_full.json (old file): ${fromOldFile.length}`);
  console.log(`Categories in DB that are in BOTH files: ${fromBoth.length}`);
  console.log(`Categories in DB that are in NEITHER file (AI-discovered or custom): ${dbOnly.length}`);
  console.log();

  // 5. Show details
  if (fromBatFile.length > 0) {
    console.log('--- Categories from bat file (canonical-categories.seed.json) ---');
    fromBatFile.slice(0, 20).forEach(slug => {
      const row = dbRows.find(r => r.slug === slug);
      console.log(`  - ${slug} (${row?.nameAr || 'no name'}) [source: ${row?.source || 'unknown'}]`);
    });
    if (fromBatFile.length > 20) console.log(`  ... and ${fromBatFile.length - 20} more`);
    console.log();
  }

  if (fromOldFile.length > 0) {
    console.log('--- Categories from old file (all_categories_full.json) ---');
    fromOldFile.slice(0, 20).forEach(slug => {
      const row = dbRows.find(r => r.slug === slug);
      console.log(`  - ${slug} (${row?.nameAr || 'no name'}) [source: ${row?.source || 'unknown'}]`);
    });
    if (fromOldFile.length > 20) console.log(`  ... and ${fromOldFile.length - 20} more`);
    console.log();
  }

  if (fromBoth.length > 0) {
    console.log('--- Categories in BOTH files ---');
    fromBoth.slice(0, 10).forEach(slug => {
      const row = dbRows.find(r => r.slug === slug);
      console.log(`  - ${slug} (${row?.nameAr || 'no name'}) [source: ${row?.source || 'unknown'}]`);
    });
    if (fromBoth.length > 10) console.log(`  ... and ${fromBoth.length - 10} more`);
    console.log();
  }

  if (dbOnly.length > 0) {
    console.log('--- Categories ONLY in database (NOT in seed file) ---');
    console.log(`Total: ${dbOnly.length}`);
    console.log();
    
    // Group by source
    const bySource = {};
    dbOnly.forEach(slug => {
      const row = dbRows.find(r => r.slug === slug);
      const source = row?.source || 'unknown';
      if (!bySource[source]) bySource[source] = [];
      bySource[source].push({ slug, nameAr: row?.nameAr, nameEn: row?.nameEn });
    });
    
    Object.entries(bySource).forEach(([source, items]) => {
      console.log(`Source: ${source} (${items.length} categories)`);
      items.forEach(item => {
        console.log(`  - ${item.slug} (${item.nameAr || 'no name'})`);
      });
      console.log();
    });
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
