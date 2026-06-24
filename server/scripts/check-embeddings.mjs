import prisma from '../prismaClient.js';

async function main() {
  const ids = [404, 405, 406, 411, 413, 408, 415, 414, 418, 419, 421, 422];
  for (const id of ids) {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, name, textEmbedding IS NOT NULL AS has_emb FROM "Product" WHERE id = $1 LIMIT 1`, id);
    const row = rows[0];
    if (row) {
      console.log(`Product #${row.id} | hasEmbedding: ${row.has_emb} | name: ${String(row.name).slice(0, 40)}`);
    } else {
      console.log(`Product #${id} | NOT FOUND`);
    }
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });