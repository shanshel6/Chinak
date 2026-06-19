import prisma from '../prismaClient.js';

async function main() {
  try {
    // Show what we're about to clear
    const total = await prisma.translationCache.count();
    const sample = await prisma.translationCache.findMany({
      take: 20,
      orderBy: { updatedAt: 'desc' }
    });
    console.log(`Found ${total} cached translations.`);
    console.log('Most recent 20 entries:');
    for (const entry of sample) {
      console.log(`  "${entry.arabicQuery}" → "${entry.englishTranslation}"  (hits: ${entry.hitCount})`);
    }

    // Delete all cached translations so the updated prompt is used fresh
    const deleted = await prisma.translationCache.deleteMany({});
    console.log(`Deleted ${deleted.count} cached translations.`);
    console.log('Cache cleared. Next search will use the new prompt.');
  } catch (error) {
    console.error('Error clearing translation cache:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
