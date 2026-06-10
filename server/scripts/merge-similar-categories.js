/**
 * merge-similar-categories.js
 *
 * Detects and merges categories whose name embeddings are very similar.
 *
 * Usage:
 *   node scripts/merge-similar-categories.js              # dry-run, just show duplicates
 *   node scripts/merge-similar-categories.js --threshold 0.80  # lower = more matches
 *   node scripts/merge-similar-categories.js --auto        # auto-merge without asking
 *   node scripts/merge-similar-categories.js --auto --threshold 0.90
 */

import prisma from '../prismaClient.js';
import fs from 'fs';
import path from 'path';

// ── Config ───────────────────────────────────────────────────────────────────
const DRY_RUN = !process.argv.includes('--auto');
const thresholdArg = process.argv.findIndex(a => a === '--threshold');
const THRESHOLD = thresholdArg >= 0 ? parseFloat(process.argv[thresholdArg + 1]) : 0.85;

const REPORT_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'similar-categories-report.json'
);

// ── Cosine similarity ────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Merge two categories (keepId survives, mergeId is deleted) ───────────────
async function mergeCategories(keepId, mergeId) {
  const keepCat = await prisma.category.findUnique({ where: { id: keepId } });
  const mergeCat = await prisma.category.findUnique({ where: { id: mergeId } });

  if (!keepCat || !mergeCat) {
    console.error(`  ✗ Category not found: keep=${keepId}, merge=${mergeId}`);
    return false;
  }

  console.log(`  Merging: [${mergeId}] "${mergeCat.nameAr}" (${mergeCat.nameEn})`);
  console.log(`       →  [${keepId}] "${keepCat.nameAr}" (${keepCat.nameEn})`);

  // Count products being moved
  const productCount = await prisma.product.count({ where: { categoryId: mergeId } });
  console.log(`  Moving ${productCount} products...`);

  if (!DRY_RUN) {
    // Move all products from mergeId → keepId
    await prisma.product.updateMany({
      where: { categoryId: mergeId },
      data: { categoryId: keepId }
    });

    // Delete the duplicate category
    await prisma.category.delete({ where: { id: mergeId } });

    console.log(`  ✓ Merged and deleted category [${mergeId}]`);
  } else {
    console.log(`  (dry-run — no changes made)`);
  }

  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  Similar Category Detector & Merger');
  console.log('========================================\n');
  console.log(`  Mode:      ${DRY_RUN ? 'DRY-RUN (preview only)' : 'AUTO-MERGE'}`);
  console.log(`  Threshold: ${THRESHOLD} (cosine similarity)\n`);

  // 1. Load all categories that have embeddings
  const rows = await prisma.$queryRaw`
    SELECT c.id,
           c.slug,
           c."name_ar"      AS "nameAr",
           c."name_en"      AS "nameEn",
           c."name_embedding" AS "nameEmbedding",
           COUNT(p.id)       AS product_count
    FROM "categories" c
    LEFT JOIN "Product" p ON p."categoryId" = c.id
    WHERE c."name_embedding" IS NOT NULL
    GROUP BY c.id, c.slug, c."name_ar", c."name_en", c."name_embedding"
    ORDER BY c.id
  `;

  if (rows.length === 0) {
    console.log('✗ No categories with embeddings found.');
    console.log('  Run the category fixer first to generate embeddings.\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`Loaded ${rows.length} categories with embeddings.\n`);

  // 2. Parse embeddings
  const categories = rows.map(r => ({
    id: r.id,
    slug: r.slug,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    productCount: Number(r.product_count),
    vector: JSON.parse(r.nameEmbedding)
  }));

  // 3. Compute pairwise similarities (upper triangle only)
  console.log(`Computing pairwise similarities (threshold ≥ ${THRESHOLD})...\n`);

  const similarPairs = [];
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const sim = cosineSimilarity(categories[i].vector, categories[j].vector);
      if (sim >= THRESHOLD) {
        similarPairs.push({
          catA: categories[i],
          catB: categories[j],
          similarity: sim
        });
      }
    }
  }

  // Sort by similarity descending (most similar first)
  similarPairs.sort((a, b) => b.similarity - a.similarity);

  if (similarPairs.length === 0) {
    console.log(`✓ No similar category pairs found above threshold ${THRESHOLD}.`);
    console.log('  Try lowering the threshold if you expect duplicates.\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${similarPairs.length} similar pair(s):\n`);

  // 4. Display pairs
  for (let i = 0; i < similarPairs.length; i++) {
    const { catA, catB, similarity } = similarPairs[i];
    console.log(`  [${i + 1}] similarity: ${similarity.toFixed(4)}`);
    console.log(`      A: [${catA.id}] "${catA.nameAr}" (${catA.nameEn}) — ${catA.productCount} products`);
    console.log(`      B: [${catB.id}] "${catB.nameAr}" (${catB.nameEn}) — ${catB.productCount} products`);
    console.log();
  }

  // 5. Save report
  const report = {
    generatedAt: new Date().toISOString(),
    threshold: THRESHOLD,
    totalCategories: categories.length,
    similarPairs: similarPairs.map(p => {
      // eslint-disable-next-line no-unused-vars
      const { vector: _a, ...catA } = p.catA;
      // eslint-disable-next-line no-unused-vars
      const { vector: _b, ...catB } = p.catB;
      return { catA, catB, similarity: p.similarity };
    })
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${REPORT_FILE}\n`);

  if (DRY_RUN) {
    console.log('========================================');
    console.log('  DRY-RUN COMPLETE');
    console.log('========================================');
    console.log(`  Found ${similarPairs.length} pair(s) to merge.`);
    console.log('  Run with --auto to actually merge them.');
    console.log('  Run with --threshold 0.XX to adjust sensitivity.\n');
    console.log('  Examples:');
    console.log('    node scripts/merge-similar-categories.js --auto');
    console.log('    node scripts/merge-similar-categories.js --auto --threshold 0.90');
    console.log('    node scripts/merge-similar-categories.js --threshold 0.75\n');
    await prisma.$disconnect();
    return;
  }

  // 6. Auto-merge: keep the category with more products, merge the other
  console.log('========================================');
  console.log('  AUTO-MERGING');
  console.log('========================================\n');

  let merged = 0;
  let errors = 0;
  const mergedIds = new Set(); // track already-merged IDs to skip

  for (const pair of similarPairs) {
    // Skip if either category was already merged
    if (mergedIds.has(pair.catA.id) || mergedIds.has(pair.catB.id)) {
      console.log(`  Skipping pair (already merged): [${pair.catA.id}] ↔ [${pair.catB.id}]`);
      continue;
    }

    // Keep the one with more products (more "important")
    const keep = pair.catA.productCount >= pair.catB.productCount ? pair.catA : pair.catB;
    const merge = keep.id === pair.catA.id ? pair.catB : pair.catA;

    console.log(`\n[${merged + 1}/${similarPairs.length}] Merging pair (sim: ${pair.similarity.toFixed(4)}):`);
    const success = await mergeCategories(keep.id, merge.id);
    if (success) {
      merged++;
      mergedIds.add(merge.id);
    } else {
      errors++;
    }

    // Small delay
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n========================================');
  console.log('  MERGE COMPLETE');
  console.log('========================================');
  console.log(`  Merged: ${merged} categories`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Remaining pairs skipped: ${similarPairs.length - merged - errors}`);
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Fatal error:', e);
  prisma.$disconnect();
  process.exit(1);
});
