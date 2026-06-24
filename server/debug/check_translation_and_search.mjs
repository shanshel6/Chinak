// Comprehensive debug script for the "مفتاح" search issue.
// Run with: node server/debug/check_translation_and_search.mjs
//
// What it does:
//   1. Reads the translation cache row for "مفتاح" (if any)
//   2. Calls translateArabicToEnglish("مفتاح") fresh
//   3. Runs a raw SQL search against textEmbedding for both:
//        - the fresh translation
//        - the literal English words "key" and "switch"
//   4. Reports how many products actually have a populated textEmbedding

import prisma from '../prismaClient.js';
import { translateArabicToEnglish } from '../services/aiService.js';
import { embedText } from '../services/clipService.js';
import { vectorToSqlLiteral } from '../services/productImageVectorService.js';
import { warmupClipService } from '../services/clipService.js';

const TARGET = 'مفتاح';

function fmtVec(v) {
  if (!v) return 'null';
  return `[len=${v.length}, first 5 = ${v.slice(0, 5).map(n => n.toFixed(4)).join(', ')}]`;
}

async function searchTextVector(vector, limit = 5) {
  const safeVector = vector.length === 512
    ? vector
    : (() => { const padded = [...vector]; while (padded.length < 512) padded.push(0); return padded.slice(0, 512); })();
  const vectorLiteral = vectorToSqlLiteral(safeVector);
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        p.id,
        p.name,
        (p."textEmbedding" <=> $1::vector) AS distance,
        1 - (p."textEmbedding" <=> $1::vector) AS similarity
      FROM "Product" p
      WHERE p."textEmbedding" IS NOT NULL
        AND p."status" = 'PUBLISHED'
        AND p."isActive" = true
      ORDER BY distance ASC
      LIMIT $2
    `,
    vectorLiteral,
    limit
  );
  return rows;
}

async function main() {
  try {
    console.log('='.repeat(70));
    console.log('1. Translation cache row for', JSON.stringify(TARGET));
    console.log('='.repeat(70));
    const cached = await prisma.translationCache.findUnique({
      where: { arabicQuery: TARGET },
    });
    if (cached) {
      console.log(`   CACHED:  "${cached.arabicQuery}" → "${cached.englishTranslation}"   (hits=${cached.hitCount}, updated=${cached.updatedAt.toISOString()})`);
    } else {
      console.log('   (no cache row for', JSON.stringify(TARGET) + ')');
    }

    console.log('\n' + '='.repeat(70));
    console.log('2. Fresh AI translation for', JSON.stringify(TARGET));
    console.log('='.repeat(70));
    const fresh = await translateArabicToEnglish(TARGET);
    console.log(`   FRESH:   "${TARGET}" → "${fresh}"`);

    console.log('\n' + '='.repeat(70));
    console.log('3. How many products have a textEmbedding populated?');
    console.log('='.repeat(70));
    const totalProducts = await prisma.product.count({ where: { status: 'PUBLISHED', isActive: true } });
    const withText = await prisma.product.count({
      where: { status: 'PUBLISHED', isActive: true, textEmbedding: { not: null } },
    });
    const withImage = await prisma.product.count({
      where: { status: 'PUBLISHED', isActive: true, imageEmbedding: { not: null } },
    });
    console.log(`   PUBLISHED+active products:                ${totalProducts}`);
    console.log(`   ... with textEmbedding populated:         ${withText}  (${((withText / totalProducts) * 100).toFixed(1)}%)`);
    console.log(`   ... with imageEmbedding populated:        ${withImage}  (${((withImage / totalProducts) * 100).toFixed(1)}%)`);

    console.log('\n' + '='.repeat(70));
    console.log('4. Raw text-vector search using the FRESH translation');
    console.log('='.repeat(70));
    await warmupClipService().catch((e) => console.warn('   (warmup failed:', e.message, ')'));
    const emb = await embedText(fresh);
    console.log('   query embedding:', fmtVec(emb));
    const results = await searchTextVector(emb, 5);
    console.log('   top 5 results:');
    for (const r of results) {
      console.log(`     id=${r.id}  sim=${Number(r.similarity).toFixed(4)}  name=${JSON.stringify(r.name).slice(0, 80)}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('5. Raw text-vector search using literal English words');
    console.log('='.repeat(70));
    for (const word of ['key', 'switch', 'electric switch', 'wrench']) {
      const e = await embedText(word);
      const r = await searchTextVector(e, 3);
      console.log(`\n   query="${word}"  embedding=${fmtVec(e)}`);
      for (const row of r) {
        console.log(`     id=${row.id}  sim=${Number(row.similarity).toFixed(4)}  name=${JSON.stringify(row.name).slice(0, 80)}`);
      }
    }
  } catch (e) {
    console.error('debug failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();