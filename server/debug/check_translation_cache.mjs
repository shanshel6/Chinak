// Debug script: inspect what the server-side translation cache holds for "مفتاح"
// and what a fresh AI translation returns. Run with:
//   node debug/check_translation_cache.mjs

import prisma from '../prismaClient.js';
import { translateArabicToEnglish } from '../services/aiService.js';

const queries = ['مفتاح', 'مفتاح كهربائي', 'switch', 'key'];

async function main() {
  try {
    console.log('--- translation cache rows ---');
    const cached = await prisma.translationCache.findMany({
      where: { arabicQuery: { in: queries } },
    });
    if (cached.length === 0) {
      console.log('(no cache hits for any of:', queries.join(', '), ')');
    } else {
      for (const row of cached) {
        console.log(`  "${row.arabicQuery}" → "${row.englishTranslation}"   (hits=${row.hitCount}, updated=${row.updatedAt.toISOString()})`);
      }
    }

    console.log('\n--- fresh AI translations ---');
    for (const q of queries) {
      const t = await translateArabicToEnglish(q);
      console.log(`  "${q}" → "${t}"`);
    }
  } catch (e) {
    console.error('debug failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();