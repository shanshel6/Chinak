// Check what's actually in the translation cache and whether the
// AI translator is returning real English. Run:
//   DATABASE_URL=<your-prod-url> node server/debug/dump_translation_cache.mjs
// If you don't have DATABASE_URL, the script will try the local one.

import prisma from '../prismaClient.js';
import { translateArabicToEnglish } from '../services/aiService.js';

const WORDS = ['مفتاح', 'بدلة سباحة', 'هاتف محمول', 'حذاء رياضي', 'كابل شحن'];

async function main() {
  console.log('--- cache rows for:', WORDS.join(', '));
  const cached = await prisma.translationCache.findMany({
    where: { arabicQuery: { in: WORDS } },
    orderBy: { updatedAt: 'desc' },
  });
  if (cached.length === 0) {
    console.log('  (no cache rows)');
  } else {
    for (const r of cached) {
      const looksBroken = r.englishTranslation === r.arabicQuery || /^[\u0600-\u06FF]/.test(r.englishTranslation);
      console.log(`  [${looksBroken ? '❌ BROKEN' : 'OK  '}] "${r.arabicQuery}" → "${r.englishTranslation}"   (hits=${r.hitCount})`);
    }
  }

  console.log('\n--- fresh AI translations for those words ---');
  for (const w of WORDS) {
    const t = await translateArabicToEnglish(w);
    const looksBroken = t === w || /^[\u0600-\u06FF]/.test(t);
    console.log(`  [${looksBroken ? '❌ BROKEN' : 'OK  '}] "${w}" → "${t}"`);
  }

  console.log('\n--- how many broken entries are in the whole cache? ---');
  const sample = await prisma.translationCache.findMany({ take: 500, orderBy: { updatedAt: 'desc' } });
  let broken = 0;
  for (const r of sample) {
    if (r.englishTranslation === r.arabicQuery || /^[\u0600-\u06FF]/.test(r.englishTranslation)) broken++;
  }
  console.log(`  ${broken} of ${sample.length} most-recent rows look broken (Arabic returned as English)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());