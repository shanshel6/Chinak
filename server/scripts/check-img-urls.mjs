import prisma from '../prismaClient.js';

async function main() {
  // Check recent products with images
  const products = await prisma.product.findMany({
    where: { image: { not: null } },
    orderBy: { id: 'desc' },
    take: 5,
    select: { id: true, image: true },
  });

  console.log('=== Recent product main images ===');
  for (const p of products) {
    console.log(`\nProduct ${p.id}:`);
    console.log(`  URL: ${p.image}`);
    console.log(`  URL length: ${p.image?.length}`);
    // Check for suspicious patterns
    if (p.image) {
      if (p.image.endsWith('_')) console.log('  ⚠️  URL ends with _ (trailing underscore)');
      if (p.image.includes('_.jpg')) console.log('  ⚠️  URL contains _.jpg');
      if (p.image.includes('.webp')) console.log('  ⚠️  URL still has .webp');
      if (p.image.includes('mtopupload')) console.log('  ⚠️  URL contains mtopupload (placeholder)');
      if (p.image.includes('-0-')) console.log('  ⚠️  URL contains -0- (possible placeholder)');
    }
  }

  // Check product images table
  const imgs = await prisma.productImage.findMany({
    orderBy: { id: 'desc' },
    take: 5,
    select: { id: true, productId: true, url: true },
  });

  console.log('\n=== Recent productImage records ===');
  for (const img of imgs) {
    console.log(`\nImage ${img.id} (product ${img.productId}):`);
    console.log(`  URL: ${img.url}`);
    if (img.url) {
      if (img.url.endsWith('_')) console.log('  ⚠️  URL ends with _');
      if (img.url.includes('_.jpg')) console.log('  ⚠️  URL contains _.jpg');
      if (img.url.includes('.webp')) console.log('  ⚠️  URL still has .webp');
      if (img.url.includes('mtopupload')) console.log('  ⚠️  URL contains mtopupload');
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
