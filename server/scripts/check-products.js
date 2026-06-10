const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const total = await p.product.count();
  const above = await p.product.count({ where: { id: { gt: 83487 } } });
  const aboveWithUrl = await p.product.count({ where: { id: { gt: 83487 }, purchaseUrl: { not: null } } });
  const first = await p.product.findFirst({ where: { id: { gt: 83487 } }, orderBy: { id: 'asc' }, select: { id: true, purchaseUrl: true } });
  const max = await p.product.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  
  console.log('Total products:', total);
  console.log('Max product ID:', max?.id);
  console.log('Products > 83487:', above);
  console.log('Products > 83487 with URL:', aboveWithUrl);
  console.log('First product > 83487:', JSON.stringify(first));
  
  await p.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
