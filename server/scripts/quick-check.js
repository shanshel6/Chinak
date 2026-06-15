import prisma from '../prismaClient.js';

async function quickCheck() {
  console.log('🚀 Quick check for small images...\n');
  
  try {
    // Get a small sample quickly
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      },
      include: {
        images: {
          select: { url: true }
        }
      },
      take: 50,  // Small sample for quick results
      orderBy: { id: 'asc' }
    });
    
    console.log(`Checked ${products.length} products\n`);
    
    let singleImageCount = 0;
    let smallImageCount = 0;
    const smallImageProducts = [];
    
    // Simple pattern check
    const smallPatterns = [
      /tps-48-48/,
      /_Q90\.jpg_$/,
      /~livephoto~/,
      /(\d+)x(\d+)/,
    ];
    
    for (const product of products) {
      if (product.images.length === 1) {
        singleImageCount++;
        const url = product.images[0].url;
        
        // Check if URL suggests small image
        let isSmall = false;
        for (const pattern of smallPatterns) {
          if (pattern.test(url)) {
            // For dimension patterns, check if small
            if (pattern.toString().includes('(\\d+)x(\\d+)')) {
              const match = url.match(pattern);
              if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                if (w < 100 && h < 100) {
                  isSmall = true;
                  break;
                }
              }
            } else {
              isSmall = true;
              break;
            }
          }
        }
        
        if (isSmall) {
          smallImageCount++;
          smallImageProducts.push({
            id: product.id,
            name: product.name,
            url: url
          });
        }
      }
    }
    
    console.log('=== RESULTS ===\n');
    console.log(`Products with single image: ${singleImageCount}`);
    console.log(`Products with single small image: ${smallImageCount}`);
    
    if (smallImageProducts.length > 0) {
      console.log('\nProducts with single small images:');
      smallImageProducts.forEach((p, i) => {
        console.log(`${i + 1}. ID: ${p.id}`);
        console.log(`   Name: ${p.name.substring(0, 50)}...`);
        console.log(`   URL: ${p.url}`);
        console.log('');
      });
    } else {
      console.log('\n✅ No products with single small images found in this sample.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

quickCheck().catch(console.error);