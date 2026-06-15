import prisma from '../prismaClient.js';

async function check500Products() {
  console.log('📊 Checking 500 products for small images...\n');
  
  try {
    // Get 500 products
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
      take: 500,
      orderBy: { id: 'asc' }
    });
    
    console.log(`Analyzing ${products.length} products...\n`);
    
    // Patterns for small images
    const patterns = {
      'tps-48-48': /tps-48-48/,
      'Q90 placeholder': /_Q90\.jpg_$/,
      'livephoto': /~livephoto~/,
      'small dimensions': /(\d+)x(\d+)/,
      'placeholder': /placeholder/i,
      'blank': /blank/i,
      'white image': /white\.(jpg|png|gif|webp)$/i,
      '1x1 pixel': /1x1\.(jpg|png|gif|webp)$/i,
      'pixel image': /pixel\.(jpg|png|gif|webp)$/i,
    };
    
    let singleImageCount = 0;
    let smallImageCount = 0;
    const smallImageProducts = [];
    const patternCounts = {};
    
    // Initialize pattern counts
    for (const patternName in patterns) {
      patternCounts[patternName] = 0;
    }
    
    for (const product of products) {
      const imageCount = product.images.length;
      
      if (imageCount === 1) {
        singleImageCount++;
        const url = product.images[0].url;
        let productIsSmall = false;
        
        // Check each pattern
        for (const [patternName, pattern] of Object.entries(patterns)) {
          if (pattern.test(url)) {
            // For dimension patterns, check if actually small
            if (patternName === 'small dimensions') {
              const match = url.match(pattern);
              if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                if (w < 100 && h < 100) {
                  patternCounts[patternName]++;
                  productIsSmall = true;
                }
              }
            } else {
              patternCounts[patternName]++;
              productIsSmall = true;
            }
          }
        }
        
        if (productIsSmall) {
          smallImageCount++;
          smallImageProducts.push({
            id: product.id,
            name: product.name,
            url: url
          });
        }
      }
    }
    
    // Calculate statistics
    const singleImagePercent = ((singleImageCount / products.length) * 100).toFixed(1);
    const smallImagePercent = ((smallImageCount / products.length) * 100).toFixed(1);
    
    console.log('=== STATISTICS ===\n');
    console.log(`Total products checked: ${products.length}`);
    console.log(`Products with single image: ${singleImageCount} (${singleImagePercent}%)`);
    console.log(`Products with single small image: ${smallImageCount} (${smallImagePercent}%)`);
    
    if (smallImageCount > 0) {
      console.log('\n=== PATTERN BREAKDOWN ===\n');
      for (const [patternName, count] of Object.entries(patternCounts)) {
        if (count > 0) {
          console.log(`${patternName}: ${count} products`);
        }
      }
      
      console.log('\n=== SAMPLE OF PRODUCTS WITH SMALL IMAGES ===\n');
      const displayCount = Math.min(5, smallImageProducts.length);
      for (let i = 0; i < displayCount; i++) {
        const p = smallImageProducts[i];
        console.log(`${i + 1}. Product ${p.id}: ${p.name.substring(0, 60)}...`);
        console.log(`   URL: ${p.url}`);
        console.log('');
      }
      
      if (smallImageProducts.length > displayCount) {
        console.log(`... and ${smallImageProducts.length - displayCount} more.`);
      }
      
      // Estimate total in database
      const totalProducts = await prisma.product.count({
        where: {
          isActive: true,
          status: 'PUBLISHED'
        }
      });
      
      const estimatedTotal = Math.round((smallImageCount / products.length) * totalProducts);
      console.log(`\n📈 Estimated total products with single small images: ${estimatedTotal.toLocaleString()}`);
      console.log(`   (Based on ${smallImageCount} found in ${products.length} sample)`);
      
    } else {
      console.log('\n✅ No products with single small images found in this sample of 500 products.');
      console.log('This suggests your product images are generally good quality.');
    }
    
    // Additional info
    console.log('\n=== ADDITIONAL INFO ===\n');
    console.log('Patterns checked:');
    console.log('- tps-48-48: 48x48 tiny placeholder PNGs');
    console.log('- _Q90.jpg_: fleamarket white/placeholder images');
    console.log('- ~livephoto~: live photo HEIC variants');
    console.log('- XXxXX: Images with dimensions less than 100x100');
    console.log('- placeholder/blank/white/1x1/pixel: Common placeholder names');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

check500Products().catch(console.error);