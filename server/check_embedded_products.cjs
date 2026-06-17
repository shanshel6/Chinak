
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const productIdsToCheck = [356, 357, 358, 360, 362, 364, 365, 366, 367, 368, 369, 370];

async function main() {
  console.log('Checking embedded products...');

  for (const productId of productIdsToCheck) {
    console.log(`\nProduct ID: ${productId}`);

    try {
      // Use executeRawUnsafe to cast vectors to text
      const result = await prisma.$executeRawUnsafe(`
        SELECT id, name, "imageEmbedding"::text as "imageEmbeddingText", "textEmbedding"::text as "textEmbeddingText"
        FROM "Product"
        WHERE id = $1
      `, productId);

      const products = await prisma.product.findMany({
        where: { id: productId },
        select: { id: true, name: true }
      });

      const product = products[0];

      if (product) {
        console.log(`Name: ${product.name}`);

        // Now get the vector data using a different approach
        const vectorResult = await prisma.$executeRawUnsafe(`
          SELECT "imageEmbedding"::text as img, "textEmbedding"::text as txt
          FROM "Product"
          WHERE id = $1
        `, productId);

        // Since executeRawUnsafe returns the number of affected rows, let's use a different method
        const vectorData = await prisma.$queryRawUnsafe(`
          SELECT "imageEmbedding"::text as "imageEmbeddingText", "textEmbedding"::text as "textEmbeddingText"
          FROM "Product"
          WHERE id = ${productId}
        `);

        if (vectorData && vectorData[0]) {
          const { imageEmbeddingText, textEmbeddingText } = vectorData[0];

          if (imageEmbeddingText) {
            const imageEmbedding = JSON.parse(imageEmbeddingText.replace(/'/g, '"')); // Replace single quotes if needed
            console.log(`✅ Image Embedding Found (${imageEmbedding.length} dimensions)`);
            if (imageEmbedding.length === 512) {
              console.log(`   Correct dimension: 512`);
            } else {
              console.warn(`   Wrong dimension: expected 512, got ${imageEmbedding.length}`);
            }
            console.log(`   First 5 values: ${imageEmbedding.slice(0, 5).map(v => Number(v).toFixed(6)).join(', ')}`);
          } else {
            console.warn(`❌ No image embedding`);
          }

          if (textEmbeddingText) {
            const textEmbedding = JSON.parse(textEmbeddingText.replace(/'/g, '"'));
            console.log(`✅ Text Embedding Found (${textEmbedding.length} dimensions)`);
            if (textEmbedding.length === 512) {
              console.log(`   Correct dimension: 512`);
            } else {
              console.warn(`   Wrong dimension: expected 512, got ${textEmbedding.length}`);
            }
            console.log(`   First 5 values: ${textEmbedding.slice(0, 5).map(v => Number(v).toFixed(6)).join(', ')}`);
          } else {
            console.warn(`❌ No text embedding`);
          }
        }
      } else {
        console.warn(`❌ Product not found in database`);
      }
    } catch (error) {
      console.error(`❌ Error checking product ${productId}:`, error.message);
    }
  }

  await prisma.$disconnect();
  console.log('\n✅ Done checking products!');
}

main();
