import prisma from './prismaClient.js';
import fs from 'fs';

async function main() {
  const content = fs.readFileSync('../recent_products.json', 'utf8');
  
  // Try to find the JSON array in the content
  // The content seems to be a PowerShell dump, so the JSON is after "Content           : "
  const match = content.match(/Content\s+:\s+([\s\S]+?)RawContent/);
  let productsJson = '';
  
  if (match) {
    productsJson = match[1].trim();
  } else {
    // Maybe it's just the JSON itself?
    productsJson = content.trim();
  }

  try {
    // If it's a PowerShell dump, the JSON might be split across lines or truncated
    // Let's try to parse it. If it fails, we might need a different approach.
    const rawData = JSON.parse(productsJson);
    console.log(`Found ${rawData.length} products in recent_products.json`);

    console.log('Importing products...');
    for (const p of rawData) {
      const existing = await prisma.product.findFirst({
        where: { name: p.name }
      });

      if (!existing) {
        await prisma.product.create({
          data: {
            name: p.name || 'Unnamed Product',
            chineseName: p.chineseName,
            description: p.description,
            price: (parseFloat(p.price) || 0) * 1.1, // Added 10% margin
            basePriceRMB: parseFloat(p.basePriceRMB) || 0,
            image: p.image || '',
            purchaseUrl: p.purchaseUrl,
            status: 'PUBLISHED',
            isActive: true,
            isFeatured: !!p.isFeatured,
            specs: p.specs,
            storeEvaluation: p.storeEvaluation,
            reviewsCountShown: p.reviewsCountShown,
            videoUrl: p.videoUrl
          }
        });
        console.log(`Imported: ${p.name}`);
      } else {
        console.log(`Skipped (exists): ${p.name}`);
      }
    }
    console.log('Import finished!');
  } catch (err) {
    console.error('Failed to parse or import products:', err.message);
    // If parsing fails, let's dump the first 500 chars to debug
    console.log('Raw content snippet:', productsJson.substring(0, 500));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
