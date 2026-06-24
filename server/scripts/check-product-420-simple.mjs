import prisma from '../prismaClient.js';

async function main() {
  const id = 420;
  try {
    const row = await prisma.$queryRawUnsafe(`SELECT id, name FROM "Product" WHERE id = $1 LIMIT 1`, id);
    if (row && row.length > 0) {
      console.log(`Product #${row[0].id} found: ${row[0].name}`);
    } else {
      console.log(`Product #${id} | NOT FOUND in database`);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();