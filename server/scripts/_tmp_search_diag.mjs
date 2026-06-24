import prisma from '../prismaClient.js';
import { embedText } from '../services/clipService.js';

async function main() {
  // Simulate the EXACT flow the Android app performs on a typed search:
  //   1. Arabic user query
  //   2. Translated to English (we hardcode the result here for testability)
  //   3. embedText(englishQuery) on the device (server clip here is the same model)
  //   4. POST /api/search/embedding with { embedding, type: 'text' }
  //   5. server calls searchProductsByTextVector
  //   6. compare against textEmbedding column

  const queries = [
    { ar: 'لونغ باو',  en: 'long bao' },
    { ar: 'حذاء رياضي', en: 'sports shoes' },
    { ar: 'ساعة',       en: 'watch' },
    { ar: 'سماعات',     en: 'headphones' },
  ];

  for (const { ar, en } of queries) {
    console.log(`\n========== Query: "${ar}" -> translated to "${en}" ==========`);
    const embedding = await embedText(en);
    const vecLiteral = `[${embedding.join(',')}]`;

    // A) textEmbedding search (NEW correct path)
    const textHits = await prisma.$queryRawUnsafe(
      `SELECT id, name,
         ("textEmbedding" <=> $1::vector) AS distance,
         1 - ("textEmbedding" <=> $1::vector) AS similarity
       FROM "Product"
       WHERE "textEmbedding" IS NOT NULL
         AND "status" = 'PUBLISHED'
         AND "isActive" = true
       ORDER BY "textEmbedding" <=> $1::vector ASC
       LIMIT 5`,
      vecLiteral
    );
    console.log('  textEmbedding (correct path):');
    for (const r of textHits) {
      console.log(`    id=${r.id} sim=${Number(r.similarity).toFixed(4)} | ${String(r.name).slice(0, 50)}`);
    }

    // B) imageEmbedding search (OLD buggy path) for comparison
    const imageHits = await prisma.$queryRawUnsafe(
      `SELECT id, name,
         ("imageEmbedding" <=> $1::vector) AS distance,
         1 - ("imageEmbedding" <=> $1::vector) AS similarity
       FROM "Product"
       WHERE "imageEmbedding" IS NOT NULL
         AND "status" = 'PUBLISHED'
         AND "isActive" = true
       ORDER BY "imageEmbedding" <=> $1::vector ASC
       LIMIT 3`,
      vecLiteral
    );
    console.log('  imageEmbedding (OLD path) - top 3 for comparison:');
    for (const r of imageHits) {
      console.log(`    id=${r.id} sim=${Number(r.similarity).toFixed(4)} | ${String(r.name).slice(0, 50)}`);
    }
  }

  // Sanity: count of products that have textEmbedding
  const stats = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM "Product" WHERE "textEmbedding" IS NOT NULL AND "status" = 'PUBLISHED' AND "isActive" = true) AS has_text,
       (SELECT COUNT(*)::int FROM "Product" WHERE "imageEmbedding" IS NOT NULL AND "status" = 'PUBLISHED' AND "isActive" = true) AS has_image,
       (SELECT COUNT(*)::int FROM "Product" WHERE "status" = 'PUBLISHED' AND "isActive" = true) AS total`
  );
  console.log(`\n========== Stats ==========`);
  console.log(`  total active:        ${stats[0].total}`);
  console.log(`  with textEmbedding:  ${stats[0].has_text}`);
  console.log(`  with imageEmbedding: ${stats[0].has_image}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
