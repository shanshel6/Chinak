import prisma from '../prismaClient.js';

const total = await prisma.product.count();
const max = await prisma.product.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
const above40k = await prisma.product.count({ where: { id: { gt: 40000 } } });
const above40kWithUrl = await prisma.product.count({ where: { id: { gt: 40000 }, purchaseUrl: { not: null } } });
const above40kWithUrlNoImage = await prisma.product.count({ where: { id: { gt: 40000 }, purchaseUrl: { not: null }, image: null } });
const alreadyScraped = await prisma.product.count({ where: { id: { gt: 40000 }, image: { not: null } } });

console.log('Total products:', total);
console.log('Max product ID:', max?.id);
console.log('Products > 40000:', above40k);
console.log('Products > 40000 with URL:', above40kWithUrl);
console.log('Products > 40000 with URL but NO image:', above40kWithUrlNoImage);
console.log('Products > 40000 already have image:', alreadyScraped);

await prisma.$disconnect();
