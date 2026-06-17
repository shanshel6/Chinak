const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total,
      COUNT(embedding)::int as text_emb,
      COUNT("imageEmbedding")::int as img_emb
    FROM "Product"
  `;
  const pi = await prisma.$queryRaw`
    SELECT COUNT(*)::int as total, COUNT("imageEmbedding")::int as img_emb FROM "ProductImage"
  `;
  console.log(`Products: ${p[0].total} total`);
  console.log(`  Product.embedding (BGE-M3 text): ${p[0].text_emb}`);
  console.log(`  Product.imageEmbedding:         ${p[0].img_emb}`);
  console.log(`ProductImages: ${pi[0].total} total`);
  console.log(`  ProductImage.imageEmbedding:    ${pi[0].img_emb}`);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
