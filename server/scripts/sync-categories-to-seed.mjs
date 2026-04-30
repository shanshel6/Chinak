import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

const SEED_PATH = path.join(__dirname, 'canonical-categories.seed.json');

function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  console.log('[Sync] Reading seed file...');
  let categories = loadJson(SEED_PATH) || [];
  const existingSlugs = new Set(categories.map(c => (c.slug || c.id || '').trim()).filter(Boolean));
  console.log(`[Sync] Seed file has ${categories.length} categories`);

  console.log('[Sync] Querying database for assigned categories...');
  const rows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT
      "aiMetadata"->>'categorySlug' as slug,
      "aiMetadata"->>'categoryNameAr' as nameAr,
      "aiMetadata"->>'categoryNameEn' as nameEn
    FROM "Product"
    WHERE "aiMetadata"->>'categorySlug' IS NOT NULL
      AND "aiMetadata"->>'categorySlug' != ''
      AND "aiMetadata"->>'categorySlug' != 'other'
  `);

  let added = 0;
  for (const row of rows) {
    const slug = String(row.slug || '').trim();
    const nameAr = String(row.nameAr || '').trim();
    const nameEn = String(row.nameEn || '').trim();
    if (!slug || existingSlugs.has(slug)) continue;

    const category = {
      slug: slug,
      id: slug,
      name_ar: nameAr || slug,
      name_en: nameEn || slug,
      path_ar: nameAr || slug,
      path_en: nameEn || slug,
      keywords: [nameAr, nameEn, slug].filter(Boolean),
      confidence: 0.8,
      source: 'db_sync'
    };
    categories.push(category);
    existingSlugs.add(slug);
    added++;
    console.log(`[Sync] Added missing category: ${slug} (${nameAr || nameEn || 'no name'})`);
  }

  if (added > 0) {
    saveJson(SEED_PATH, categories);
    console.log(`[Sync] Saved seed file with ${categories.length} categories (+${added} new)`);
  } else {
    console.log('[Sync] No new categories to add. Seed file is in sync.');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[Sync] Error:', err);
  process.exit(1);
});
