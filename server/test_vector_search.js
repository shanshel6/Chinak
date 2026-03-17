import prisma from './prismaClient.js';

const TARGET_URL = "https://img.alicdn.com/bao/uploaded/i4/O1CN0127KYFK1x7sjOFyRa9_!!4611686018427381805-0-fleamarket.jpg";

async function testVectorSearch() {
  console.log(`1. Looking up the existing embedding for the URL in the database...`);
  
  // We use queryRaw to extract the vector as a string array so we can use it in the next query
  const targetProduct = await prisma.$queryRaw`
    SELECT id, name, "imageEmbedding"::text as embedding_str
    FROM "Product" 
    WHERE image = ${TARGET_URL} 
    LIMIT 1
  `;

  if (!targetProduct || targetProduct.length === 0) {
      console.log(`Product with this image URL NOT found in DB.`);
      return;
  }

  const product = targetProduct[0];
  if (!product.embedding_str) {
      console.log(`Product found (ID: ${product.id}), but it does NOT have an imageEmbedding yet.`);
      return;
  }

  console.log(`✅ Found product (ID: ${product.id}, Name: ${product.name}) with an existing embedding!`);
  console.log(`2. Searching database for closest matches using the database embedding...`);
  
  try {
    // Search using Cosine Distance (<=>) against the vector we just retrieved
    const results = await prisma.$queryRawUnsafe(`
      SELECT 
        id, 
        name, 
        image,
        (1 - ("imageEmbedding" <=> $1::vector)) as similarity
      FROM "Product"
      WHERE "imageEmbedding" IS NOT NULL
      ORDER BY "imageEmbedding" <=> $1::vector
      LIMIT 10
    `, product.embedding_str);

    console.log(`\n=== TOP 10 MATCHES ===\n`);
    for (const [index, row] of results.entries()) {
      const simPercent = (row.similarity * 100).toFixed(2);
      console.log(`${index + 1}. ID: ${row.id} (Similarity: ${simPercent}%)`);
      console.log(`   Name:  ${row.name}`);
      console.log(`   Image: ${row.image}`);
      console.log(`   ---`);
    }

  } catch (error) {
    console.error("Database search failed:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testVectorSearch();
