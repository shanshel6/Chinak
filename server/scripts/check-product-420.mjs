import prisma from '../prismaClient.js';

async function main() {
  const id = 420;
  const row = await prisma.$queryRawUnsafe(`SELECT id, name, "textEmbedding" IS NOT NULL AS has_emb, "textEmbedding"::text AS textEmbedding FROM "Product" WHERE id = $1 LIMIT 1`, id);
  if (row && row.length > 0) {
    const product = row[0];
    const embeddingValue = product.textembedding;
    const hasEmbedding = product.has_emb;
    console.log(`Product #${product.id} | hasEmbedding: ${hasEmbedding} | name: ${String(product.name).slice(0, 50)}`);
    if (hasEmbedding) {
      const cleaned = embeddingValue.replace(/^\[|\]$/g, '').split(',').map(Number).filter(n => !isNaN(n));
      const preview = cleaned.slice(0, 5).map(v => v.toFixed(4)).join(', ') + ', ... (showing first 5 of ' + cleaned.length + ' dimensions)';
      console.log(`  Text embedding: [${preview}]`);
    }
  } else {
    console.log(`Product #${id} | NOT FOUND in database`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });