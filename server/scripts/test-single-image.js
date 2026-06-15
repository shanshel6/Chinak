import prisma from '../prismaClient.js';

// Bad image patterns from URL
const BAD_IMAGE_URL_PATTERNS = [
  /_Q90\.jpg_$/,             // fleamarket white/placeholder images
  /~livephoto~/,             // live photo HEIC variants
  /tps-48-48/,               // 48x48 tiny placeholder PNGs
  /placeholder/i,
  /blank/i,
  /white\.(jpg|png|gif|webp)$/i,
  /1x1\.(jpg|png|gif|webp)$/i,
  /pixel\.(jpg|png|gif|webp)$/i,
  /transparent\.(jpg|png|gif|webp)$/i,
  /no[-_]?image/i,
  /default[-_]?image/i,
  /missing[-_]?image/i,
  /error[-_]?image/i,
];

function isBadImageByUrl(url) {
  if (!url || url.trim() === '') return true;
  
  // Check all patterns
  for (const pattern of BAD_IMAGE_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  
  // Check for very short filenames (likely placeholder)
  const filename = url.split('/').pop().split('?')[0];
  if (filename.length < 5 && /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) {
    return true;
  }
  
  return false;
}

async function test() {
  console.log('Testing for products with single bad image...\n');
  
  try {
    // First, count products with exactly one image
    const allProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      },
      include: {
        images: {
          select: { id: true, url: true }
        }
      },
      take: 100 // Just check first 100 for testing
    });
    
    console.log(`Checking first ${allProducts.length} products...\n`);
    
    const productsWithSingleImage = allProducts.filter(p => p.images.length === 1);
    const productsWithSingleBadImage = [];
    
    console.log(`Found ${productsWithSingleImage.length} products with exactly one image.\n`);
    
    for (const product of productsWithSingleImage) {
      const imageUrl = product.images[0].url;
      const isBad = isBadImageByUrl(imageUrl);
      
      console.log(`Product ${product.id}: ${product.name.substring(0, 50)}...`);
      console.log(`  Image URL: ${imageUrl}`);
      console.log(`  Is bad image: ${isBad ? 'YES' : 'no'}`);
      
      if (isBad) {
        productsWithSingleBadImage.push({
          id: product.id,
          name: product.name,
          imageUrl: imageUrl
        });
      }
      
      console.log('');
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total products checked: ${allProducts.length}`);
    console.log(`Products with single image: ${productsWithSingleImage.length}`);
    console.log(`Products with single bad image: ${productsWithSingleBadImage.length}`);
    
    if (productsWithSingleBadImage.length > 0) {
      console.log('\nProducts with single bad image:');
      productsWithSingleBadImage.forEach((p, i) => {
        console.log(`${i + 1}. Product ${p.id}: ${p.name.substring(0, 50)}...`);
        console.log(`   Image: ${p.imageUrl}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test().catch(console.error);