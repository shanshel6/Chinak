import prisma from '../prismaClient.js';

console.log('[check_ai_data] starting');

async function checkData() {
  try {
    await prisma.$connect();
    console.log('[check_ai_data] Connected to DB');
    console.log('[check_ai_data] querying counts');
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);

    const [total] = await withTimeout(prisma.$queryRaw`SELECT count(*) as count FROM "Product"`, 15000);
    const [withMetadata] = await prisma.$queryRaw`SELECT count(*) as count FROM "Product" WHERE "aiMetadata" IS NOT NULL`;
    const [withEmbedding] = await prisma.$queryRaw`SELECT count(*) as count FROM "Product" WHERE embedding IS NOT NULL`;
    const [missingEither] = await prisma.$queryRaw`SELECT count(*) as count FROM "Product" WHERE "aiMetadata" IS NULL OR embedding IS NULL`;
    const [missingBoth] = await prisma.$queryRaw`SELECT count(*) as count FROM "Product" WHERE "aiMetadata" IS NULL AND embedding IS NULL`;

    console.log('--- AI Data Counts ---');
    console.log('Total products:', String(total.count));
    console.log('Products with aiMetadata:', String(withMetadata.count));
    console.log('Products with embedding:', String(withEmbedding.count));
    console.log('Products missing aiMetadata OR embedding:', String(missingEither.count));
    console.log('Products missing aiMetadata AND embedding:', String(missingBoth.count));
    console.log('----------------------\n');

    console.log('[check_ai_data] querying missing samples');
    const missingSamples = await prisma.$queryRaw`
      SELECT
        id,
        name,
        ("aiMetadata" IS NULL) as missing_metadata,
        (embedding IS NULL) as missing_embedding
      FROM "Product"
      WHERE "aiMetadata" IS NULL OR embedding IS NULL
      ORDER BY id DESC
      LIMIT 10
    `;

    console.log('Sample Missing Products (up to 10):');
    missingSamples.forEach(p => {
      console.log(`ID: ${p.id} | missing_metadata=${p.missing_metadata} | missing_embedding=${p.missing_embedding} | ${p.name}`);
    });
    console.log('[check_ai_data] done');

  } catch (error) {
    console.error('Error checking data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

await checkData();
